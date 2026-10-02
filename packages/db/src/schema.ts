import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  APPOINTMENT_STATUSES,
  CONVERSATION_MODES,
  CUSTOMER_SEGMENTS,
  MEMBER_ROLES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PLAN_IDS,
  SALES_CHANNELS,
  SHOP_KINDS,
  WALLET_TX_KINDS,
} from "@shopino/shared";

// Column names are mapped camelCase -> snake_case by the `casing` option on the client and drizzle-kit.

const money = (name?: string) => (name ? bigint(name, { mode: "number" }) : bigint({ mode: "number" }));
const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const shopRef = () =>
  uuid()
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" });

// ---------------------------------------------------------------- enums
export const shopKind = pgEnum("shop_kind", SHOP_KINDS);
export const memberRole = pgEnum("member_role", MEMBER_ROLES);
export const planId = pgEnum("plan_id", PLAN_IDS);
export const orderStatus = pgEnum("order_status", ORDER_STATUSES);
export const paymentStatus = pgEnum("payment_status", PAYMENT_STATUSES);
export const paymentMethod = pgEnum("payment_method", PAYMENT_METHODS);
export const salesChannel = pgEnum("sales_channel", SALES_CHANNELS);
export const appointmentStatus = pgEnum("appointment_status", APPOINTMENT_STATUSES);
export const customerSegment = pgEnum("customer_segment", CUSTOMER_SEGMENTS);
export const walletTxKind = pgEnum("wallet_tx_kind", WALLET_TX_KINDS);
export const conversationMode = pgEnum("conversation_mode", CONVERSATION_MODES);
export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export const paymentPurpose = pgEnum("payment_purpose", ["order", "appointment", "wallet_topup", "subscription"]);
export const messageDirection = pgEnum("message_direction", ["in", "out"]);
export const messageSender = pgEnum("message_sender", ["customer", "agent", "human", "system"]);

