import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { conversations, knowledgeEntries, messages, shops, type Database } from "@shopino/db";
import { chargeAi, structured } from "../agent/llm";

const learned = z.object({
  styleGuide: z.string().describe("How this shop talks to customers: tone, greetings, emoji use, length, recurring phrases. Max ~12 bullet points."),
  faqs: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .describe("Recurring customer questions with the answer the shop actually gave. Only facts that appear in the transcripts."),
});

/**
 * Learn from past DMs: read conversations where the team replied by hand, distill the shop's voice
 * into a style guide and its recurring answers into knowledge entries (source "dm_history").
 */
export async function learnFromDms(db: Database, shopId: string) {
  const convs = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.shopId, shopId)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(60);
  if (!convs.length) return { conversations: 0, faqs: 0 };
  const rows = await db
    .select({ conversationId: messages.conversationId, direction: messages.direction, sender: messages.sender, text: messages.text })
    .from(messages)
    .where(inArray(messages.conversationId, convs.map((c) => c.id)))
    .orderBy(messages.createdAt);

  // keep conversations where a human from the shop answered - that is the voice we want to learn
  const byConv = new Map<string, typeof rows>();
  for (const r of rows) byConv.set(r.conversationId, [...(byConv.get(r.conversationId) ?? []), r]);
  let transcript = "";
  let used = 0;
  for (const [, msgs] of byConv) {
    if (!msgs.some((m) => m.sender === "human")) continue;
    const block = msgs.map((m) => `${m.direction === "in" ? "Customer" : "Shop"}: ${m.text}`).join("\n");
    if (transcript.length + block.length > 60_000) break;
    transcript += `\n--- conversation ${++used} ---\n${block}\n`;
  }
  if (!used) return { conversations: 0, faqs: 0 };

  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  const { data, usage } = await structured({
    schema: learned,
    system:
      "You analyze an online shop's past Instagram DM conversations to teach its sales assistant. Write the style guide and answers in the language the shop uses. Never invent facts, prices or policies that do not appear in the transcripts.",
    content: `Shop: ${shop!.name}\n\nTranscripts:\n${transcript}`,
    maxTokens: 8000,
  });
  await chargeAi(db, shopId, usage, { type: "learn_dms", id: shopId });

  await db.delete(knowledgeEntries).where(and(eq(knowledgeEntries.shopId, shopId), eq(knowledgeEntries.source, "dm_history")));
  if (data.faqs.length) {
    await db.insert(knowledgeEntries).values(data.faqs.slice(0, 60).map((f) => ({ shopId, source: "dm_history", title: f.question.slice(0, 200), content: f.answer.slice(0, 8000) })));
  }
  const settings = { ...shop!.settings, agent: { ...shop!.settings.agent, learnedStyle: data.styleGuide.slice(0, 6000) } };
  await db.update(shops).set({ settings }).where(eq(shops.id, shopId));
  return { conversations: used, faqs: data.faqs.length, styleGuide: data.styleGuide };
}
