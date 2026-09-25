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

const graph = (path: string) => `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${path}`;

async function post(account: IgAccount, body: unknown, path = `${account.igUserId}/messages`) {
  const res = await fetch(graph(path), {
    method: "POST",
    headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { message_id?: string; id?: string; error?: { message?: string; code?: number } };
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
 * Private reply to a comment: `recipient: { comment_id }`. Instagram allows exactly one private reply per
 * comment, within 7 days; follow-ups are only possible after the person answers (24h window).
 */
export async function sendPrivateReply(account: IgAccount, commentId: string, text: string) {
  return post(account, { recipient: { comment_id: commentId }, message: { text: chunkText(text)[0] } });
}

/** Public reply under a comment: POST /{comment-id}/replies { message }. */
export async function replyToComment(account: IgAccount, commentId: string, text: string) {
  return post(account, { message: text.slice(0, 2200) }, `${commentId}/replies`);
}

/** Media message: image | audio | video | file, by public URL. */
export async function sendAttachment(account: IgAccount, igsid: string, type: "image" | "audio" | "video" | "file", url: string) {
  return post(account, { recipient: { id: igsid }, message: { attachment: { type, payload: { url } } } });
}

/** Button template: text (<= 640 chars) with 1-3 web_url buttons. */
export async function sendButtons(account: IgAccount, igsid: string, text: string, buttons: { title: string; url: string }[]) {
  return post(account, {
    recipient: { id: igsid },
    message: {
      attachment: {
        type: "template",
        payload: { template_type: "button", text: text.slice(0, 640), buttons: buttons.slice(0, 3).map((b) => ({ type: "web_url", url: b.url, title: b.title })) },
      },
    },
  });
}

export interface IgMediaItem {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  children?: { data: { id: string; media_type: string; media_url?: string }[] };
}

/** GET /{ig-user-id}/media - the account's posts and reels (stories are not included). */
export async function listMedia(account: IgAccount, limit = 50): Promise<IgMediaItem[]> {
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url}";
  const out: IgMediaItem[] = [];
  let url: string | undefined = `${graph(`${account.igUserId}/media`)}?fields=${encodeURIComponent(fields)}&limit=25`;
  while (url && out.length < limit) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${account.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    const json = (await res.json()) as { data?: IgMediaItem[]; paging?: { next?: string }; error?: { message?: string } };
    if (!res.ok) throw new Error(`instagram media list failed (${res.status}): ${json.error?.message ?? "unknown error"}`);
    out.push(...(json.data ?? []));
    url = json.paging?.next;
  }
  return out.slice(0, limit);
}

/** Meta signs webhook payloads with the app secret: X-Hub-Signature-256: sha256=<hex hmac of raw body>. */
export function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!env.META_APP_SECRET) return env.NODE_ENV !== "production";
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), hmacSha256Hex(env.META_APP_SECRET, rawBody));
}
