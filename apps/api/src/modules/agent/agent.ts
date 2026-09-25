import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { desc, eq } from "drizzle-orm";
import { messages, type ShopSettings } from "@shopino/db";
import { env } from "../../config";
import type { AgentToolContext } from "./tools";
import { runTool, toolsFor } from "./tools";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 }));

export const agentAvailable = () => Boolean(env.ANTHROPIC_API_KEY);

const MAX_TURNS = 6;
const HISTORY = 24;

export interface AgentShop {
  name: string;
  kind: "retail" | "services" | "hybrid";
  timezone: string;
  settings: ShopSettings;
}

export interface AgentResult {
  reply: string | null;
  handoff: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costToman: number;
}

/** Stable instructions first (cacheable), shop-specific text after. */
function systemPrompt(shop: AgentShop): string {
  const a = shop.settings.agent;
  const sells = shop.kind === "retail" ? "products" : shop.kind === "services" ? "services by appointment" : "products and services by appointment";
  return [
    `You are the sales and booking assistant for "${shop.name}", replying to customers in Instagram direct messages. The shop sells ${sells}.`,
    "",
    "How to work:",
    "- Reply in the customer's language (usually Persian). Keep messages short, warm and natural for a DM - no markdown, no headings, at most a couple of short paragraphs.",
    "- Prices, stock, services and free times come only from your tools. Never guess a number; if a tool has nothing, say so honestly.",
    "- Prices are in Toman. Format numbers the way the customer writes (Persian digits for Persian).",
    "- When the customer decides to buy, create the order and send the link from the tool - address and payment happen on that page. Never ask for card numbers or send bank details yourself.",
    "- For appointments: find the service, check today's date if they use relative dates, offer 2-4 concrete times, then book once they pick one and give their name and mobile. Send the booking link. Mention a deposit if one is due.",
    "- Use handoff_to_human when you are unsure, for complaints, refunds, custom requests, or when the customer asks for a person.",
    a.neverOfferDiscount ? "- Never offer or promise discounts." : "",
    "",
    `Tone requested by the shop: ${a.tone}`,
    a.rules ? `\nShop rules (follow strictly):\n${a.rules}` : "",
    a.knowledge ? `\nShop knowledge (policies, shipping, FAQ):\n${a.knowledge}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

async function history(ctx: AgentToolContext): Promise<BetaMessageParam[]> {
  const rows = await ctx.db
    .select({ direction: messages.direction, text: messages.text })
    .from(messages)
    .where(eq(messages.conversationId, ctx.conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY);
  const out: BetaMessageParam[] = [];
  for (const r of rows.reverse()) {
    const role = r.direction === "in" ? "user" : "assistant";
    const text = r.text.trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.role === role && typeof last.content === "string") last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  while (out[0]?.role === "assistant") out.shift();
  // the conversation must end with the customer's turn
  if (out.at(-1)?.role !== "user") return [];
  return out;
}

export function costOf(u: AgentResult["usage"]) {
  const inputEquivalent = u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1;
  return Math.ceil((inputEquivalent / 1e6) * env.AGENT_PRICE_IN_PER_MTOK + (u.output / 1e6) * env.AGENT_PRICE_OUT_PER_MTOK);
}

export async function runAgent(shop: AgentShop, ctx: AgentToolContext): Promise<AgentResult> {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const msgs = await history(ctx);
  if (!msgs.length) return { reply: null, handoff: null, usage, costToman: 0 };

  const tools = toolsFor(shop.kind).map((t) => t.tool);
  const system = systemPrompt(shop);
  let reply: string | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic().beta.messages.create({
      model: env.AGENT_MODEL,
      max_tokens: 4000,
      system,
      tools,
      messages: msgs,
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;

    if (res.stop_reason === "refusal") {
      ctx.handoff ??= "assistant declined to answer";
      break;
    }

    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) reply = text;

    if (res.stop_reason === "pause_turn") {
      msgs.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason !== "tool_use") break;

    msgs.push({ role: "assistant", content: res.content });
    const results: BetaToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const r = await runTool(ctx, block.name, block.input);
      results.push({ type: "tool_result", tool_use_id: block.id, content: r.content, is_error: r.isError });
    }
    // all results for one assistant turn go back in a single user message
    msgs.push({ role: "user", content: results });
    reply = null;
  }

  return { reply, handoff: ctx.handoff ?? null, usage, costToman: costOf(usage) };
}
