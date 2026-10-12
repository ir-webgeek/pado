import type { SalesPersona, ShopSettings } from "@shopino/db";

/**
 * The assistant's system prompt: a sales playbook shaped by the shop's persona settings. Pure (no I/O),
 * so it is unit tested. Stable instructions first and shop-specific text after, which keeps the prompt
 * cacheable across turns of the same shop.
 */
export interface PromptShop {
  name: string;
  kind: "retail" | "services" | "hybrid";
  settings: ShopSettings;
}
export type PromptChannel = "instagram" | "telegram" | "web" | "agent";

export const TONE_TEXT: Record<SalesPersona["tonePreset"], string> = {
  friendly: "warm and friendly, like a helpful shop assistant who knows the customer; simple everyday Persian (محاوره‌ای مودبانه)",
  formal: "polite and formal; address the customer as شما, full sentences, no slang",
  energetic: "upbeat and enthusiastic, short punchy sentences, celebrates good choices without exaggerating",
  luxury: "calm, refined and confident; few words, emphasises quality, craft and care; never pushy",
  custom: "",
};

const STYLE_TEXT: Record<SalesPersona["style"], string[]> = {
  consultative: [
    "1. Understand the need: if it is unclear, ask ONE short question (use, size, budget, occasion, date).",
    "2. Recommend 1-3 concrete options from the tools with a one-line reason each, tied to what the customer said.",
    "3. Answer doubts with facts (price, material, sizing, delivery, policies from shop knowledge).",
    "4. When they lean towards one, make the next step easy: offer to create the order or booking and send the link.",
  ],
  soft: [
    "1. Answer exactly what was asked, clearly and kindly.",
    "2. Mention one fitting option or the next step only when it naturally helps; never press.",
    "3. Offer the order or booking link once the customer shows they want it.",
  ],
  direct: [
    "1. Answer quickly with price, availability and the best option.",
    "2. Propose the next step in the same message (order link, booking time) so the customer can act immediately.",
    "3. Keep it brief; skip small talk after the greeting.",
  ],
};

const EMOJI_TEXT: Record<SalesPersona["emoji"], string> = {
  none: "Do not use emoji.",
  few: "At most one emoji in a message, only where it feels natural.",
  many: "Emoji are welcome (1-3 per message) the way the shop uses them.",
};

const LENGTH_TEXT: Record<SalesPersona["length"], string> = {
  short: "Keep each reply to 1-3 short sentences (a DM, not an email).",
  medium: "Replies can be up to two short paragraphs when the customer needs details.",
  detailed: "Give complete answers with the useful details (materials, sizing, delivery, care) in a few short paragraphs; still chat text, not an essay.",
};

const ADDRESS_TEXT: Record<SalesPersona["address"], string> = {
  auto: "Address the customer the way they address you (شما by default; تو only if they use it first).",
  formal: "Always address the customer as شما.",
  informal: "Address the customer as تو, warmly, like a friend who works at the shop.",
};

const REGISTER_TEXT: Record<SalesPersona["register"], string> = {
  colloquial: "Write everyday spoken Persian (e.g. «داریم»، «میشه»، «براتون») with correct spelling.",
  written: "Write standard written Persian (e.g. «موجود است»، «می‌توانید»), polite and clear.",
};

const LANGUAGE_TEXT: Record<SalesPersona["language"], string> = {
  auto: "Reply in the customer's language (usually Persian).",
  fa: "Always reply in Persian, even if the customer writes in another language or Finglish.",
  en: "Always reply in English.",
};

/** The offer is shown until the end of its last day. */
export const promoActive = (p: Pick<SalesPersona, "promo" | "promoUntil">, today: string) => Boolean(p.promo.trim()) && (!p.promoUntil || p.promoUntil >= today);