// ---------------------------------------------------------------- identity
export const users = pgTable("users", {
  id: id(),
  phone: text().notNull().unique(),
  name: text(),
  /** platform operator (super admin dashboard) */
  isSuperAdmin: boolean().notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    userAgent: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

// ---------------------------------------------------------------- tenancy
export interface ShopSettings {
  loyalty: { enabled: boolean; tomanPerPoint: number; pointValue: number; expiryDays: number };
  vipRule: { minOrders: number; minSpend: number; withinDays: number };
  atRiskDays: number;
  booking: {
    slotStepMin: number;
    minNoticeMin: number;
    maxAdvanceDays: number;
    cancelWindowMin: number;
    autoConfirm: boolean;
    reminderOffsetsMin: number[];
    /** customers may move their own booking (before cancelWindowMin) */
    customerReschedule: boolean;
    /** money paid for a booking the customer cancels in time goes straight to their shop wallet */
    refundToWallet: boolean;
  };
  agent: {
    enabled: boolean;
    tone: string;
    rules: string;
    neverOfferDiscount: boolean;
    knowledge: string;
    /** show the AI shopping / booking consultant on the storefront and booking pages */
    consultOnWeb: boolean;
    /** style guide distilled from past human replies (learn-from-DMs) */
    learnedStyle: string;
  };
  cardToCard: { cardNumber: string; holder: string; bank: string };
  /** SMS alerts to the shop manager */
  alerts: { phone: string; onHandoff: boolean; onOrder: boolean; onBooking: boolean };
  /** seller details printed on invoices and shipping labels */
  invoice: { address: string; phone: string; postalCode: string; footer: string };
  /** optional USD-linked pricing: variant price = priceUsd x rate x (1 + markup), rounded */
  pricing: { usdEnabled: boolean; usdRate: number; markupPercent: number; roundTo: number; rateUpdatedAt: string | null; autoFetch: boolean };
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  loyalty: { enabled: true, tomanPerPoint: 100_000, pointValue: 1_000, expiryDays: 365 },
  vipRule: { minOrders: 3, minSpend: 5_000_000, withinDays: 30 },
  atRiskDays: 90,
  booking: {
    slotStepMin: 15,
    minNoticeMin: 60,
    maxAdvanceDays: 60,
    cancelWindowMin: 180,
    autoConfirm: true,
    reminderOffsetsMin: [24 * 60, 120],
    customerReschedule: true,
    refundToWallet: false,
  },
  agent: {
    enabled: false,
    tone: "friendly, short, warm; uses the customer's language",
    rules: "",
    neverOfferDiscount: true,
    knowledge: "",
    consultOnWeb: false,
    learnedStyle: "",
  },
  cardToCard: { cardNumber: "", holder: "", bank: "" },
  invoice: { address: "", phone: "", postalCode: "", footer: "" },
  alerts: { phone: "", onHandoff: true, onOrder: true, onBooking: false },
  pricing: { usdEnabled: false, usdRate: 0, markupPercent: 0, roundTo: 1000, rateUpdatedAt: null, autoFetch: false },
};

export type PartialShopSettings = { [K in keyof ShopSettings]?: Partial<ShopSettings[K]> };

/** Stored settings are sparse; always read them through this so new defaults apply to old shops. */
export function resolveShopSettings(stored: PartialShopSettings | null | undefined): ShopSettings {
  const s = stored ?? {};
  return {
    loyalty: { ...DEFAULT_SHOP_SETTINGS.loyalty, ...s.loyalty },
    vipRule: { ...DEFAULT_SHOP_SETTINGS.vipRule, ...s.vipRule },
    atRiskDays: s.atRiskDays ?? DEFAULT_SHOP_SETTINGS.atRiskDays,
    booking: { ...DEFAULT_SHOP_SETTINGS.booking, ...s.booking },
    agent: { ...DEFAULT_SHOP_SETTINGS.agent, ...s.agent },
    cardToCard: { ...DEFAULT_SHOP_SETTINGS.cardToCard, ...s.cardToCard },
    invoice: { ...DEFAULT_SHOP_SETTINGS.invoice, ...s.invoice },
    alerts: { ...DEFAULT_SHOP_SETTINGS.alerts, ...s.alerts },
    pricing: { ...DEFAULT_SHOP_SETTINGS.pricing, ...s.pricing },
  };
}

export interface StoreLanding {
  headline: string;
  subheadline: string;
  highlights: { title: string; text: string }[];
  faq: { q: string; a: string }[];
  featuredCategorySlugs: string[];
  generatedAt: string;
}

export const shops = pgTable(
  "shops",
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    kind: shopKind().notNull().default("retail"),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    // new shops get "free" from the API (an enum value can't be used as default in the migration that adds it)
    plan: planId().notNull().default("starter"),
    planExpiresAt: timestamp({ withTimezone: true }),
    timezone: text().notNull().default("Asia/Tehran"),
    currency: text().notNull().default("IRT"),
    brandColor: text().notNull().default("#d9d0b8"),
    theme: text().notNull().default("boutique"),
    logo: text(),
    customDomain: text().unique(),
    settings: jsonb().$type<PartialShopSettings>().notNull().default({}),
    walletBalance: money().notNull().default(0),
    // integrations (tokens should be encrypted at rest in production - see README)
    igUserId: text().unique(),
    igUsername: text(),
    igAccessToken: text(),
    /** long-lived Instagram tokens last 60 days; a daily job refreshes them before this */
    igTokenExpiresAt: timestamp({ withTimezone: true }),
    telegramChatId: text(),
    /** merchant Sheba (IR...) that receives the shop's share when split payments go live */
    settlementIban: text(),
    /** AI-generated (then editable) storefront landing content */
    landing: jsonb().$type<StoreLanding>(),
    suspendedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("wallet_non_negative", sql`${t.walletBalance} >= 0`)],
);

export const shopMembers = pgTable(
  "shop_members",
  {
    id: id(),
    shopId: shopRef(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole().notNull().default("staff"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.shopId, t.userId), index().on(t.userId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    shopId: shopRef(),
    actorId: uuid(),
    actorType: text().notNull().default("user"), // user | agent | system | customer
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    data: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.createdAt)],
);

// ---------------------------------------------------------------- catalog
export const categories = pgTable(
  "categories",
  {
    id: id(),
    shopId: shopRef(),
    name: text().notNull(),
    slug: text().notNull(),
    parentId: uuid(),
    sort: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.shopId, t.slug)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    shopId: shopRef(),
    title: text().notNull(),
    slug: text().notNull(),
    description: text().notNull().default(""),
    categoryId: uuid().references(() => categories.id, { onDelete: "set null" }),
    images: jsonb().$type<string[]>().notNull().default([]),
    status: productStatus().notNull().default("active"),
    seoTitle: text(),
    seoDescription: text(),
    source: text().notNull().default("manual"), // manual | instagram | woocommerce | excel
    sourceRef: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.shopId, t.slug),
    index().on(t.shopId, t.status, t.createdAt),
    index("products_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    shopId: shopRef(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text(),
    attributes: jsonb().$type<Record<string, string>>().notNull().default({}),
    price: money().notNull(),
    compareAtPrice: money(),
    /** optional USD price in cents; when the shop enables USD pricing, `price` is derived from it */
    priceUsdCents: integer(),
    /** weighted-average purchase cost, updated by goods receipts */
    costPrice: money(),
    stock: integer().notNull().default(0),
    reserved: integer().notNull().default(0),
    lowStockThreshold: integer().notNull().default(3),
    position: smallint().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.productId),
    uniqueIndex().on(t.shopId, t.sku),
    check("stock_non_negative", sql`${t.stock} >= 0`),
    check("reserved_valid", sql`${t.reserved} >= 0 AND ${t.reserved} <= ${t.stock}`),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    shopId: shopRef(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    delta: integer().notNull(),
    stockAfter: integer().notNull(),
    reason: text().notNull(), // sale | purchase | correction | damage | return | count | cancel
    refType: text(),
    refId: text(),
    note: text(),
    actorId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.variantId, t.createdAt), index().on(t.shopId, t.createdAt)],
);

