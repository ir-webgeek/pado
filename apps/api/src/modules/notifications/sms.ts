import { env } from "../../config";
import { resilientFetch } from "../../lib/http";
import { cfg } from "../../lib/platform";

/**
 * SMS providers. The active one and its keys are set in super admin > platform settings.
 * - console: prints to the log (development)
 * - kavenegar: per the official SDK (github.com/KaveNegar/kavenegar-node):
 *   POST https://api.kavenegar.com/v1/{apikey}/sms/send.json (form: receptor, message, sender)
 *   POST https://api.kavenegar.com/v1/{apikey}/verify/lookup.json (form: receptor, token, template)
 *   response { return: { status, message }, entries }, status 200 = accepted
 */
export interface SmsProvider {
  send(to: string, text: string): Promise<{ ok: boolean; parts: number; error?: string }>;
  /** one-time code through the provider's OTP route when it has one (faster, allowed during quiet hours) */
  otp?(to: string, code: string): Promise<{ ok: boolean; error?: string }>;
}

export function smsParts(text: string) {
  // Persian text is UCS-2: 70 chars single, 67 per part when concatenated
  const ucs2 = /[^\u0000-\u007f]/.test(text);
  const single = ucs2 ? 70 : 160;
  const multi = ucs2 ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

/** +989121234567 -> 09121234567 (the form Kavenegar's examples use) */
export const localMobile = (phone: string) => phone.replace(/^\+98/, "0").replace(/^0098/, "0");

const consoleProvider: SmsProvider = {
  async send(to, text) {
    console.info(`[sms -> ${to}] ${text}`);
    return { ok: true, parts: smsParts(text) };
  },
};

async function kavenegar(action: "sms/send" | "verify/lookup", params: Record<string, string>) {
  const key = cfg("KAVENEGAR_API_KEY");
  if (!key) return { ok: false, error: "KAVENEGAR_API_KEY is not set" };
  const base = (cfg("KAVENEGAR_BASE_URL") ?? "https://api.kavenegar.com").replace(/\/+$/, "");
  const res = await resilientFetch(`${base}/v1/${encodeURIComponent(key)}/${action}.json`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams(params).toString(),
    service: "kavenegar",
    timeoutMs: 15_000,
    // a lookup of the same code is safe to resend; a plain send is not (the customer would get it twice)
    idempotent: action === "verify/lookup",
  });
  const json = (await res.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
  const status = json?.return?.status ?? res.status;
  return status === 200 ? { ok: true } : { ok: false, error: `kavenegar ${status}: ${json?.return?.message ?? res.statusText}` };
}

const kavenegarProvider: SmsProvider = {
  async send(to, text) {
    const sender = cfg("KAVENEGAR_SENDER");
    const r = await kavenegar("sms/send", { receptor: localMobile(to), message: text, ...(sender ? { sender } : {}) });
    if (!r.ok) console.error(`[sms] ${r.error}`);
    return { ...r, parts: smsParts(text) };
  },
  async otp(to, code) {
    const template = cfg("KAVENEGAR_OTP_TEMPLATE");
    if (!template) return { ok: false, error: "no template" };
    return kavenegar("verify/lookup", { receptor: localMobile(to), token: code, template });
  },
};

const providers: Record<string, SmsProvider> = { console: consoleProvider, kavenegar: kavenegarProvider };
const active = () => providers[cfg("SMS_PROVIDER") ?? env.SMS_PROVIDER] ?? consoleProvider;

export function sendSms(to: string, text: string) {
  return active().send(to, text);
}

/** OTP via the provider's template route when configured, otherwise a normal SMS. */
export async function sendOtpSms(to: string, code: string, fallbackText: string) {
  const p = active();
  if (p.otp) {
    const r = await p.otp(to, code);
    if (r.ok) return r;
  }
  return p.send(to, fallbackText);
}
