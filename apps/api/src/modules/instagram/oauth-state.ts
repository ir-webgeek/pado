import { hmacSha256Hex, safeEqual } from "../../lib/crypto";

/**
 * OAuth `state` for Instagram login: shop + user + expiry, HMAC-signed with a key derived for this
 * purpose only, so it can never be mistaken for a session token even though it travels in URLs.
 */
export interface IgState {
  shopId: string;
  userId: string;
  /** also set as an httpOnly cookie on the browser that started the flow (login-CSRF guard) */
  nonce: string;
  exp: number;
}

const key = (secret: string) => hmacSha256Hex(secret, "instagram-oauth-state");

export function signState(secret: string, s: Omit<IgState, "exp">, ttlMs = 10 * 60_000, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...s, exp: now + ttlMs })).toString("base64url");
  return `${body}.${hmacSha256Hex(key(secret), body)}`;
}

export function verifyState(secret: string, state: string, now = Date.now()): IgState | null {
  const [body, sig] = state.split(".");
  if (!body || !sig || !safeEqual(sig, hmacSha256Hex(key(secret), body))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as IgState;
    return typeof s.exp === "number" && s.exp > now && s.shopId && s.userId && s.nonce ? s : null;
  } catch {
    return null;
  }
}

/** Meta's docs show some responses wrapped in `data: [...]` and others flat; accept both. */
export function unwrap<T extends object>(json: unknown): T {
  const j = json as { data?: unknown };
  if (Array.isArray(j?.data) && j.data.length > 0) return j.data[0] as T;
  return json as T;
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, scopes: string[], state: string) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(","), state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}
