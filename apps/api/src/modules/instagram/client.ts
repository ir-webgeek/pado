import { env } from "../../config";
import { hmacSha256Hex, safeEqual } from "../../lib/crypto";

/**
 * Instagram API with Instagram Login - messaging.
 * Send: POST https://graph.instagram.com/{version}/{IG_ID}/messages with an Instagram User access token,
 * body { recipient: { id: IGSID }, message: { text } }. Text is limited to 1000 bytes (UTF-8),
 * and replies are only allowed within 24h of the customer's last message.
 */
const MAX_BYTES = 1000;

export interface IgAccount {
  igUserId: string;
  accessToken: string;
}

async function post(account: IgAccount, body: unknown) {
  const res = await fetch(`https://graph.instagram.com/${env.META_GRAPH_VERSION}/${account.igUserId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number } };
  if (!res.ok) throw new Error(`instagram send failed (${res.status}): ${json.error?.message ?? "unknown error"}`);
  return json;
}

/** Split long replies on paragraph / sentence boundaries so each part stays under the byte limit. */
export function chunkText(text: string, maxBytes = MAX_BYTES): string[] {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  for (const piece of text.split(/(?<=\n\n)|(?<=[.!?؟]\s)/)) {
    if (enc.encode(cur + piece).length <= maxBytes) {
      cur += piece;
      continue;
    }
    if (cur) out.push(cur.trim());
    cur = piece;
    while (enc.encode(cur).length > maxBytes) {
      // hard split by characters as a last resort
      let cut = cur.length;
      while (enc.encode(cur.slice(0, cut)).length > maxBytes) cut = Math.floor(cut * 0.9);
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export async function sendText(account: IgAccount, igsid: string, text: string) {
  const ids: string[] = [];
  for (const part of chunkText(text)) {
    const r = await post(account, { recipient: { id: igsid }, message: { text: part } });
    if (r.message_id) ids.push(r.message_id);
  }
  return ids;
}

/**
 * Private reply to a comment (comment-to-DM). Uses `recipient: { comment_id }` per Meta's private replies
 * feature - confirm against the current Instagram Platform docs before enabling in production.
 */
export async function sendPrivateReply(account: IgAccount, commentId: string, text: string) {
  return post(account, { recipient: { comment_id: commentId }, message: { text: chunkText(text)[0] } });
}

/** Meta signs webhook payloads with the app secret: X-Hub-Signature-256: sha256=<hex hmac of raw body>. */
export function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!env.META_APP_SECRET) return env.NODE_ENV !== "production";
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), hmacSha256Hex(env.META_APP_SECRET, rawBody));
}