/** Goods received from a supplier: raises stock and the weighted-average cost of each variant. */
export const stockReceipts = pgTable(
  "stock_receipts",
  {
    id: id(),
    shopId: shopRef(),
    code: text().notNull(),
    supplier: text().notNull().default(""),
    note: text(),
    receivedAt: timestamp({ withTimezone: true }).notNull(),
    total: money().notNull(),
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.shopId, t.code), index().on(t.shopId, t.receivedAt)],
);

export const stockReceiptItems = pgTable(
  "stock_receipt_items",
  {
    id: id(),
    receiptId: uuid()
      .notNull()
      .references(() => stockReceipts.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer().notNull(),
    unitCost: money().notNull(),
  },
  (t) => [index().on(t.receiptId), check("receipt_qty_positive", sql`${t.quantity} > 0`), check("receipt_cost_non_negative", sql`${t.unitCost} >= 0`)],
);

/** Operating costs entered by the shop (rent, salaries, materials, ...), for the profit report. */
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    shopId: shopRef(),
    category: text().notNull(),
    amount: money().notNull(),
    spentAt: timestamp({ withTimezone: true }).notNull(),
    note: text(),
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.spentAt), check("expense_positive", sql`${t.amount} > 0`)],
);

// ---------------------------------------------------------------- customers & club
export interface Address {
  fullName: string;
  phone: string;
  province: string;
  city: string;
  line: string;
  postalCode?: string;
}

