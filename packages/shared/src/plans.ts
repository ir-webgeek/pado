/**
 * Subscription plans. Prices are in Toman / month. Limits of `null` mean unlimited.
 * Modeled after the ProMall tiers plus appointment features.
 */
export const PLAN_IDS = ["free", "starter", "lite", "pro", "promax", "luxury"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanFeature =
  | "agent"
  | "agent_voice"
  | "agent_training"
  | "auto_print"
  | "card_sms_match"
  | "usd_pricing"
  | "custom_domain"
  | "torob"
  | "seo_tools"
  | "pos"
  | "shop_email"
  | "seo_ai"
  | "priority_support"
  | "appointments"
  | "appointment_deposits"
  | "appointment_reminders"
  | "multi_staff"
  | "automations"
  | "forms"
  | "ai_consult"
  | "knowledge"
  | "ig_import"
  | "landing_ai";

export interface Plan {
  id: PlanId;
  monthly: number | null;
  yearlyPerMonth: number | null;
  aiGiftCredit: number;
  limits: { products: number | null; ordersPerMonth: number | null; staff: number | null; bookingsPerMonth: number | null };
  features: PlanFeature[];
  recommended?: boolean;
}

/** Appointment management and static (non-AI) Instagram automations are free on every plan. */
const base: PlanFeature[] = ["appointments", "appointment_reminders", "multi_staff", "automations", "forms"];
/** AI features: agent in DMs, web consultant, knowledge retrieval, post-to-product import, landing copy. */
const ai: PlanFeature[] = ["agent", "agent_training", "ai_consult", "knowledge", "ig_import", "landing_ai"];

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    monthly: 0,
    yearlyPerMonth: 0,
    aiGiftCredit: 0,
    limits: { products: 30, ordersPerMonth: 50, staff: 5, bookingsPerMonth: null },
    features: [...base],
  },
  starter: {
    id: "starter",
    monthly: 399_000,
    yearlyPerMonth: 319_000,
    aiGiftCredit: 0,
    limits: { products: 50, ordersPerMonth: 200, staff: 10, bookingsPerMonth: null },
    features: [...base],
  },
  lite: {
    id: "lite",
    monthly: 699_000,
    yearlyPerMonth: 559_000,
    aiGiftCredit: 50_000,
    limits: { products: 100, ordersPerMonth: 500, staff: 15, bookingsPerMonth: null },
    features: [...base, ...ai, "auto_print", "appointment_deposits"],
  },
  pro: {
    id: "pro",
    monthly: 1_300_000,
    yearlyPerMonth: 1_100_000,
    aiGiftCredit: 300_000,
    recommended: true,
    limits: { products: 500, ordersPerMonth: null, staff: 10, bookingsPerMonth: null },
    features: [
      ...base,
      ...ai,
      "auto_print",
      "appointment_deposits",
      "agent_voice",
      "card_sms_match",
      "usd_pricing",
      "custom_domain",
      "torob",
      "seo_tools",
    ],
  },
  promax: {
    id: "promax",
    monthly: 3_000_000,
    yearlyPerMonth: 2_700_000,
    aiGiftCredit: 1_000_000,
    limits: { products: 2000, ordersPerMonth: null, staff: 30, bookingsPerMonth: null },
    features: [
      ...base,
      ...ai,
      "auto_print",
      "appointment_deposits",
      "agent_voice",
      "card_sms_match",
      "usd_pricing",
      "custom_domain",
      "torob",
      "seo_tools",
      "pos",
      "shop_email",
      "seo_ai",
      "priority_support",
    ],
  },
  luxury: {
    id: "luxury",
    monthly: null,
    yearlyPerMonth: null,
    aiGiftCredit: 0,
    limits: { products: null, ordersPerMonth: null, staff: null, bookingsPerMonth: null },
    features: [
      ...base,
      ...ai,
      "auto_print",
      "appointment_deposits",
      "agent_voice",
      "card_sms_match",
      "usd_pricing",
      "custom_domain",
      "torob",
      "seo_tools",
      "pos",
      "shop_email",
      "seo_ai",
      "priority_support",
    ],
  },
};

export function planHas(plan: PlanId, feature: PlanFeature): boolean {
  return PLANS[plan].features.includes(feature);
}
