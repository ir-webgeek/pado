/**
 * Outbound HTTP for third-party APIs (gateways, SMS, carriers, Meta). Iranian services in particular
 * see short outages and slow responses, so every call gets:
 * - a timeout per attempt
 * - retries with exponential backoff and jitter for network errors, 429 and 5xx (only when the call
 *   is safe to repeat: GET, or a POST the caller marks idempotent)
 * - a per-host circuit breaker: after repeated failures the host is skipped for a cool-down, so a dead
 *   provider does not stall every request queue behind its timeouts
 */
export interface ResilientInit extends RequestInit {
  timeoutMs?: number;
  /** extra attempts after the first (default 2 for GET/idempotent, 0 otherwise) */
  retries?: number;
  /** POST/PUT that can safely be sent twice (e.g. a lookup or a verify of the same invoice) */
  idempotent?: boolean;
  /** label for errors and the breaker; defaults to the host */
  service?: string;
}

interface Breaker {
  failures: number;
  openUntil: number;
}
const breakers = new Map<string, Breaker>();
const FAILURE_THRESHOLD = 5;
const OPEN_MS = 30_000;

export class UpstreamError extends Error {
  constructor(
    message: string,
    public service: string,
    public status?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status === 408 || status >= 500;

export function breakerState(service: string) {
  const b = breakers.get(service);
  return { open: Boolean(b && b.openUntil > Date.now()), failures: b?.failures ?? 0 };
}

export async function resilientFetch(url: string | URL, init: ResilientInit = {}): Promise<Response> {
  const { timeoutMs = 15_000, idempotent, service = new URL(url).host, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const safe = method === "GET" || method === "HEAD" || Boolean(idempotent);
  const retries = init.retries ?? (safe ? 2 : 0);

  const b = breakers.get(service) ?? { failures: 0, openUntil: 0 };
  breakers.set(service, b);
  if (b.openUntil > Date.now()) throw new UpstreamError(`${service} is temporarily unavailable (circuit open)`, service);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(4000, 400 * 2 ** (attempt - 1)) + Math.random() * 200);
    try {
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
      if (retryable(res.status) && attempt < retries) {
        lastErr = new UpstreamError(`${service} answered ${res.status}`, service, res.status);
        continue;
      }
      if (res.status >= 500) b.failures++;
      else b.failures = 0;
      if (b.failures >= FAILURE_THRESHOLD) b.openUntil = Date.now() + OPEN_MS;
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  b.failures++;
  if (b.failures >= FAILURE_THRESHOLD) b.openUntil = Date.now() + OPEN_MS;
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new UpstreamError(`${service} unreachable after ${retries + 1} attempt(s): ${msg}`, service);
}

/** Test hook. */
export function resetBreakers() {
  breakers.clear();
}
