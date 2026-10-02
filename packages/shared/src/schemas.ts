import { z } from "zod";
import { APPOINTMENT_STATUSES, ORDER_STATUSES, PAYMENT_METHODS, SALES_CHANNELS, SHOP_KINDS } from "./enums";

export const phoneSchema = z.string().min(10).max(20);
export const idSchema = z.string().uuid();
export const slugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "lowercase letters, digits and dashes");

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const requestOtpSchema = z.object({ phone: phoneSchema });
export const verifyOtpSchema = z.object({ phone: phoneSchema, code: z.string().length(5) });

export const createShopSchema = z.object({
  name: z.string().min(2).max(80),
  slug: slugSchema,
  kind: z.enum(SHOP_KINDS).default("retail"),
  instagramHandle: z.string().max(60).optional(),
});

export const updateShopSettingsSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  kind: z.enum(SHOP_KINDS).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  theme: z.string().max(40).optional(),
  timezone: z.string().max(60).optional(),
  loyalty: z
    .object({ enabled: z.boolean(), tomanPerPoint: z.number().int().min(1000), pointValue: z.number().int().min(0), expiryDays: z.number().int().min(0) })
    .partial()
    .optional(),
  vipRule: z.object({ minOrders: z.number().int().min(1), minSpend: z.number().int().min(0), withinDays: z.number().int().min(1) }).partial().optional(),
  atRiskDays: z.number().int().min(7).max(720).optional(),
  booking: z
    .object({
      slotStepMin: z.number().int().min(5).max(120),
      minNoticeMin: z.number().int().min(0),
      maxAdvanceDays: z.number().int().min(1).max(365),
      cancelWindowMin: z.number().int().min(0),
      autoConfirm: z.boolean(),
      reminderOffsetsMin: z.array(z.number().int().min(5)).max(4),
      customerReschedule: z.boolean(),
      refundToWallet: z.boolean(),
    })
    .partial()
    .optional(),
  agent: z
    .object({
      enabled: z.boolean(),
      tone: z.string().max(400),
      rules: z.string().max(4000),
      neverOfferDiscount: z.boolean(),
      knowledge: z.string().max(20000),
      consultOnWeb: z.boolean(),
      learnedStyle: z.string().max(6000),
    })
    .partial()
    .optional(),
  cardToCard: z.object({ cardNumber: z.string().max(19), holder: z.string().max(80), bank: z.string().max(40) }).partial().optional(),
  pricing: z
    .object({ usdEnabled: z.boolean(), markupPercent: z.number().min(0).max(500), roundTo: z.number().int().min(1).max(1_000_000), autoFetch: z.boolean() })
    .partial()
    .optional(),
  telegramChatId: z.string().max(40).optional(),
  settlementIban: z.string().regex(/^IR\d{24}$/, "Sheba must look like IR + 24 digits").optional(),
});

// ---------- catalog ----------
export const variantInputSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().max(60).optional(),
  attributes: z.record(z.string(), z.string()).default({}),
  price: z.number().int().min(0),
  compareAtPrice: z.number().int().min(0).nullable().optional(),
  priceUsdCents: z.number().int().min(1).nullable().optional(),
  stock: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(3),
});

export const productInputSchema = z.object({
  title: z.string().min(1).max(200),
  slug: slugSchema.optional(),
  description: z.string().max(10000).default(""),
  categoryId: z.string().uuid().nullable().optional(),
  images: z.array(z.string().url().or(z.string().startsWith("/"))).max(20).default([]),
  status: z.enum(["draft", "active", "archived"]).default("active"),
  seoTitle: z.string().max(120).optional(),
  seoDescription: z.string().max(300).optional(),
  variants: z.array(variantInputSchema).min(1),
});

export const categoryInputSchema = z.object({
  name: z.string().min(1).max(80),
  slug: slugSchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
  sort: z.number().int().default(0),
});

export const stockAdjustSchema = z.object({
  variantId: z.string().uuid(),
  delta: z.number().int(),
  reason: z.enum(["purchase", "correction", "damage", "return", "count"]).default("correction"),
  note: z.string().max(200).optional(),
});

// ---------- orders ----------
export const addressSchema = z.object({
  fullName: z.string().min(2).max(80),
  phone: phoneSchema,
  province: z.string().max(60),
  city: z.string().max(60),
  line: z.string().min(5).max(300),
  postalCode: z.string().max(12).optional(),
});

export const orderItemInputSchema = z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(999) });

export const createOrderSchema = z.object({
  items: z.array(orderItemInputSchema).min(1).max(100),
  customer: z.object({ phone: phoneSchema.optional(), name: z.string().max(80).optional(), instagramId: z.string().max(80).optional() }).optional(),
  channel: z.enum(SALES_CHANNELS).default("web"),
  discountCode: z.string().max(40).optional(),
  note: z.string().max(500).optional(),
  reserveMinutes: z.number().int().min(10).max(7 * 24 * 60).default(120),
});

export const completeOrderSchema = z.object({
  address: addressSchema,
  paymentMethod: z.enum(PAYMENT_METHODS).default("gateway"),
  shippingMethodId: z.string().uuid().optional(),
  usePoints: z.number().int().min(0).default(0),
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  trackingCode: z.string().max(60).optional(),
  carrier: z.string().max(40).optional(),
  note: z.string().max(300).optional(),
});

