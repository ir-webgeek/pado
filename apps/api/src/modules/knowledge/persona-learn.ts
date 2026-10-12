import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { conversations, igComments, messages, shops, type Database } from "@shopino/db";
import { chargeAi, aiAvailable, structured } from "../agent/llm";
import { trainPersonaFromPairs, type Pair, type PersonaProposal } from "../agent/persona-train";

/**
 * Training data for the sales persona: every customer message answered by a teammate in DMs, plus
 * customer comments the shop replied to under its posts.
 */
export async function collectPairs(db: Database, shopId: string, maxConversations = 300): Promise<Pair[]> {
  const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.shopId, shopId)).orderBy(desc(conversations.lastMessageAt)).limit(maxConversations);
  const pairs: Pair[] = [];
  if (convs.length) {
    const rows = await db
      .select({ conversationId: messages.conversationId, direction: messages.direction, sender: messages.sender, text: messages.text })
      .from(messages)
      .where(inArray(messages.conversationId, convs.map((c) => c.id)))
      .orderBy(asc(messages.conversationId), asc(messages.createdAt));
    for (let i = 0; i < rows.length - 1; i++) {
      const q = rows[i]!;
      const a = rows[i + 1]!;
      if (q.conversationId === a.conversationId && q.direction === "in" && a.sender === "human") pairs.push({ customer: q.text, reply: a.text });
    }
  }
  const comments = await db.select().from(igComments).where(eq(igComments.shopId, shopId)).orderBy(desc(igComments.postedAt)).limit(3000);
  const byId = new Map(comments.map((c) => [c.commentId, c]));
  for (const c of comments) {
    const parent = c.byShop && c.parentId ? byId.get(c.parentId) : undefined;
    if (parent && !parent.byShop) pairs.push({ customer: parent.text, reply: c.text });
  }
  return pairs;
}

const aiPersona = z.object({
  tonePreset: z.enum(["friendly", "formal", "energetic", "luxury"]).describe("closest preset to how the shop writes"),
  toneDescription: z.string().describe("one or two sentences describing the voice, in the shop's language"),
  emoji: z.enum(["none", "few", "many"]),
  length: z.enum(["short", "medium"]),
  greeting: z.string().describe("the shop's usual opening line, empty if none"),
  signOff: z.string().describe("the shop's usual closing line, empty if none"),
  phrases: z.array(z.string()).describe("up to 8 short phrases the shop repeats"),
  objections: z.array(z.object({ objection: z.string(), answer: z.string() })).describe("up to 6 customer objections (price, trust, delivery, quality) and how the shop answered them"),
  examples: z.array(z.object({ customer: z.string(), reply: z.string() })).describe("up to 6 of the best, most representative real exchanges, copied verbatim"),
});

export interface PersonaTraining {
  source: "ai" | "history";
  proposal: PersonaProposal & { toneDescription?: string };
}

/** A proposal only - nothing is saved until the owner applies it. */
export async function trainPersona(db: Database, shopId: string, opts: { useAi?: boolean } = {}): Promise<PersonaTraining> {
  const pairs = await collectPairs(db, shopId);
  const heuristic = trainPersonaFromPairs(pairs);
  if (!opts.useAi || !aiAvailable() || pairs.length < 5) return { source: "history", proposal: heuristic };
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId), columns: { name: true } });
  let transcript = "";
  for (const p of pairs) {
    const block = `Customer: ${p.customer}\nShop: ${p.reply}\n\n`;
    if (transcript.length + block.length > 50_000) break;
    transcript += block;
  }
  const { data, usage } = await structured({
    schema: aiPersona,
    system:
      "You study how an online shop's team sells in chat, to configure its AI sales assistant. Describe their real voice and sales habits. Copy examples verbatim from the transcripts; never invent facts, prices or policies. Write in the language the shop uses.",
    content: `Shop: ${shop?.name ?? ""}\n\nExchanges (customer message and the team's reply):\n${transcript}`,
    maxTokens: 6000,
  });
  await chargeAi(db, shopId, usage, { type: "train_persona", id: shopId });
  return {
    source: "ai",
    proposal: {
      ...heuristic,
      tonePreset: data.tonePreset,
      toneDescription: data.toneDescription.slice(0, 400),
      emoji: data.emoji,
      length: data.length,
      greeting: data.greeting.slice(0, 200),
      signOff: data.signOff.slice(0, 200),
      phrases: data.phrases.slice(0, 8).map((x) => x.slice(0, 80)),
      objections: data.objections.slice(0, 6).map((o) => ({ objection: o.objection.slice(0, 300), answer: o.answer.slice(0, 800) })),
      examples: data.examples.slice(0, 6).map((e) => ({ customer: e.customer.slice(0, 400), reply: e.reply.slice(0, 800) })),
    },
  };
}