export const customers = pgTable(
  "customers",
  {
    id: id(),
    shopId: shopRef(),
    phone: text(),
    name: text(),
    email: text(),
    instagramId: text(),
    instagramUsername: text(),
    telegramId: text(),
    city: text(),
    defaultAddress: jsonb().$type<Address>(),
    tags: jsonb().$type<string[]>().notNull().default([]),
    notes: text(),
    ordersCount: integer().notNull().default(0),
    totalSpent: money().notNull().default(0),
    lastOrderAt: timestamp({ withTimezone: true }),
    appointmentsCount: integer().notNull().default(0),
    noShowCount: integer().notNull().default(0),
    lastVisitAt: timestamp({ withTimezone: true }),
    points: integer().notNull().default(0),
    /** store credit held by this shop (refunds), spendable on its bookings and orders */
    walletBalance: money().notNull().default(0),
    segment: customerSegment().notNull().default("new"),
    smsOptOut: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.shopId, t.phone),
    uniqueIndex().on(t.shopId, t.instagramId),
    index().on(t.shopId, t.segment),
    index().on(t.shopId, t.lastOrderAt),
    check("customer_wallet_non_negative", sql`${t.walletBalance} >= 0`),
  ],
);

export const customerWalletTx = pgTable(
  "customer_wallet_tx",
  {
    id: id(),
    shopId: shopRef(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    amount: money().notNull(),
    balanceAfter: money().notNull(),
    reason: text().notNull(), // refund | payment | adjust
    refType: text(),
    refId: text(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.customerId, t.createdAt), index().on(t.shopId, t.createdAt)],
);

export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: id(),
    shopId: shopRef(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    delta: integer().notNull(),
    reason: text().notNull(), // earn | redeem | reverse | expire | adjust
    refType: text(),
    refId: text(),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.customerId, t.createdAt)],
);

// ---------------------------------------------------------------- orders
export const discounts = pgTable(
  "discounts",
  {
    id: id(),
    shopId: shopRef(),
    code: text().notNull(),
    type: text().notNull(), // percent | fixed
    value: integer().notNull(),
    minOrder: money().notNull().default(0),
    maxUses: integer(),
    usedCount: integer().notNull().default(0),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    appliesTo: text().notNull().default("all"), // orders | appointments | all
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.shopId, t.code)],
);

export const shippingMethods = pgTable("shipping_methods", {
  id: id(),
  shopId: shopRef(),
  name: text().notNull(),
  carrier: text().notNull().default("manual"), // manual | courier | post | postex | tipax | pickup
  price: money().notNull().default(0),
  freeOver: money(),
  active: boolean().notNull().default(true),
  sort: integer().notNull().default(0),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    shopId: shopRef(),
    code: text().notNull().unique(),
    /** secret for the public completion/tracking link */
    accessToken: text().notNull(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    channel: salesChannel().notNull().default("web"),
    status: orderStatus().notNull().default("awaiting_payment"),
    paymentStatus: paymentStatus().notNull().default("unpaid"),
    paymentMethod: paymentMethod(),
    subtotal: money().notNull(),
    discountTotal: money().notNull().default(0),
    shippingTotal: money().notNull().default(0),
    pointsUsed: integer().notNull().default(0),
    pointsDiscount: money().notNull().default(0),
    total: money().notNull(),
    discountCode: text(),
    address: jsonb().$type<Address>(),
    note: text(),
    shippingMethodId: uuid().references(() => shippingMethods.id, { onDelete: "set null" }),
    carrier: text(),
    trackingCode: text(),
    reservedUntil: timestamp({ withTimezone: true }),
    paidAt: timestamp({ withTimezone: true }),
    shippedAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    printedAt: timestamp({ withTimezone: true }),
    conversationId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.shopId, t.status, t.createdAt),
    index().on(t.shopId, t.createdAt),
    index().on(t.customerId),
    index().on(t.reservedUntil).where(sql`${t.status} = 'awaiting_payment'`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid().references(() => products.id, { onDelete: "set null" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "set null" }),
    title: text().notNull(),
    variantLabel: text().notNull().default(""),
    unitPrice: money().notNull(),
    quantity: integer().notNull(),
    total: money().notNull(),
    /** variant cost at the moment of payment, for cost of goods sold */
    unitCost: money(),
  },
  (t) => [index().on(t.orderId), index().on(t.productId)],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text().notNull(),
    data: jsonb(),
    actorType: text().notNull().default("system"),
    actorId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orderId, t.createdAt)],
);

