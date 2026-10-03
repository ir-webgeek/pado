import { assertPublicHttpsUrl } from "../../lib/safe-url";

/**
 * WooCommerce REST API v3 client: GET only, Basic auth over HTTPS with the consumer key/secret, falling
 * back to consumer_key/consumer_secret query parameters for servers that drop the Authorization header
 * (both documented). The store URL comes from the shop, so every call goes through the SSRF guard.
 */
export interface WooCreds {
  url: string;
  key: string;
  secret: string;
}

export function storeBase(url: string) {
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

export async function wooGet<T>(c: WooCreds, path: string, query: Record<string, string | number> = {}) {
  await assertPublicHttpsUrl(c.url);
  const url = new URL(`${storeBase(c.url)}/wp-json/wc/v3/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const attempt = (u: URL, headers: Record<string, string>) => fetch(u, { headers: { accept: "application/json", ...headers }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  let res = await attempt(url, { authorization: `Basic ${Buffer.from(`${c.key}:${c.secret}`).toString("base64")}` });
  if (res.status === 401) {
    const q = new URL(url);
    q.searchParams.set("consumer_key", c.key);
    q.searchParams.set("consumer_secret", c.secret);
    res = await attempt(q, {});
  }
  const body = (await res.json().catch(() => null)) as (T & { message?: string; code?: string }) | null;
  if (!res.ok) throw new Error(`woocommerce ${path} failed (${res.status}): ${body?.message ?? body?.code ?? res.statusText}`);
  return { data: body as T, total: Number(res.headers.get("x-wp-total") ?? 0), totalPages: Number(res.headers.get("x-wp-totalpages") ?? 1) };
}

/** Store currency (GET settings/general/woocommerce_currency). Only IRR is a core code we convert. */
export async function wooCurrency(c: WooCreds) {
  try {
    const { data } = await wooGet<{ value?: string }>(c, "settings/general/woocommerce_currency");
    return data.value ?? null;
  } catch {
    return null;
  }
}