export function buildSystemPrompt(shop: PromptShop, channel: PromptChannel, today = new Date().toISOString().slice(0, 10)): string {
  const a = shop.settings.agent;
  const p = shop.settings.sales;
  const sells = shop.kind === "retail" ? "products" : shop.kind === "services" ? "services by appointment" : "products and services by appointment";
  const where =
    channel === "instagram"
      ? "replying to customers in Instagram direct messages"
      : "chatting with visitors on the shop's website as a shopping and booking consultant";
  const who = p.assistantName ? `You are ${p.assistantName}, the sales consultant of "${shop.name}"` : `You are the sales consultant of "${shop.name}"`;
  const tone = p.tonePreset === "custom" ? a.tone : [TONE_TEXT[p.tonePreset], a.tone].filter(Boolean).join("; ");

  const lines = [
    `${who}, ${where}. The shop sells ${sells}. Your goal is to help each customer find the right thing and buy or book it, while keeping their trust.`,
    "",
    "Facts:",
    "- Prices, stock, variants, services and free times come only from your tools. Never guess a number; if a tool has nothing, say so honestly and offer an alternative or a person.",
    "- For policies, sizing, shipping, care and anything the shop has explained before, use the shop knowledge attached to the message or search_knowledge. Present it as helpful advice, not as a quote from a document.",
    "- Prices are in Toman. Write numbers the way the customer writes (Persian digits for Persian).",
    p.priceInChat === "link"
      ? "- Do not write prices in the chat; send the product or order link where the customer sees the current price."
      : "",
    "- Never ask for card numbers or send bank details; payment happens on the order or booking page.",
    "",
    "Sales approach:",
    ...STYLE_TEXT[p.style],
    "- Speak in benefits the customer cares about (fit, comfort, quality, delivery time), backed by the facts from tools and knowledge.",
    p.upsell ? "- After the customer has chosen, you may suggest ONE complementary item that is in stock, in one short line. Never before they have chosen, never twice." : "",
    p.scarcity ? "- If a tool shows low stock for an item they want, you may say so plainly. Never invent scarcity or deadlines." : "- Do not use urgency or scarcity to push.",
    p.followUp ? "- End with one short question that moves things forward (size, colour, time, or whether to send the link), unless the customer is clearly done." : "",
    a.neverOfferDiscount ? "- Never offer or promise discounts." : "",
    "- For appointments: find the service, check today's date for relative dates, offer 2-4 concrete times, book once they pick one and give their name and mobile, then send the booking link. Mention a deposit if one is due.",
    p.askPhone
      ? "- Before creating an order, ask for the customer's mobile number (if you don't have it) and pass it to the tool."
      : "",
    "- When the customer decides to buy, create the order and send the link from the tool.",
    promoActive(p, today) ? `- Current offer (mention it once when it fits what the customer wants, never invent other offers): ${p.promo.trim()}` : "",
    "- Use handoff_to_human when unsure, for complaints, refunds, custom requests, or when the customer asks for a person.",
    shop.settings.rag.enabled && shop.settings.rag.strict
      ? "- Policies (shipping, returns, warranty, payment, sizing rules): answer only from the shop knowledge. If it does not cover the question, say you will check with the team and use handoff_to_human; never fill the gap yourself."
      : "",
    "",
    "Voice:",
    `- ${LANGUAGE_TEXT[p.language]} Plain chat text: no markdown, no headings, no lists unless comparing options.`,
    p.language !== "en" ? `- ${ADDRESS_TEXT[p.address]} ${REGISTER_TEXT[p.register]}` : "",
    `- Tone: ${tone || "friendly and natural"}.`,
    `- ${LENGTH_TEXT[p.length]}`,
    `- ${EMOJI_TEXT[p.emoji]}`,
    p.greeting ? `- Start a new conversation with a greeting like: "${p.greeting}" (only at the start, not on every message).` : "",
    p.signOff ? `- When closing a sale or the chat, you may end with: "${p.signOff}".` : "",
    p.phrases.length ? `- Phrases this shop uses (use naturally, at most one per message): ${p.phrases.map((x) => `"${x}"`).join(", ")}.` : "",
    p.bannedWords.length ? `- Never use these words or phrases: ${p.bannedWords.map((x) => `"${x}"`).join(", ")}.` : "",
  ];
  if (p.objections.length) {
    lines.push("", "How the shop answers common objections (adapt, keep the facts from tools):");
    for (const o of p.objections) lines.push(`- Customer: ${o.objection}\n  Shop: ${o.answer}`);
  }
  if (p.examples.length) {
    lines.push("", "Real replies from the shop - match this voice, but take facts only from tools and knowledge:");
    for (const e of p.examples) lines.push(`Customer: ${e.customer}\nShop: ${e.reply}`);
  }
  if (a.learnedStyle) lines.push("", `How this shop usually writes (learned from its past replies):\n${a.learnedStyle}`);
  if (a.rules) lines.push("", `Shop rules (follow strictly):\n${a.rules}`);
  if (a.knowledge) lines.push("", `Shop knowledge (policies, shipping, FAQ):\n${a.knowledge}`);
  if (shop.settings.rag.enabled && shop.settings.rag.instructions) lines.push("", `How to use the shop knowledge:\n${shop.settings.rag.instructions}`);
  return lines.filter((l) => l !== "").join("\n");
}

/** Retrieval query: a short follow-up ("black?", "مشکی داره؟") is searched together with the message before it. */
export function retrievalQuery(customerTurns: string[]): string {
  const last = customerTurns.at(-1)?.trim() ?? "";
  const prev = customerTurns.at(-2)?.trim();
  return last.length < 25 && prev ? `${prev} ${last}` : last;
}

/** Knowledge snippets as the assistant sees them: labelled by kind, product links included, long ones cut. */
export function formatKnowledge(hits: { title: string; content: string; source: string }[], maxChars = 600): string {
  const label: Record<string, string> = { products: "product", comments: "answered before", dm_history: "answered before", faq: "faq", manual: "shop info" };
  const cut = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars).replace(/\s+\S*$/, "")}...` : s);
  return hits.map((h) => `- (${label[h.source] ?? h.source}) ${h.title}: ${cut(h.content)}`).join("\n");
}

const MIN_SCORE: Record<ShopSettings["rag"]["minRelevance"], number> = { any: 0, balanced: 0.08, high: 0.2 };
const WRITTEN_BY_SHOP = new Set(["manual", "faq"]);

/**
 * Pick the snippets to attach: drop weak matches, then (optionally) let answers the shop wrote itself
 * outrank ones learned from chats and comments, and keep the best `topK`.
 */
export function pickKnowledge<T extends { source: string; score: number }>(hits: T[], rag: Pick<ShopSettings["rag"], "minRelevance" | "preferManual" | "topK">): T[] {
  const min = MIN_SCORE[rag.minRelevance];
  const boost = (h: T) => h.score + (rag.preferManual && WRITTEN_BY_SHOP.has(h.source) ? 0.15 : 0);
  return hits
    .filter((h) => h.score >= min)
    .sort((a, b) => boost(b) - boost(a))
    .slice(0, rag.topK);
}

/** A customer message that must reach a person directly (complaints, returns, wholesale...). */
export function handoffKeyword(text: string, keywords: string[], fold: (s: string) => string): string | null {
  const t = fold(text);
  return keywords.find((k) => k.trim() && t.includes(fold(k))) ?? null;
}