// ---------------------------------------------------------------- appointments
export interface DepositRule {
  type: "none" | "fixed" | "percent";
  value: number;
}

export interface BeforeAfter {
  before: string;
  after: string;
  caption?: string;
}

export const services = pgTable(
  "services",
  {
    id: id(),
    shopId: shopRef(),
    name: text().notNull(),
    description: text().notNull().default(""),
    categoryId: uuid().references(() => categories.id, { onDelete: "set null" }),
    durationMin: integer().notNull(),
    bufferBeforeMin: integer().notNull().default(0),
    bufferAfterMin: integer().notNull().default(0),
    price: money().notNull(),
    priceFrom: boolean().notNull().default(false),
    deposit: jsonb().$type<DepositRule>().notNull().default({ type: "none", value: 0 }),
    capacity: integer().notNull().default(1),
    onlineBookable: boolean().notNull().default(true),
    requiresApproval: boolean().notNull().default(false),
    color: text().notNull().default("#aebbd0"),
    /** square avatar shown on service cards */
    image: text(),
    /** wide cover shown at the top of the service page */
    banner: text(),
    gallery: jsonb().$type<string[]>().notNull().default([]),
    beforeAfter: jsonb().$type<BeforeAfter[]>().notNull().default([]),
    active: boolean().notNull().default(true),
    sort: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.shopId, t.active), check("duration_positive", sql`${t.durationMin} > 0`)],
);

export const staff = pgTable(
  "staff",
  {
    id: id(),
    shopId: shopRef(),
    memberId: uuid().references(() => shopMembers.id, { onDelete: "set null" }),
    name: text().notNull(),
    title: text().notNull().default(""),
    phone: text(),
    avatar: text(),
    color: text().notNull().default("#d9d0b8"),
    active: boolean().notNull().default(true),
    sort: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.active)],
);

export const staffServices = pgTable(
  "staff_services",
  {
    staffId: uuid()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    serviceId: uuid()
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    priceOverride: money(),
    durationOverride: integer(),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] }), index().on(t.serviceId)],
);

/** Weekly recurring hours, minutes-from-midnight in the shop timezone. Several rows per day allow split shifts. */
export const workingHours = pgTable(
  "working_hours",
  {
    id: id(),
    shopId: shopRef(),
    staffId: uuid()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    weekday: smallint().notNull(),
    startMin: integer().notNull(),
    endMin: integer().notNull(),
  },
  (t) => [
    index().on(t.staffId, t.weekday),
    check("weekday_range", sql`${t.weekday} BETWEEN 0 AND 6`),
    check("hours_range", sql`${t.startMin} >= 0 AND ${t.endMin} <= 1440 AND ${t.endMin} > ${t.startMin}`),
  ],
);

