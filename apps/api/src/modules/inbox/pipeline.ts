import { and, desc, eq, sql } from "drizzle-orm";
import { agentRuns, automationRules, conversations, messages, resolveShopSettings, shops, type Database } from "@shopino/db";
import { planHas } from "@shopino/shared";
import { env } from "../../config";
import type { Queues } from "../../lib/queues";
import type { Redis } from "ioredis";
import { agentAvailable, runAgent } from "../agent/agent";
import { chargeAi } from "../agent/llm";
import { applyThenMode, recordRuleHit, sendRuleMessages } from "../automations/execute";
import { matchRule, type Trigger } from "../automations/match";
import { upsertCustomer } from "../customers/service";
import { replyToComment, sendPrivateReply, sendText, type IgAccount } from "../instagram/client";
import { escapeHtml, sendTelegram } from "../notifications/telegram";
import { walletBalance } from "../wallet/service";

export interface InboundMessage {
  shopId: string;
  channel: "instagram" | "web";
  externalUserId: string;
  username?: string;
  text: string;
  externalId?: string;
  attachments?: { type: string; url?: string }[];
  /** the message is a reply to one of the shop's stories */
  storyReplyId?: string;
  /** web consultant: what page the visitor is on (product / service) */
  pageContext?: string;
}

export interface InboundResult {
  reply: string | null;
  handoff: string | null;
  automation?: { ruleId: string; name: string; messages: string[] };
}

type Shop = typeof shops.$inferSelect;
const followupKey = (shopId: string, igsid: string) => `followup:${shopId}:${igsid}`;

const igAccount = (shop: Shop): IgAccount | null => (shop.igUserId && shop.igAccessToken ? { igUserId: shop.igUserId, accessToken: shop.igAccessToken } : null);

async function deliver(shop: Shop, channel: InboundMessage["channel"], externalUserId: string, text: string) {
  if (channel !== "instagram") return [];
  const account = igAccount(shop);
  if (!account) throw new Error("instagram not connected");
  return sendText(account, externalUserId, text);
}

/**
 * Inbound DM pipeline:
 *  1. store the message (idempotent on the platform message id)
 *  2. a pending comment follow-up, then static automations (story mention / story reply / keyword / welcome)
 *  3. otherwise the AI agent, when the conversation is in agent mode and the plan includes it
 */