export const discountInputSchema = z.object({
  code: z.string().min(3).max(40).transform((s) => s.toUpperCase()),
  type: z.enum(["percent", "fixed"]),
  value: z.number().int().min(1),
  minOrder: z.number().int().min(0).default(0),
  maxUses: z.number().int().min(1).nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  appliesTo: z.enum(["orders", "appointments", "all"]).default("all"),
  active: z.boolean().default(true),
});

// ---------- appointments ----------
export const serviceInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  categoryId: z.string().uuid().nullable().optional(),
  durationMin: z.number().int().min(5).max(24 * 60),
  bufferBeforeMin: z.number().int().min(0).max(240).default(0),
  bufferAfterMin: z.number().int().min(0).max(240).default(0),
  price: z.number().int().min(0),
  priceFrom: z.boolean().default(false),
  deposit: z
    .object({ type: z.enum(["none", "fixed", "percent"]), value: z.number().int().min(0) })
    .default({ type: "none", value: 0 }),
  capacity: z.number().int().min(1).max(500).default(1),
  onlineBookable: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#aebbd0"),
  image: z.string().optional(),
  active: z.boolean().default(true),
  staffIds: z.array(z.string().uuid()).default([]),
});

export const workingHoursSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startMin: z.number().int().min(0).max(24 * 60),
      endMin: z.number().int().min(0).max(24 * 60),
    }),
  )
  .max(50)
  .refine((rows) => rows.every((r) => r.endMin > r.startMin), "endMin must be after startMin");

export const staffInputSchema = z.object({
  name: z.string().min(1).max(80),
  title: z.string().max(80).default(""),
  phone: z.string().max(20).optional(),
  avatar: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#d9d0b8"),
  memberId: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
  workingHours: workingHoursSchema.optional(),
});

export const timeOffInputSchema = z.object({
  staffId: z.string().uuid().nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().max(200).default(""),
});

export const slotQuerySchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(14).default(1),
});

export const createAppointmentSchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  startsAt: z.coerce.date(),
  customer: z.object({ phone: phoneSchema, name: z.string().min(2).max(80), instagramId: z.string().max(80).optional() }),
  note: z.string().max(500).optional(),
  channel: z.enum(SALES_CHANNELS).default("web"),
  discountCode: z.string().max(40).optional(),
});

export const appointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  reason: z.string().max(300).optional(),
});

export const rescheduleSchema = z.object({ startsAt: z.coerce.date(), staffId: z.string().uuid().optional() });

export const campaignInputSchema = z.object({
  name: z.string().min(1).max(80),
  segment: z.enum(["all", "vip", "regular", "new", "at_risk", "lost"]),
  message: z.string().min(5).max(600),
});

const autoMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal("image"), url: z.string().url(), caption: z.string().max(1000).optional() }),
  z.object({ kind: z.literal("audio"), url: z.string().url() }),
  z.object({ kind: z.literal("video"), url: z.string().url() }),
  z.object({
    kind: z.literal("buttons"),
    text: z.string().min(1).max(640),
    buttons: z.array(z.object({ title: z.string().min(1).max(20), url: z.string().url() })).min(1).max(3),
  }),
  z.object({ kind: z.literal("form"), formId: z.string().uuid(), text: z.string().min(1).max(640) }),
]);

export const AUTOMATION_TRIGGERS = ["comment", "story_reply", "story_mention", "dm_keyword", "first_message"] as const;

export const automationRuleInputSchema = z.object({
  name: z.string().min(1).max(80),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  mediaId: z.string().max(80).nullable().optional(),
  keywords: z.array(z.string().min(1).max(60)).max(30).default([]),
  matchMode: z.enum(["contains", "exact", "any"]).default("contains"),
  publicReply: z.string().max(300).nullable().optional(),
  privateReply: z.string().max(1000).nullable().optional(),
  messages: z.array(autoMessageSchema).max(8).default([]),
  thenMode: z.enum(["keep", "agent", "human"]).default("keep"),
  priority: z.number().int().min(0).max(100).default(0),
  active: z.boolean().default(true),
});

export const formFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "textarea", "phone", "email", "number", "select", "date", "checkbox"]),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(80)).max(30).optional(),
});

export const formInputSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
  fields: z.array(formFieldSchema).min(1).max(30),
  successMessage: z.string().max(500).default(""),
  active: z.boolean().default(true),
});

export const knowledgeInputSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(8000),
  source: z.enum(["manual", "faq", "dm_history", "document"]).default("manual"),
  active: z.boolean().default(true),
});

export const usdRateSchema = z.object({ rate: z.number().int().min(1000).max(100_000_000) });

export const walkInSchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  startsAt: z.coerce.date().optional(),
  customer: z.object({ phone: phoneSchema, name: z.string().min(2).max(80) }),
  note: z.string().max(500).optional(),
  /** skip working-hours checks (still refuses double booking) */
  outsideHours: z.boolean().default(false),
});

export type CreateShopInput = z.infer<typeof createShopSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ServiceInput = z.infer<typeof serviceInputSchema>;
export type StaffInput = z.infer<typeof staffInputSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type ShopSettingsInput = z.infer<typeof updateShopSettingsSchema>;
