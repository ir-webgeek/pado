import { env } from "../../config";
import { buildAuthorizeUrl, unwrap } from "./oauth-state";

/**
 * Instagram API with Instagram Login - business login (OAuth). Endpoints and parameters follow Meta's
 * "Business Login for Instagram" and "Get started" docs:
 *  1. authorize:  https://www.instagram.com/oauth/authorize?client_id&redirect_uri&response_type=code&scope&state
 *  2. code -> short-lived token: POST https://api.instagram.com/oauth/access_token (form)
 *  3. long-lived (60 days): GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token
 *  4. refresh: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *  5. account: GET /me?fields=user_id,username (user_id = the id webhooks use)
 *  6. webhooks: POST /{IG_ID}/subscribed_apps?subscribed_fields=...
 */
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments"];
/** the fields the webhook handler processes (story mentions arrive inside `messages`) */
export const IG_WEBHOOK_FIELDS = ["messages", "comments"];

export const instagramOAuthConfigured = () => Boolean(env.INSTAGRAM_APP_ID && (env.INSTAGRAM_APP_SECRET ?? env.META_APP_SECRET));
const secret = () => env.INSTAGRAM_APP_SECRET ?? env.META_APP_SECRET ?? "";
const graph = (path: string) => `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${path}`;

export const authorizeUrl = (redirectUri: string, state: string) => buildAuthorizeUrl(env.INSTAGRAM_APP_ID ?? "", redirectUri, IG_SCOPES, state);

async function call<T extends object>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string; error_message?: string };
  if (!res.ok) {
    const msg = json.error_message ?? (typeof json.error === "string" ? json.error : json.error?.message) ?? res.statusText;
    throw new Error(`instagram oauth failed (${res.status}): ${msg}`);
  }
  return unwrap<T>(json);
}

export async function exchangeCode(code: string, redirectUri: string) {
  const body = new FormData();
  body.set("client_id", env.INSTAGRAM_APP_ID ?? "");
  body.set("client_secret", secret());
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", redirectUri);
  // Meta appends "#_" to the redirect; it is not part of the code
  body.set("code", code.replace(/#_$/, ""));
  return call<{ access_token: string; user_id: string | number }>("https://api.instagram.com/oauth/access_token", { method: "POST", body });
}

export async function longLivedToken(shortToken: string) {
  const q = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: secret(), access_token: shortToken });
  return call<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/access_token?${q}`);
}

export async function refreshToken(token: string) {
  const q = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  return call<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/refresh_access_token?${q}`);
}

export async function account(token: string) {
  const q = new URLSearchParams({ fields: "user_id,username", access_token: token });
  const me = await call<{ user_id: string | number; username: string }>(graph(`me?${q}`));
  return { igUserId: String(me.user_id), username: me.username };
}

export async function subscribeWebhooks(igUserId: string, token: string) {
  const q = new URLSearchParams({ subscribed_fields: IG_WEBHOOK_FIELDS.join(","), access_token: token });
  return call<{ success: boolean }>(graph(`${igUserId}/subscribed_apps?${q}`), { method: "POST" });
}