export async function handleInbound(db: Database, queues: Queues, redis: Redis, msg: InboundMessage): Promise<InboundResult> {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, msg.shopId) });
  if (!shop || shop.suspendedAt) return { reply: null, handoff: null };
  const settings = resolveShopSettings(shop.settings);

  const customer =
    msg.channel === "instagram" ? await upsertCustomer(db, shop.id, { instagramId: msg.externalUserId, instagramUsername: msg.username }) : null;

  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.shopId, shop.id), eq(conversations.channel, msg.channel), eq(conversations.externalUserId, msg.externalUserId)),
    columns: { id: true },
  });
  const [conv] = await db
    .insert(conversations)
    .values({ shopId: shop.id, channel: msg.channel, externalUserId: msg.externalUserId, username: msg.username, customerId: customer?.id, lastInboundAt: new Date() })
    .onConflictDoUpdate({
      target: [conversations.shopId, conversations.channel, conversations.externalUserId],
      set: { lastMessageAt: new Date(), lastInboundAt: new Date(), unread: sql`${conversations.unread} + 1`, customerId: sql`coalesce(${conversations.customerId}, excluded.customer_id)` },
    })
    .returning();

  const isMention = msg.attachments?.some((a) => a.type === "story_mention") ?? false;
  const text = msg.text || (msg.attachments?.length ? `[${msg.attachments.map((a) => a.type).join(", ")}]` : "");
  const inserted = await db
    .insert(messages)
    .values({
      shopId: shop.id,
      conversationId: conv!.id,
      direction: "in",
      sender: "customer",
      text,
      externalId: msg.externalId,
      meta: msg.attachments || msg.storyReplyId ? { attachments: msg.attachments, storyReplyId: msg.storyReplyId } : null,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  if (!inserted.length) return { reply: null, handoff: null }; // duplicate webhook delivery

  // ---- static automations (free tier, no AI)
  if (planHas(shop.plan, "automations")) {
    const account = msg.channel === "instagram" ? igAccount(shop) : null;
    const rules = await db.select().from(automationRules).where(and(eq(automationRules.shopId, shop.id), eq(automationRules.active, true)));
    let rule: (typeof rules)[number] | undefined;

    // someone who commented and got a private reply just answered: send the rule's full follow-up
    if (msg.channel === "instagram") {
      const pending = await redis.get(followupKey(shop.id, msg.externalUserId));
      if (pending) {
        await redis.del(followupKey(shop.id, msg.externalUserId));
        rule = rules.find((r) => r.id === pending);
      }
    }
    const events: { trigger: Trigger; mediaId?: string }[] = [];
    if (isMention) events.push({ trigger: "story_mention" });
    if (msg.storyReplyId) events.push({ trigger: "story_reply", mediaId: msg.storyReplyId });
    events.push({ trigger: "dm_keyword" });
    if (!existing) events.push({ trigger: "first_message" });
    for (const e of events) {
      if (rule) break;
      rule = matchRule(rules, { trigger: e.trigger, text, mediaId: e.mediaId });
    }

    if (rule && rule.messages.length) {
      try {
        const sent = await sendRuleMessages(db, account, conv!, rule);
        await recordRuleHit(db, rule, conv!.id, text);
        await applyThenMode(db, rule, conv!.id);
        if (rule.thenMode === "human") await queues.add("notify.handoff", { conversationId: conv!.id, reason: "automation" });
        await db.update(conversations).set({ lastMessageAt: new Date(), unread: 0 }).where(eq(conversations.id, conv!.id));
        return { reply: sent.join("\n\n"), handoff: null, automation: { ruleId: rule.id, name: rule.name, messages: sent } };
      } catch (err) {
        await recordRuleHit(db, rule, conv!.id, text, (err as Error).message);
      }
    }
  }

  // ---- AI agent
  const fresh = await db.query.conversations.findFirst({ where: eq(conversations.id, conv!.id) });
  const agentOn = fresh!.mode === "agent" && settings.agent.enabled && planHas(shop.plan, "agent") && agentAvailable();
  if (!agentOn) return { reply: null, handoff: null };
  if ((await walletBalance(db, shop.id)) < env.AGENT_MIN_BALANCE) {
    await db.update(conversations).set({ needsHuman: true }).where(eq(conversations.id, conv!.id));
    await queues.add("notify.handoff", { conversationId: conv!.id, reason: "wallet empty" });
    return { reply: null, handoff: "wallet empty" };
  }

  const toolCtx = {
    db,
    queues,
    shopId: shop.id,
    timezone: shop.timezone,
    conversationId: conv!.id,
    channel: msg.channel,
    customer: { instagramId: msg.channel === "instagram" ? msg.externalUserId : undefined, name: customer?.name, phone: customer?.phone, username: msg.username },
    toolLog: [] as { name: string; ok: boolean }[],
  };
  let result;
  try {
    result = await runAgent({ name: shop.name, kind: shop.kind, timezone: shop.timezone, settings }, toolCtx, msg.pageContext);
  } catch (err) {
    await db.insert(agentRuns).values({ shopId: shop.id, conversationId: conv!.id, channel: msg.channel, model: env.AGENT_MODEL, tools: toolCtx.toolLog, error: (err as Error).message.slice(0, 500) });
    await db.update(conversations).set({ needsHuman: true }).where(eq(conversations.id, conv!.id));
    throw err;
  }
  const cost = await chargeAi(db, shop.id, result.usage, { type: "conversation", id: conv!.id });

  if (result.reply) {
    const ids = await deliver(shop, msg.channel, msg.externalUserId, result.reply);
    await db.insert(messages).values({ shopId: shop.id, conversationId: conv!.id, direction: "out", sender: "agent", text: result.reply, externalId: ids[0], meta: { usage: result.usage, cost } });
  }
  const handoff = result.handoff ?? (result.reply ? null : "agent could not produce a reply");
  await db.insert(agentRuns).values({
    shopId: shop.id,
    conversationId: conv!.id,
    channel: msg.channel,
    model: env.AGENT_MODEL,
    inputTokens: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite,
    outputTokens: result.usage.output,
    cost,
    tools: toolCtx.toolLog,
    handoff,
    reply: result.reply?.slice(0, 1000),
    durationMs: result.durationMs,
  });
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(), unread: handoff ? fresh!.unread : 0, needsHuman: Boolean(handoff), ...(handoff ? { mode: "human" as const } : {}) })
    .where(eq(conversations.id, conv!.id));

  if (handoff) await queues.add("notify.handoff", { conversationId: conv!.id, reason: handoff });
  if (handoff && shop.telegramChatId) {
    await sendTelegram(shop.telegramChatId, `🙋 <b>${escapeHtml(shop.name)}</b>\nA customer needs a human reply.\nReason: ${escapeHtml(handoff)}`, {
      text: "Open inbox",
      url: `${env.PUBLIC_WEB_URL}/panel/inbox`,
    }).catch(() => undefined);
  }
  return { reply: result.reply, handoff };
}

