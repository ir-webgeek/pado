import { eq, sql } from "drizzle-orm";
import { automationEvents, automationRules, conversations, messages, type AutoMessage, type Database } from "@shopino/db";
import { env } from "../../config";
import { hmacSha256Hex } from "../../lib/crypto";
import { sendAttachment, sendButtons, sendText, type IgAccount } from "../instagram/client";
import { tagLinks, tagUrl } from "../inbox/dm-ref";

type Rule = typeof automationRules.$inferSelect;

/** Signed token binding a form link to a conversation, so submissions land in the right chat. */
export function conversationToken(conversationId: string) {
  return `${conversationId}.${hmacSha256Hex(env.COOKIE_SECRET, `conv:${conversationId}`).slice(0, 24)}`;
}
export function verifyConversationToken(token: string | undefined): string | null {
  if (!token) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  return hmacSha256Hex(env.COOKIE_SECRET, `conv:${id}`).slice(0, 24) === sig ? id : null;
}

const siteOrigin = () => new URL(env.PUBLIC_WEB_URL).origin;
/** Own-site links in a DM get the dm UTM source and this conversation's signed ref. */
export const dmTagText = (text: string, conversationId: string) => tagLinks(text, siteOrigin(), conversationToken(conversationId));
export const dmTagUrl = (url: string, conversationId: string) => tagUrl(url, siteOrigin(), conversationToken(conversationId));

export const formUrl = (formId: string, conversationId?: string) =>
  `${env.PUBLIC_WEB_URL}/f/${formId}${conversationId ? `?c=${conversationToken(conversationId)}` : ""}`;

function tagMessage(m: AutoMessage, conversationId: string): AutoMessage {
  if (m.kind === "text") return { ...m, text: dmTagText(m.text, conversationId) };
  if (m.kind === "image" && m.caption) return { ...m, caption: dmTagText(m.caption, conversationId) };
  if (m.kind === "buttons") return { ...m, text: dmTagText(m.text, conversationId), buttons: m.buttons.map((b) => ({ ...b, url: dmTagUrl(b.url, conversationId) })) };
  return m;
}

/** Text shown in the inbox for an outbound automated message. */
export function describe(m: AutoMessage, conversationId?: string): string {
  switch (m.kind) {
    case "text":
      return m.text;
    case "image":
      return `🖼 ${m.caption ?? ""} ${m.url}`.trim();
    case "audio":
      return `🎙 ${m.url}`;
    case "video":
      return `🎬 ${m.url}`;
    case "buttons":
      return `${m.text}\n${m.buttons.map((b) => `▸ ${b.title}: ${b.url}`).join("\n")}`;
    case "form":
      return `${m.text}\n📝 ${formUrl(m.formId, conversationId)}`;
  }
}

/**
 * Send a rule's messages in order. With `account` null (web chat / dry run) messages are only recorded.
 * Returns the rendered texts.
 */
export async function sendRuleMessages(db: Database, account: IgAccount | null, conv: { id: string; shopId: string; externalUserId: string }, rule: Rule) {
  const sent: string[] = [];
  for (const raw of rule.messages) {
    const m = tagMessage(raw, conv.id);
    if (account) {
      if (m.kind === "text") await sendText(account, conv.externalUserId, m.text);
      else if (m.kind === "image") {
        await sendAttachment(account, conv.externalUserId, "image", m.url);
        if (m.caption) await sendText(account, conv.externalUserId, m.caption);
      } else if (m.kind === "audio" || m.kind === "video") await sendAttachment(account, conv.externalUserId, m.kind, m.url);
      else if (m.kind === "buttons") await sendButtons(account, conv.externalUserId, m.text, m.buttons);
      else if (m.kind === "form") await sendButtons(account, conv.externalUserId, m.text, [{ title: "📝 فرم", url: formUrl(m.formId, conv.id) }]);
    }
    const text = describe(m, conv.id);
    sent.push(text);
    await db.insert(messages).values({ shopId: conv.shopId, conversationId: conv.id, direction: "out", sender: "system", text, meta: { ruleId: rule.id, kind: m.kind } });
  }
  return sent;
}

export async function recordRuleHit(db: Database, rule: Rule, conversationId: string | null, input: string, error?: string) {
  await db.update(automationRules).set({ hits: sql`${automationRules.hits} + 1` }).where(eq(automationRules.id, rule.id));
  await db.insert(automationEvents).values({ shopId: rule.shopId, ruleId: rule.id, conversationId, trigger: rule.trigger, input: input.slice(0, 500), ok: !error, error });
}

/** After a rule fires the conversation continues with AI, a human, or stays as it was. */
export async function applyThenMode(db: Database, rule: Rule, conversationId: string) {
  if (rule.thenMode === "keep") return;
  await db
    .update(conversations)
    .set(rule.thenMode === "human" ? { mode: "human", needsHuman: true } : { mode: "agent" })
    .where(eq(conversations.id, conversationId));
}