/** Time off for one staff member, or the whole shop (holidays) when staffId is null. */
export const timeOff = pgTable(
  "time_off",
  {
    id: id(),
    shopId: shopRef(),
    staffId: uuid().references(() => staff.id, { onDelete: "cascade" }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    reason: text().notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.startsAt), check("time_off_range", sql`${t.endsAt} > ${t.startsAt}`)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    shopId: shopRef(),
    code: text().notNull().unique(),
    accessToken: text().notNull(),
    serviceId: uuid()
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    staffId: uuid()
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    /** start/end including service buffers - this is what occupies the calendar */
    blockStart: timestamp({ withTimezone: true }).notNull(),
    blockEnd: timestamp({ withTimezone: true }).notNull(),
    status: appointmentStatus().notNull().default("pending"),
    channel: salesChannel().notNull().default("web"),
    price: money().notNull(),
    discountCode: text(),
    discountTotal: money().notNull().default(0),
    depositAmount: money().notNull().default(0),
    paidAmount: money().notNull().default(0),
    paymentStatus: paymentStatus().notNull().default("unpaid"),
    note: text(),
    internalNote: text(),
    cancelReason: text(),
    cancelledBy: text(), // customer | shop | system
    /** set when a paid booking is cancelled - the shop settles the refund */
    refundStatus: text(), // requested | refunded | kept
    confirmedAt: timestamp({ withTimezone: true }),
    checkedInAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    holdUntil: timestamp({ withTimezone: true }),
    conversationId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.shopId, t.startsAt),
    index().on(t.staffId, t.blockStart, t.blockEnd),
    index().on(t.customerId, t.startsAt),
    check("appointment_range", sql`${t.endsAt} > ${t.startsAt} AND ${t.blockEnd} >= ${t.endsAt} AND ${t.blockStart} <= ${t.startsAt}`),
  ],
);

// ---------------------------------------------------------------- payments & wallet
export const payments = pgTable(
  "payments",
  {
    id: id(),
    shopId: shopRef(),
    purpose: paymentPurpose().notNull(),
    orderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    appointmentId: uuid().references(() => appointments.id, { onDelete: "set null" }),
    provider: text().notNull(), // mock | zarinpal | card_to_card | cash
    method: paymentMethod().notNull(),
    amount: money().notNull(),
    /** platform commission (e.g. 1%) - settled via split payment once a shared gateway is live */
    platformFee: money().notNull().default(0),
    status: text().notNull().default("initiated"), // initiated | pending_review | paid | failed | refunded
    authority: text(),
    refId: text(),
    receiptUrl: text(),
    meta: jsonb(),
    paidAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.shopId, t.createdAt),
    index().on(t.orderId),
    index().on(t.appointmentId),
    uniqueIndex().on(t.provider, t.authority),
  ],
);

export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: id(),
    shopId: shopRef(),
    kind: walletTxKind().notNull(),
    amount: money().notNull(),
    balanceAfter: money().notNull(),
    refType: text(),
    refId: text(),
    meta: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.createdAt)],
);

// ---------------------------------------------------------------- messaging / agent
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    shopId: shopRef(),
    channel: salesChannel().notNull(),
    externalUserId: text().notNull(),
    username: text(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    mode: conversationMode().notNull().default("agent"),
    needsHuman: boolean().notNull().default(false),
    unread: integer().notNull().default(0),
    lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastInboundAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.shopId, t.channel, t.externalUserId), index().on(t.shopId, t.lastMessageAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    shopId: shopRef(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirection().notNull(),
    sender: messageSender().notNull(),
    text: text().notNull().default(""),
    externalId: text(),
    meta: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.conversationId, t.createdAt), uniqueIndex().on(t.shopId, t.externalId)],
);

/** One message in a static (non-AI) automated reply. */
export type AutoMessage =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; caption?: string }
  | { kind: "audio"; url: string }
  | { kind: "video"; url: string }
  | { kind: "buttons"; text: string; buttons: { title: string; url: string }[] }
  | { kind: "form"; formId: string; text: string };

/**
 * Keyword / event triggered replies that run without AI (free tier).
 * - comment: comment on a post or reel (optionally a specific media)
 * - story_reply: reply to one of the shop's stories
 * - story_mention: the shop was mentioned in a story
 * - dm_keyword: a direct message containing a keyword
 * - first_message: the very first DM from a new person (welcome)
 */
