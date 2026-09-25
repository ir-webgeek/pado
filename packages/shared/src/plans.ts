/**
 * Subscription plans. Prices are in Toman / month. Limits of `null` mean unlimited.
 * Modeled after the ProMall tiers plus appointment features.
 */
export const PLAN_IDS = ["starter", "lite", "pro", "promax", "luxury"] as const;
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
  | "multi_staff";

export interface Plan {
  id: PlanId;
  monthly: number | null;
  yearlyPerMonth: number | null;
  aiGiftCredit: number;
  limits: { products: number | null; ordersPerMonth: number | null; staff: number | null; bookingsPerMonth: number | null };
  features: PlanFeature[];
  recommended?: boolean;
}

const base: PlanFeature[] = ["appointments", "appointment_reminders"];

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    monthly: 399_000,
    yearlyPerMonth: 319_000,
    aiGiftCredit: 0,
    limits: { products: 50, ordersPerMonth: 200, staff: 1, bookingsPerMonth: 150 },
    features: [...base],
  },
  lite: {
    id: "lite",
    monthly: 699_000,
    yearlyPerMonth: 559_000,
    aiGiftCredit: 50_000,
    limits: { products: 100, ordersPerMonth: 500, staff: 3, bookingsPerMonth: 500 },
    features: [...base, "agent", "agent_training", "auto_print", "appointment_deposits"],
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
      "agent",
      "agent_training",
      "auto_print",
      "appointment_deposits",
      "agent_voice",
      "card_sms_match",
      "usd_pricing",
      "custom_domain",
      "torob",
      "seo_tools",
      "multi_staff",
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
      "agent",
      "agent_training",
      "auto_print",
      "appointment_deposits",
      "agent_voice",
      "card_sms_match",
      "usd_pricing",
      "custom_domain",
      "torob",
      "seo_tools",
      "multi_staff",
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
      "agent",
      "agent_training",
      "auto_print",
      "appointment_deposits",
      "agent_voice",
      "card_sms_match",
      "usd_pricing",
      "custom_domain",
      "torob",
      "seo_tools",
      "multi_staff",
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