/**
 * Comment automation: public reply under the comment + Instagram's single private reply. If the rule
 * has follow-up messages they are sent once the person answers the private reply (their DM opens the window).
 */
export async function handleComment(
  db: Database,
  redis: Redis,
  payload: { shopId: string; commentId: string; text: string; fromId: string; username?: string; mediaId?: string },
) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, payload.shopId) });
  const account = shop && !shop.suspendedAt ? igAccount(shop) : null;
  if (!shop || !account || !planHas(shop.plan, "automations")) return false;
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.shopId, shop.id), eq(automationRules.trigger, "comment"), eq(automationRules.active, true)));
  const rule = matchRule(rules, { trigger: "comment", text: payload.text, mediaId: payload.mediaId });
  if (!rule) return false;
  try {
    if (rule.publicReply) await replyToComment(account, payload.commentId, rule.publicReply);
    const privateText = rule.privateReply ?? (rule.messages.find((m) => m.kind === "text") as { text: string } | undefined)?.text;
    if (privateText) await sendPrivateReply(account, payload.commentId, privateText);
    if (rule.messages.length) await redis.set(followupKey(shop.id, payload.fromId), rule.id, "EX", 7 * 86400);
    await upsertCustomer(db, shop.id, { instagramId: payload.fromId, instagramUsername: payload.username });
    await recordRuleHit(db, rule, null, payload.text);
    return true;
  } catch (err) {
    await recordRuleHit(db, rule, null, payload.text, (err as Error).message);
    throw err;
  }
}

/** A shop teammate replies from the panel. */
export async function humanReply(db: Database, shopId: string, conversationId: string, text: string, userId: string) {
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, conversationId), eq(conversations.shopId, shopId)) });
  if (!conv) return null;
  const shop = (await db.query.shops.findFirst({ where: eq(shops.id, shopId) }))!;
  const ids = await deliver(shop, conv.channel === "instagram" ? "instagram" : "web", conv.externalUserId, text);
  const [m] = await db
    .insert(messages)
    .values({ shopId, conversationId, direction: "out", sender: "human", text, externalId: ids[0], meta: { userId } })
    .returning();
  await db.update(conversations).set({ lastMessageAt: new Date(), unread: 0, needsHuman: false }).where(eq(conversations.id, conversationId));
  return m;
}

/** Latest agent runs of a conversation (admin + inbox insights). */
export async function recentRuns(db: Database, conversationId: string) {
  return db.select().from(agentRuns).where(eq(agentRuns.conversationId, conversationId)).orderBy(desc(agentRuns.createdAt)).limit(20);
}