export const automationRules = pgTable(
  "automation_rules",
  {
    id: id(),
    shopId: shopRef(),
    name: text().notNull(),
    trigger: text().notNull(), // comment | story_reply | story_mention | dm_keyword | first_message
    mediaId: text(),
    keywords: jsonb().$type<string[]>().notNull().default([]),
    matchMode: text().notNull().default("contains"), // contains | exact | any
    /** public reply under the comment (comment trigger only) */
    publicReply: text(),
    /** comment trigger: the single private reply Instagram allows */
    privateReply: text(),
    /** DM triggers (and comment follow-ups once the person answers): sent in order */
    messages: jsonb().$type<AutoMessage[]>().notNull().default([]),
    /** when the rule fires, hand the rest of the conversation to AI or keep it manual */
    thenMode: text().notNull().default("keep"), // keep | agent | human
    priority: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    hits: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.trigger, t.active)],
);

export const automationEvents = pgTable(
  "automation_events",
  {
    id: id(),
    shopId: shopRef(),
    ruleId: uuid().references(() => automationRules.id, { onDelete: "set null" }),
    conversationId: uuid(),
    trigger: text().notNull(),
    input: text(),
    ok: boolean().notNull().default(true),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.createdAt)],
);

// ---------------------------------------------------------------- forms
export interface FormField {
  key: string;
  label: string;
  type: "text" | "textarea" | "phone" | "email" | "number" | "select" | "date" | "checkbox";
  required: boolean;
  options?: string[];
}

export const forms = pgTable(
  "forms",
  {
    id: id(),
    shopId: shopRef(),
    title: text().notNull(),
    description: text().notNull().default(""),
    fields: jsonb().$type<FormField[]>().notNull(),
    successMessage: text().notNull().default(""),
    active: boolean().notNull().default(true),
    submissions: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId)],
);

export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: id(),
    shopId: shopRef(),
    formId: uuid()
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    conversationId: uuid(),
    data: jsonb().$type<Record<string, string | boolean>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.formId, t.createdAt)],
);

// ---------------------------------------------------------------- AI knowledge (retrieval for the agent)
export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: id(),
    shopId: shopRef(),
    source: text().notNull().default("manual"), // manual | faq | dm_history | document
    title: text().notNull(),
    content: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.shopId, t.active),
    index("knowledge_fts").using("gin", sql`to_tsvector('simple', ${t.title} || ' ' || ${t.content})`),
    index("knowledge_trgm").using("gin", sql`${t.content} gin_trgm_ops`),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    shopId: shopRef(),
    conversationId: uuid(),
    channel: text().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cost: money().notNull().default(0),
    tools: jsonb().$type<{ name: string; ok: boolean }[]>().notNull().default([]),
    handoff: text(),
    reply: text(),
    error: text(),
    durationMs: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.createdAt), index().on(t.createdAt)],
);

// ---------------------------------------------------------------- Instagram posts -> products
export interface ExtractedProduct {
  isProduct: boolean;
  confidence: number;
  title: string;
  description: string;
  price: number | null;
  variants: { attributes: Record<string, string>; price: number | null }[];
  category: string | null;
}

export const igMedia = pgTable(
  "ig_media",
  {
    id: id(),
    shopId: shopRef(),
    mediaId: text().notNull(),
    mediaType: text().notNull(),
    caption: text().notNull().default(""),
    mediaUrl: text(),
    thumbnailUrl: text(),
    permalink: text(),
    childUrls: jsonb().$type<string[]>().notNull().default([]),
    postedAt: timestamp({ withTimezone: true }),
    status: text().notNull().default("new"), // new | analyzed | imported | ignored
    extracted: jsonb().$type<ExtractedProduct>(),
    productId: uuid().references(() => products.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.shopId, t.mediaId), index().on(t.shopId, t.status)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    shopId: shopRef(),
    name: text().notNull(),
    segment: text().notNull(),
    message: text().notNull(),
    status: text().notNull().default("draft"), // draft | queued | sending | sent | failed
    recipients: integer().notNull().default(0),
    sentCount: integer().notNull().default(0),
    cost: money().notNull().default(0),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.shopId, t.createdAt)],
);
