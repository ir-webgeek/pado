export const SHOP_KINDS = ["retail", "services", "hybrid"] as const;
export type ShopKind = (typeof SHOP_KINDS)[number];

export const MEMBER_ROLES = ["owner", "admin", "staff", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ORDER_STATUSES = [
  "awaiting_payment",
  "confirmed",
  "processing",
  "ready_to_ship",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "returned",
  "expired",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Allowed manual transitions for an order. Payment-driven transitions happen in the payments module. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ["confirmed", "cancelled", "expired"],
  confirmed: ["processing", "cancelled"],
  processing: ["ready_to_ship", "cancelled"],
  ready_to_ship: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["completed", "returned"],
  completed: ["returned"],
  cancelled: [],
  returned: [],
  expired: [],
};

export const PAYMENT_STATUSES = ["unpaid", "pending_review", "paid", "refunded", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["gateway", "card_to_card", "wallet", "cash", "installment"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SALES_CHANNELS = ["instagram", "telegram", "web", "pos", "phone", "agent"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const APPOINTMENT_STATUSES = [
  "pending",
  "confirmed",
  "checked_in",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that occupy a staff member's calendar. */
export const BLOCKING_APPOINTMENT_STATUSES: AppointmentStatus[] = ["pending", "confirmed", "checked_in"];

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show", "completed"],
  checked_in: ["completed", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const CUSTOMER_SEGMENTS = ["vip", "regular", "new", "at_risk", "lost"] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const WALLET_TX_KINDS = ["topup", "plan_gift", "ai_usage", "sms", "refund", "adjustment"] as const;
export type WalletTxKind = (typeof WALLET_TX_KINDS)[number];

export const CONVERSATION_MODES = ["agent", "human"] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];
