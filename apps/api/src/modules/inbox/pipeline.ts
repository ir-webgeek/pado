import { and, eq, sql } from "drizzle-orm";
import { commentRules, conversations, messages, resolveShopSettings, shops, type Database } from "@shopino/db";
import { planHas } from "@shopino/shared";
import { env } from "../../config";
import type { Queues } from "../../lib/queues";
import { agentAvailable, runAgent } from "../agent/agent";
import { upsertCustomer } from "../customers/service";
import { sendPrivateReply, sendText } from "../instagram/client";
import { sendTelegram, escapeHtml } from "../notifications/telegram";
import { walletBalance, walletMove } from "../wallet/service";

export interface InboundMessage {
  shopId: string;
  channel: "instagram" | "web";
  externalUserId: string;
  username?: string;
  text: string;
  externalId?: string;
  attachments?: { type: string; url?: string }[];
}

type Shop = typeof shops.$inferSelect;

async function deliver(shop: Shop, channel: InboundMessage["channel"], externalUserId: string, text: string) {
  if (channel === "instagram") {
    if (!shop.igUserId || !shop.igAccessToken) throw new Error("instagram not connected");
    return sendText({ igUserId: shop.igUserId, accessToken: shop.igAccessToken }, externalUserId, text);
  }
  return [];
}

/** Charge AI usage; if the wallet can't cover the full amount take what is left (never negative). */
async function chargeAi(db: Database, shopId: string, cost: number, conversationId: string, usage: object) {
  if (cost <= 0) return;
  const balance = await walletBalance(db, shopId);
  const amount = Math.min(cost, balance);
  if (amount > 0) await walletMove(db, shopId, "ai_usage", -amount, { type: "conversation", id: conversationId }, { usage, cost });
}

/**
 * Store an inbound message and let the agent answer when the conversation is in agent mode.
 * Returns the reply text (if any) - the web playground uses it directly.
 */
export async function handleInbound(db: Database, queues: Queues, msg: InboundMessage): Promise<{ reply: string | null; handoff: string | null }> {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, msg.shopId) });
  if (!shop) return { reply: null, handoff: null };
  const settings = resolveShopSettings(shop.settings);

  const customer =
    msg.channel === "instagram" ? await upsertCustomer(db, shop.id, { instagramId: msg.externalUserId, instagramUsername: msg.username }) : null;

  const [conv] = await db
    .insert(conversations)
    .values({ shopId: shop.id, channel: msg.channel, externalUserId: msg.externalUserId, username: msg.username, customerId: customer?.id })
    .onConflictDoUpdate({
      target: [conversations.shopId, conversations.channel, conversations.externalUserId],
      set: { lastMessageAt: new Date(), lastInboundAt: new Date(), unread: sql`${conversations.unread} + 1`, customerId: sql`coalesce(${conversations.customerId}, excluded.customer_id)` },
    })
    .returning();

  const text = msg.text || (msg.attachments?.length ? `[${msg.attachments.map((a) => a.type).join(", ")}]` : "");
  const inserted = await db
    .insert(messages)
    .values({ shopId: shop.id, conversationId: conv!.id, direction: "in", sender: "customer", text, externalId: msg.externalId, meta: msg.attachments ? { attachments: msg.attachments } : null })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  if (!inserted.length) return { reply: null, handoff: null }; // duplicate webhook delivery

  const agentOn = conv!.mode === "agent" && settings.agent.enabled && planHas(shop.plan, "agent") && agentAvailable();
  if (!agentOn) return { reply: null, handoff: null };
  if ((await walletBalance(db, shop.id)) < env.AGENT_MIN_BALANCE) {
    await db.update(conversations).set({ needsHuman: true }).where(eq(conversations.id, conv!.id));
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
  } as const;
  const result = await runAgent({ name: shop.name, kind: shop.kind, timezone: shop.timezone, settings }, { ...toolCtx });
  await chargeAi(db, shop.id, result.costToman, conv!.id, result.usage);

  if (result.reply) {
    const ids = await deliver(shop, msg.channel, msg.externalUserId, result.reply);
    await db.insert(messages).values({
      shopId: shop.id,
      conversationId: conv!.id,
      direction: "out",
      sender: "agent",
      text: result.reply,
      externalId: ids[0],
      meta: { usage: result.usage, cost: result.costToman },
    });
  }
  const handoff = result.handoff ?? (result.reply ? null : "agent could not produce a reply");
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(), unread: handoff ? conv!.unread : 0, needsHuman: Boolean(handoff), ...(handoff ? { mode: "human" as const } : {}) })
    .where(eq(conversations.id, conv!.id));

  if (handoff && shop.telegramChatId) {
    await sendTelegram(shop.telegramChatId, `🙋 <b>${escapeHtml(shop.name)}</b>\nA customer needs a human reply.\nReason: ${escapeHtml(handoff)}`, {
      text: "Open inbox",
      url: `${env.PUBLIC_WEB_URL}/panel/inbox`,
    }).catch(() => undefined);
  }
  return { reply: result.reply, handoff };
}

/** Comment-to-DM: matching comments get a private reply (and optionally a public one). */
export async function handleComment(db: Database, payload: { shopId: string; commentId: string; text: string; mediaId?: string }) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, payload.shopId) });
  if (!shop?.igUserId || !shop.igAccessToken) return false;
  const rules = await db.select().from(commentRules).where(and(eq(commentRules.shopId, shop.id), eq(commentRules.active, true)));
  const text = payload.text.toLowerCase();
  const rule = rules.find((r) => (!r.mediaId || r.mediaId === payload.mediaId) && r.keywords.some((k) => text.includes(k.toLowerCase())));
  if (!rule) return false;
  await sendPrivateReply({ igUserId: shop.igUserId, accessToken: shop.igAccessToken }, payload.commentId, rule.replyText);
  await db.update(commentRules).set({ hits: sql`${commentRules.hits} + 1` }).where(eq(commentRules.id, rule.id));
  return true;
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
