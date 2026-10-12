import { cfg } from "../../../lib/platform";
import { resilientFetch } from "../../../lib/http";
import type { PaymentProvider, PaymentRequest } from "./types";

/**
 * TorobPay installments (buy now, pay later). Request shapes follow TorobPay's own WooCommerce plugin
 * (torobpay-for-woocommerce, class-torobpay-api.php):
 * - OAuth password grant: POST api/online/v1/oauth/token, Basic client_id:client_secret,
 *   form grant_type=password, scope=online-merchant, username, password -> access_token, expires_in
 * - POST api/online/payment/v1/token (JSON, amounts in Rial, paymentMethodTypeDto INSTALLMENT)
 *   -> { successful, response: { paymentToken, paymentPageUrl } }
 * - the customer comes back with a POST to returnURL carrying `state` (missing or FAILED = not paid)
 * - POST api/online/payment/v1/verify { paymentToken }, then POST api/online/payment/v1/settle { paymentToken }
 * Errors come as { successful: false, errorData: { errorCode, message } }.
 */
const DEFAULT_BASE = "https://cpg.torobpay.com/";
const base = () => {
  const b = cfg("TOROBPAY_BASE_URL") ?? DEFAULT_BASE;
  return b.endsWith("/") ? b : `${b}/`;
};
const rial = (toman: number) => Math.round(toman * 10);

interface TorobResponse<T = Record<string, unknown>> {
  successful?: boolean;
  response?: T;
  errorData?: { errorCode?: string | number; message?: string };
  access_token?: string;
  expires_in?: number;
}

let cached: { key: string; token: string; until: number } | null = null;

function credentials() {
  const c = { id: cfg("TOROBPAY_CLIENT_ID"), secret: cfg("TOROBPAY_CLIENT_SECRET"), user: cfg("TOROBPAY_USERNAME"), pass: cfg("TOROBPAY_PASSWORD") };
  if (!c.id || !c.secret || !c.user || !c.pass) throw new Error("TorobPay credentials are not set (super admin > platform settings)");
  return c as { id: string; secret: string; user: string; pass: string };
}

export const torobpayConfigured = () => {
  try {
    credentials();
    return true;
  } catch {
    return false;
  }
};

async function bearer(force = false): Promise<string> {
  const c = credentials();
  const key = `${base()}|${c.id}|${c.user}`;
  if (!force && cached?.key === key && cached.until > Date.now()) return cached.token;
  const res = await resilientFetch(`${base()}api/online/v1/oauth/token`, {
    method: "POST",
    idempotent: true,
    service: "torobpay",
    timeoutMs: 10_000,
    headers: { authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", scope: "online-merchant", username: c.user, password: c.pass }).toString(),
  });
  const j = (await res.json().catch(() => ({}))) as TorobResponse;
  if (!j.access_token) throw new Error(`TorobPay authentication failed: ${j.errorData?.message ?? res.status}`);
  // a minute of margin before the token's own expiry (the plugin defaults to 55 minutes)
  cached = { key, token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3300) - 60) * 1000 };
  return cached.token;
}

/** Bearer call; a 401 refreshes the token once (as the plugin does). Only verify/settle/status are safe to repeat. */
async function call<T>(path: string, body: Record<string, unknown>, opts: { idempotent: boolean }): Promise<TorobResponse<T>> {
  const send = async (token: string) =>
    resilientFetch(`${base()}${path}`, {
      method: "POST",
      idempotent: opts.idempotent,
      service: "torobpay",
      timeoutMs: 15_000,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  let res = await send(await bearer());
  if (res.status === 401) res = await send(await bearer(true));
  return (await res.json().catch(() => ({ successful: false, errorData: { message: `HTTP ${res.status}` } }))) as TorobResponse<T>;
}

/** The payment page must be on TorobPay's own domain (or the configured API host), never anywhere else. */
export function trustedPaymentPage(url: string): boolean {
  try {
    const page = new URL(url);
    const api = new URL(base());
    const host = page.hostname.toLowerCase();
    // the configured API host itself (same scheme), or https on TorobPay's own domain
    if (host === api.hostname.toLowerCase()) return page.protocol === api.protocol;
    return page.protocol === "https:" && (host === "torobpay.com" || host.endsWith(".torobpay.com"));
  } catch {
    return false;
  }
}

export function tokenBody(req: PaymentRequest, transactionId: string) {
  const cart = req.cart;
  if (!cart) throw new Error("installment payments need the order details");
  return {
    amount: rial(req.amount),
    paymentMethodTypeDto: "INSTALLMENT",
    returnURL: req.callbackUrl,
    transactionId,
    ...(req.mobile ? { mobile: req.mobile } : {}),
    registration_phone_number: "",
    customer_full_name: cart.customer.name,
    province: cart.customer.province,
    city: cart.customer.city,
    address: cart.customer.address,
    postalCode: cart.customer.postalCode,
    cartList: [
      {
        cartId: cart.reference,
        totalAmount: rial(req.amount),
        cartItems: cart.items.map((i) => ({ name: i.name, count: i.count, amount: rial(i.unitAmount), id: i.id, category: i.category, product_id: i.productId, page_url: i.url })),
        taxAmount: 0,
        shippingAmount: rial(cart.shippingAmount),
        isShipmentIncluded: cart.shippingAmount > 0,
        isTaxIncluded: false,
      },
    ],
    discountAmount: rial(cart.discountAmount),
  };
}

export const torobpayProvider: PaymentProvider = {
  name: "torobpay",
  supportsSplit: false,
  async request(req) {
    const transactionId = `${Date.now()}-${req.cart?.reference ?? "pay"}`;
    const r = await call<{ paymentToken: string; paymentPageUrl: string }>("api/online/payment/v1/token", tokenBody(req, transactionId), { idempotent: false });
    if (!r.successful || !r.response?.paymentToken) throw new Error(`TorobPay: ${r.errorData?.message ?? "could not start the payment"}`);
    if (!trustedPaymentPage(r.response.paymentPageUrl)) throw new Error("TorobPay returned an unexpected payment page address");
    return { authority: r.response.paymentToken, redirectUrl: r.response.paymentPageUrl };
  },
  async verify({ authority, query }) {
    const state = (query.state ?? "").toUpperCase();
    if (!state || state === "FAILED") return { ok: false, raw: { state: state || null } };
    const v = await call<{ transactionId?: string }>("api/online/payment/v1/verify", { paymentToken: authority }, { idempotent: true });
    if (!v.successful) return { ok: false, raw: v };
    // verified = the customer's installment plan is approved; settling confirms it to TorobPay
    const settled = await torobpayProvider.settle!(authority);
    return { ok: true, refId: v.response?.transactionId ?? authority, raw: v, settlePending: !settled };
  },
  async settle(authority) {
    const s = await call("api/online/payment/v1/settle", { paymentToken: authority }, { idempotent: true }).catch(() => null);
    return Boolean(s?.successful);
  },
};
