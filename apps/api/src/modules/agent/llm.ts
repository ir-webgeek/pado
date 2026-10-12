import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import type { Database } from "@shopino/db";
import { env } from "../../config";
import { AppError, badRequest } from "../../lib/errors";
import { walletBalance, walletMove } from "../wallet/service";
import { cfg, cfgNumber } from "../../lib/platform";
import { AI_MODELS, fallbackParams } from "./models";

let client: { key: string; c: Anthropic } | null = null;
/** Client for the current key; rebuilt when the super admin changes it in the panel. */
export const anthropic = () => {
  const key = cfg("ANTHROPIC_API_KEY") ?? "";
  if (client?.key !== key) client = { key, c: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }) };
  return client.c;
};
export const aiAvailable = () => Boolean(cfg("ANTHROPIC_API_KEY"));
export const agentModel = () => cfg("AGENT_MODEL") ?? env.AGENT_MODEL;

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(u: Usage, r: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
  u.input += r.input_tokens;
  u.output += r.output_tokens;
  u.cacheRead += r.cache_read_input_tokens ?? 0;
  u.cacheWrite += r.cache_creation_input_tokens ?? 0;
}

/**
 * Toman charged to the shop wallet for a model call. With a USD rate set in super admin, the model's
 * own token prices plus the markup; otherwise the fixed per-MTok prices from the environment.
 */
export function costOf(u: Usage, model = agentModel()) {
  const inputEquivalent = u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1;
  const rate = cfgNumber("AI_TOMAN_PER_USD", 0);
  const info = AI_MODELS[model];
  if (rate > 0 && info) {
    const usd = (inputEquivalent / 1e6) * info.inUsd + (u.output / 1e6) * info.outUsd;
    return Math.ceil(usd * rate * (1 + cfgNumber("AI_MARKUP_PERCENT", 0) / 100));
  }
  return Math.ceil((inputEquivalent / 1e6) * env.AGENT_PRICE_IN_PER_MTOK + (u.output / 1e6) * env.AGENT_PRICE_OUT_PER_MTOK);
}

/** Charge AI usage; if the wallet can't cover it all, take what is left (never negative). */
export async function chargeAi(db: Database, shopId: string, u: Usage, ref: { type: string; id: string }) {
  const cost = costOf(u);
  if (cost <= 0) return 0;
  const amount = Math.min(cost, await walletBalance(db, shopId));
  if (amount > 0) await walletMove(db, shopId, "ai_usage", -amount, ref, { usage: u, cost });
  return cost;
}

export async function assertAiReady(db: Database, shopId: string) {
  if (!aiAvailable()) throw badRequest("ai_not_configured", "the AI API key is not set (super admin > platform settings)");
  if ((await walletBalance(db, shopId)) < env.AGENT_MIN_BALANCE) throw new AppError(402, "wallet_insufficient", "top up the wallet to use AI features");
}

/**
 * One structured-output call: the response is validated against `schema` by the SDK.
 * Throws on refusal or unparseable output.
 */
export async function structured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  content: string | BetaContentBlockParam[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<{ data: z.infer<S>; usage: Usage }> {
  const model = agentModel();
  const res = await anthropic().beta.messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    ...fallbackParams(model),
  });
  const usage = emptyUsage();
  addUsage(usage, res.usage);
  if (res.stop_reason === "refusal") throw new AppError(422, "ai_refused", "the model declined this request");
  if (res.parsed_output == null) throw new AppError(502, "ai_bad_output", "the model returned an unexpected format");
  return { data: res.parsed_output as z.infer<S>, usage };
}
