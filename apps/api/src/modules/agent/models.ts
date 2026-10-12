/**
 * Claude models the super admin can pick for the shop assistant. Prices are Anthropic's first-party
 * rates in USD per million tokens (input up to 100K tokens per prompt for Haiku 5.5); the wallet charge
 * converts them with the admin-set Toman rate and markup.
 *
 * Server-side refusal fallback (`fallbacks: "default"`) is sent only to models that support it: Haiku 5.5
 * has no server-side fallback, so a refusal there is handled as a handoff to a person.
 */
export interface ModelInfo {
  label: string;
  inUsd: number;
  outUsd: number;
  serverFallback: boolean;
}

export const AI_MODELS: Record<string, ModelInfo> = {
  "claude-haiku-5-5": { label: "Claude Haiku 5.5 (cheapest)", inUsd: 0.1, outUsd: 0.5, serverFallback: false },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", inUsd: 2, outUsd: 10, serverFallback: true },
  "claude-opus-5-5": { label: "Claude Opus 5.5", inUsd: 4, outUsd: 20, serverFallback: true },
};
export const AI_MODEL_IDS = Object.keys(AI_MODELS);
export const DEFAULT_AI_MODEL = "claude-haiku-5-5";

/** Extra request fields for refusal fallback, only where the model supports it. */
export function fallbackParams(model: string): { betas?: string[]; fallbacks?: "default" } {
  return AI_MODELS[model]?.serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}
