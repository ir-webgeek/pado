import { and, eq, sql } from "drizzle-orm";
import { conversationEvents, conversations, type DbOrTx } from "@shopino/db";

/**
 * Handling pipeline of a conversation, kept next to the legacy `needsHuman` flag:
 *   open (bot handles or nothing to do) -> needs_human (flagged) -> in_progress (a person on it) -> resolved
 * A new customer message reopens a resolved chat. Every step lands in `conversation_events` so the inbox
 * can show who did what and when.
 */
export const CONVERSATION_STATUSES = ["open", "needs_human", "in_progress", "resolved"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export type ConversationEventType = "handoff" | "assigned" | "human_reply" | "status" | "reopened" | "order" | "booking" | "mode";

export async function logConversationEvent(
  db: DbOrTx,
  shopId: string,
  conversationId: string,
  type: ConversationEventType,
  data?: Record<string, unknown>,
  actorId?: string | null,
) {
  await db.insert(conversationEvents).values({ shopId, conversationId, type, data: data ?? null, actorId: actorId ?? null });
}

/** The bot (or a rule) asks for a person. A chat someone already works on stays theirs. */
export async function flagForHuman(db: DbOrTx, shopId: string, conversationId: string, reason: string, extra: Partial<typeof conversations.$inferInsert> = {}) {
  await db
    .update(conversations)
    .set({ ...extra, needsHuman: true, status: sql`case when ${conversations.status} = 'in_progress' then 'in_progress' else 'needs_human' end`, resolvedAt: null })
    .where(and(eq(conversations.id, conversationId), eq(conversations.shopId, shopId)));
  await logConversationEvent(db, shopId, conversationId, "handoff", { reason });
}

/** A teammate answered: the chat is now in progress and, if nobody owned it, theirs. */
export async function noteHumanReply(db: DbOrTx, shopId: string, conversationId: string, userId: string) {
  const [before] = await db
    .select({ status: conversations.status, assigneeId: conversations.assigneeId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.shopId, shopId)));
  if (!before) return;
  await db
    .update(conversations)
    .set({ needsHuman: false, status: "in_progress", assigneeId: before.assigneeId ?? userId, resolvedAt: null })
    .where(eq(conversations.id, conversationId));
  // one event per takeover, not per message
  if (before.status !== "in_progress" || !before.assigneeId) await logConversationEvent(db, shopId, conversationId, "human_reply", { from: before.status }, userId);
}

/** New customer message on a resolved chat. */
export async function reopenIfResolved(db: DbOrTx, shopId: string, conversationId: string) {
  const rows = await db
    .update(conversations)
    .set({ status: "open", resolvedAt: null })
    .where(and(eq(conversations.id, conversationId), eq(conversations.shopId, shopId), eq(conversations.status, "resolved")))
    .returning({ id: conversations.id });
  if (rows.length) await logConversationEvent(db, shopId, conversationId, "reopened");
}

export async function setConversationStatus(db: DbOrTx, shopId: string, conversationId: string, status: ConversationStatus, actorId: string) {
  const [row] = await db
    .update(conversations)
    .set({
      status,
      needsHuman: status === "needs_human",
      resolvedAt: status === "resolved" ? new Date() : null,
      ...(status === "resolved" ? { unread: 0 } : {}),
    })
    .where(and(eq(conversations.id, conversationId), eq(conversations.shopId, shopId)))
    .returning();
  if (row) await logConversationEvent(db, shopId, conversationId, "status", { status }, actorId);
  return row ?? null;
}

export async function assignConversation(db: DbOrTx, shopId: string, conversationId: string, assigneeId: string | null, actorId: string) {
  const [row] = await db
    .update(conversations)
    .set({ assigneeId, ...(assigneeId ? { status: sql`case when ${conversations.status} in ('open', 'needs_human') then 'in_progress' else ${conversations.status} end` } : {}) })
    .where(and(eq(conversations.id, conversationId), eq(conversations.shopId, shopId)))
    .returning();
  if (row) await logConversationEvent(db, shopId, conversationId, "assigned", { assigneeId }, actorId);
  return row ?? null;
}
