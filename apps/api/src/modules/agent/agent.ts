import type { BetaContentBlockParam, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { desc, eq, inArray } from "drizzle-orm";
import { messages, RAG_SOURCES, type ShopSettings } from "@shopino/db";
import { env } from "../../config";
import { searchKnowledge } from "../knowledge/search";
import { zonedIsoDate } from "@shopino/shared";
import { buildSystemPrompt, formatKnowledge, pickKnowledge, retrievalQuery } from "./persona";
import { addUsage, agentModel, aiAvailable, anthropic, costOf, emptyUsage, type Usage } from "./llm";
import { fallbackParams } from "./models";
import type { AgentToolContext } from "./tools";
import { runTool, toolsFor } from "./tools";

export const agentAvailable = aiAvailable;

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
  usage: Usage;
  costToman: number;
  durationMs: number;
}

/** Knowledge sources the shop allows the assistant to use (empty when retrieval is off). */
export const ragSourcesOf = (settings: ShopSettings) => (settings.rag.enabled ? RAG_SOURCES.filter((s) => settings.rag.sources[s]) : []);

const systemPrompt = buildSystemPrompt;

async function history(ctx: AgentToolContext): Promise<BetaMessageParam[]> {
  const rows = await ctx.db
    .select({ direction: messages.direction, text: messages.text })
    .from(messages)
    .where(ctx.linkedConversationId ? inArray(messages.conversationId, [ctx.conversationId, ctx.linkedConversationId]) : eq(messages.conversationId, ctx.conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY);
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows.reverse()) {
    const role = r.direction === "in" ? "user" : "assistant";
    const text = r.text.trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.role === role) last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  while (out[0]?.role === "assistant") out.shift();
  // the conversation must end with the customer's turn
  if (out.at(-1)?.role !== "user") return [];
  return out;
}

/**
 * Retrieval-augmented turn: the latest customer message is sent together with the most relevant
 * knowledge snippets (and what page they are looking at), so the system prompt stays cacheable.
 */
async function augmentLastTurn(shop: AgentShop, ctx: AgentToolContext, msgs: BetaMessageParam[], pageContext?: string) {
  const last = msgs.at(-1)!;
  const question = typeof last.content === "string" ? last.content : "";
  const rag = shop.settings.rag;
  const customerTurns = msgs.filter((m) => m.role === "user" && typeof m.content === "string").map((m) => m.content as string);
  // over-fetch, then filter by relevance and source preference
  const found = rag.enabled ? await searchKnowledge(ctx.db, ctx.shopId, retrievalQuery(customerTurns), rag.topK * 2, ctx.ragSources) : [];
  const hits = pickKnowledge(found, rag);
  const blocks: BetaContentBlockParam[] = [{ type: "text", text: question }];
  const extra = [
    pageContext ? `[Customer is currently viewing: ${pageContext}]` : "",
    hits.length ? `[Shop knowledge that may help - turn it into a helpful recommendation, keep prices from tools]\n${formatKnowledge(hits, rag.snippetChars)}` : "",
    !hits.length && rag.enabled && rag.strict ? "[No shop knowledge matched this message]" : "",
  ].filter(Boolean);
  if (extra.length) blocks.push({ type: "text", text: extra.join("\n\n") });
  msgs[msgs.length - 1] = { role: "user", content: blocks };
}

export async function runAgent(shop: AgentShop, ctx: AgentToolContext, pageContext?: string): Promise<AgentResult> {
  const started = Date.now();
  const usage = emptyUsage();
  const msgs = await history(ctx);
  if (!msgs.length) return { reply: null, handoff: null, usage, costToman: 0, durationMs: 0 };
  ctx.ragSources ??= ragSourcesOf(shop.settings);
  await augmentLastTurn(shop, ctx, msgs, pageContext);

  const tools = toolsFor(shop.kind).map((t) => t.tool);
  // the shop's own date decides whether a promotion is still on
  const system = systemPrompt(shop, ctx.channel, zonedIsoDate(new Date(), shop.timezone));
  let reply: string | null = null;

  const model = agentModel();
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic().beta.messages.create({
      model,
      max_tokens: 4000,
      system,
      tools,
      messages: msgs,
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive" },
      // chat assistants keep to the shop's rules better at high effort; Haiku stays cheap there
      output_config: { effort: model === "claude-haiku-5-5" ? "high" : "medium" },
      ...fallbackParams(model),
    });
    addUsage(usage, res.usage);

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

  return { reply, handoff: ctx.handoff ?? null, usage, costToman: costOf(usage, model), durationMs: Date.now() - started };
}
