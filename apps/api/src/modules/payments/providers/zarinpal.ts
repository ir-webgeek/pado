import { env } from "../../../config";
import type { PaymentProvider } from "./types";

/**
 * Zarinpal REST v4 adapter.
 * NOTE: written from the publicly documented v4 flow (request -> StartPay redirect -> verify, amounts in Rial,
 * success codes 100/101). The official docs were not reachable from the build environment, so confirm
 * endpoint paths and fields against https://www.zarinpal.com/docs before going live.
 */
const host = () => (env.ZARINPAL_SANDBOX ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com");

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${host()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as T;
}

interface ZpResponse<D> {
  data: D | [];
  errors: { code?: number; message?: string } | [];
}

export const zarinpalProvider: PaymentProvider = {
  name: "zarinpal",
  async request(req) {
    if (!env.ZARINPAL_MERCHANT_ID) throw new Error("ZARINPAL_MERCHANT_ID is not set");
    const r = await post<ZpResponse<{ code: number; authority: string }>>("/pg/v4/payment/request.json", {
      merchant_id: env.ZARINPAL_MERCHANT_ID,
      amount: req.amount * 10,
      currency: "IRR",
      description: req.description,
      callback_url: req.callbackUrl,
      metadata: req.mobile ? { mobile: req.mobile } : undefined,
    });
    const data = Array.isArray(r.data) ? null : r.data;
    if (!data || data.code !== 100) throw new Error(`zarinpal request failed: ${JSON.stringify(r.errors)}`);
    return { authority: data.authority, redirectUrl: `${host()}/pg/StartPay/${data.authority}` };
  },
  async verify({ authority, amount, query }) {
    if (query.Status !== "OK") return { ok: false };
    const r = await post<ZpResponse<{ code: number; ref_id: number }>>("/pg/v4/payment/verify.json", {
      merchant_id: env.ZARINPAL_MERCHANT_ID,
      amount: amount * 10,
      authority,
    });
    const data = Array.isArray(r.data) ? null : r.data;
    const ok = Boolean(data && (data.code === 100 || data.code === 101));
    return { ok, refId: data?.ref_id ? String(data.ref_id) : undefined, raw: r };
  },
};
