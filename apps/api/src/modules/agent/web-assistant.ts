import { resolveShopSettings, type shops } from "@shopino/db";
import { planHas, type PlanId } from "@shopino/shared";
import { aiAvailable } from "./llm";

/** The AI consultant shows on a shop's customer pages when the shop turned it on, the plan includes it and AI is configured. */
export function webAssistantOn(shop: Pick<typeof shops.$inferSelect, "settings" | "plan">) {
  return resolveShopSettings(shop.settings).agent.consultOnWeb && planHas(shop.plan as PlanId, "ai_consult") && aiAvailable();
}
