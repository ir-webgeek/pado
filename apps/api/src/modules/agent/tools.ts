import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { orders, productVariants, products, services, staff, staffServices, type Database } from "@shopino/db";
import { addDaysIso, formatJalali, zonedIsoDate } from "@shopino/shared";
import { env } from "../../config";
import { AppError } from "../../lib/errors";
import type { Queues } from "../../lib/queues";
import { bookAppointment, getSlots } from "../appointments/service";
import { variantLabel } from "../catalog/service";
import { createOrder } from "../orders/service";
import { searchKnowledge } from "../knowledge/search";

export interface AgentToolContext {
  db: Database;
  queues: Queues;
  shopId: string;
  timezone: string;
  conversationId: string;
  customer: { instagramId?: string; name?: string | null; phone?: string | null; username?: string | null };
  channel: "instagram" | "telegram" | "web" | "agent";
  /** set when a tool decides a human must take over */
  handoff?: string;
  /** every tool call of this run, for the admin log */
  toolLog: { name: string; ok: boolean }[];
}

interface ToolDef<S extends z.ZodType> {
  tool: BetaTool;
  input: S;
  run: (ctx: AgentToolContext, input: z.infer<S>) => Promise<unknown>;
}

const def = <S extends z.ZodType>(d: ToolDef<S>) => d;

const orderLink = (o: { code: string; accessToken: string }) => `${env.PUBLIC_WEB_URL}/o/${o.code}?t=${o.accessToken}`;
const bookingLink = (a: { code: string; accessToken: string }) => `${env.PUBLIC_WEB_URL}/b/booking/${a.code}?t=${a.accessToken}`;

const searchProducts = def({
  tool: {
    name: "search_products",
    description:
      "Search the shop's active catalog by words from the customer's message (name, color, type). Returns products with every variant's live price (Toman) and available stock. Always call this before quoting a price or availability.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "search words; empty string lists newest products" }, limit: { type: "integer", minimum: 1, maximum: 10 } },
      required: ["query"],
    },
  },
  input: z.object({ query: z.string().max(100), limit: z.number().int().min(1).max(10).optional() }),
  async run(ctx, { query, limit }) {
    const words = query.split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
    const rows = await ctx.db
      .select({ id: products.id, title: products.title, description: products.description })
      .from(products)
      .where(
        and(
          eq(products.shopId, ctx.shopId),
          eq(products.status, "active"),
          words.length ? or(...words.map((w) => or(ilike(products.title, `%${w}%`), ilike(products.description, `%${w}%`)))) : undefined,
        ),
      )
      .orderBy(words.length ? sql`similarity(${products.title}, ${query}) desc` : sql`${products.createdAt} desc`)
      .limit(limit ?? 5);
    const out = [];
    for (const p of rows) {
      const vs = await ctx.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, p.id))
        .orderBy(productVariants.position);
      out.push({
        productId: p.id,
        title: p.title,
        description: p.description.slice(0, 300),
        variants: vs.map((v) => ({ variantId: v.id, label: variantLabel(v.attributes) || "default", price: v.price, available: v.stock - v.reserved })),
      });
    }
    return { products: out };
  },
});

const createOrderTool = def({
  tool: {
    name: "create_order",
    description:
      "Create an order once the customer clearly wants to buy specific variants. Stock is reserved for 2 hours. Returns a secure link where the customer enters address and pays - send that link to the customer. Never ask for card numbers in chat.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { variantId: { type: "string" }, quantity: { type: "integer", minimum: 1 } }, required: ["variantId", "quantity"] },
          minItems: 1,
        },
        customerName: { type: "string" },
        customerPhone: { type: "string", description: "Iranian mobile if the customer shared it" },
      },
      required: ["items"],
    },
  },
  input: z.object({
    items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(20) })).min(1).max(20),
    customerName: z.string().max(80).optional(),
    customerPhone: z.string().max(20).optional(),
  }),
  async run(ctx, input) {
    const order = await createOrder(
      ctx.db,
      ctx.queues,
      ctx.shopId,
      {
        items: input.items,
        channel: ctx.channel === "instagram" ? "instagram" : "agent",
        reserveMinutes: 120,
        customer: {
          instagramId: ctx.customer.instagramId,
          name: input.customerName ?? ctx.customer.name ?? undefined,
          phone: input.customerPhone ?? ctx.customer.phone ?? undefined,
        },
      },
      { type: "agent" },
      ctx.conversationId,
    );
    return { orderCode: order.code, total: order.total, reservedMinutes: 120, link: orderLink(order) };
  },
});

const orderStatus = def({
  tool: {
    name: "order_status",
    description: "Look up an order by its code (e.g. SHP-XXXXXXXXXX) to tell the customer its status and tracking code.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  input: z.object({ code: z.string().max(20) }),
  async run(ctx, { code }) {
    const o = await ctx.db.query.orders.findFirst({ where: and(eq(orders.shopId, ctx.shopId), eq(orders.code, code.toUpperCase())) });
    if (!o) return { found: false };
    return { found: true, status: o.status, paymentStatus: o.paymentStatus, trackingCode: o.trackingCode, carrier: o.carrier, total: o.total, link: orderLink(o) };
  },
});

const listServices = def({
  tool: {
    name: "list_services",
    description: "List bookable services (appointments) with duration, price in Toman, deposit rule and which staff provide them.",
    input_schema: { type: "object", properties: {} },
  },
  input: z.object({}),
  async run(ctx) {
    const rows = await ctx.db
      .select()
      .from(services)
      .where(and(eq(services.shopId, ctx.shopId), eq(services.active, true), eq(services.onlineBookable, true)))
      .orderBy(services.sort);
    const links = await ctx.db
      .select({ serviceId: staffServices.serviceId, staffId: staff.id, name: staff.name })
      .from(staffServices)
      .innerJoin(staff, eq(staff.id, staffServices.staffId))
      .where(and(eq(staff.shopId, ctx.shopId), eq(staff.active, true)));
    return {
      services: rows.map((s) => ({
        serviceId: s.id,
        name: s.name,
        description: s.description.slice(0, 200),
        durationMin: s.durationMin,
        price: s.price,
        priceFrom: s.priceFrom,
        deposit: s.deposit,
        groupCapacity: s.capacity > 1 ? s.capacity : undefined,
        staff: links.filter((l) => l.serviceId === s.id).map((l) => ({ staffId: l.staffId, name: l.name })),
      })),
    };
  },
});

const findSlots = def({
  tool: {
    name: "find_slots",
    description:
      "Find free appointment times for a service. `date` is YYYY-MM-DD (Gregorian) in the shop's timezone; searches up to `days` days from it. Optionally restrict to one staff member. Present at most a few options to the customer in their calendar (Jalali for Persian speakers).",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        days: { type: "integer", minimum: 1, maximum: 7 },
        staffId: { type: "string" },
      },
      required: ["serviceId", "date"],
    },
  },
  input: z.object({ serviceId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.number().int().min(1).max(7).optional(), staffId: z.string().uuid().optional() }),
  async run(ctx, input) {
    const days = await getSlots(ctx.db, ctx.shopId, { serviceId: input.serviceId, staffId: input.staffId, date: input.date, days: input.days ?? 3 });
    return {
      timezone: ctx.timezone,
      days: days
        .filter((d) => d.slots.length)
        .map((d) => ({
          date: d.date,
          jalali: formatJalali(`${d.date}T12:00:00Z`, { weekday: "long", day: "numeric", month: "long" }, ctx.timezone),
          // keep the list short for the model; it can ask for more days
          times: d.slots.slice(0, 12).map((s) => ({
            startsAt: s.startsAt,
            local: new Intl.DateTimeFormat("en-GB", { timeZone: ctx.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s.startsAt)),
            staffIds: s.staffIds,
            seatsLeft: s.seatsLeft,
          })),
        })),
    };
  },
});

const bookTool = def({
  tool: {
    name: "book_appointment",
    description:
      "Book an appointment at an exact `startsAt` (ISO timestamp from find_slots). Requires the customer's name and mobile number. Returns the booking code, whether a deposit is due, and a link for the customer to view, pay the deposit, reschedule or cancel.",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        startsAt: { type: "string" },
        staffId: { type: "string" },
        customerName: { type: "string" },
        customerPhone: { type: "string" },
        note: { type: "string" },
      },
      required: ["serviceId", "startsAt", "customerName", "customerPhone"],
    },
  },
  input: z.object({
    serviceId: z.string().uuid(),
    startsAt: z.coerce.date(),
    staffId: z.string().uuid().optional(),
    customerName: z.string().min(2).max(80),
    customerPhone: z.string().max(20),
    note: z.string().max(500).optional(),
  }),
  async run(ctx, input) {
    const appt = await bookAppointment(
      ctx.db,
      ctx.queues,
      ctx.shopId,
      {
        serviceId: input.serviceId,
        staffId: input.staffId,
        startsAt: input.startsAt,
        note: input.note,
        channel: ctx.channel === "instagram" ? "instagram" : "agent",
        customer: { name: input.customerName, phone: input.customerPhone, instagramId: ctx.customer.instagramId },
      },
      { type: "agent" },
      { conversationId: ctx.conversationId },
    );
    return {
      bookingCode: appt.code,
      status: appt.status,
      depositDue: appt.depositAmount,
      depositHoldMinutes: appt.depositAmount ? 20 : undefined,
      link: bookingLink(appt),
    };
  },
});

const knowledgeTool = def({
  tool: {
    name: "search_knowledge",
    description:
      "Search the shop's own knowledge base (policies, shipping, returns, sizing, care instructions, FAQs and answers the team gave before). Use it for any question that is not about live price/stock/free times.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  input: z.object({ query: z.string().min(1).max(300) }),
  async run(ctx, { query }) {
    const rows = await searchKnowledge(ctx.db, ctx.shopId, query, 5);
    return { results: rows.map((r) => ({ title: r.title, content: r.content })) };
  },
});

const todayTool = def({
  tool: {
    name: "today",
    description: "Get today's date in the shop timezone (Gregorian YYYY-MM-DD and Jalali) to resolve relative dates like 'tomorrow' or 'next Saturday'.",
    input_schema: { type: "object", properties: {} },
  },
  input: z.object({}),
  async run(ctx) {
    const today = zonedIsoDate(new Date(), ctx.timezone);
    return {
      today,
      weekday: new Intl.DateTimeFormat("en", { timeZone: ctx.timezone, weekday: "long" }).format(new Date()),
      jalali: formatJalali(new Date(), { dateStyle: "full" }, ctx.timezone),
      next7: Array.from({ length: 7 }, (_, i) => addDaysIso(today, i + 1)),
    };
  },
});

const handoff = def({
  tool: {
    name: "handoff_to_human",
    description:
      "Hand the conversation to the shop team when you cannot answer from the tools, the customer asks for a person, wants a discount or refund, complains, or anything sensitive. Tell the customer a teammate will reply soon.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
  input: z.object({ reason: z.string().max(300) }),
  async run(ctx, { reason }) {
    ctx.handoff = reason;
    return { ok: true };
  },
});

export const AGENT_TOOLS = [searchProducts, createOrderTool, orderStatus, listServices, findSlots, bookTool, knowledgeTool, todayTool, handoff] as ToolDef<z.ZodType>[];

/** Retail-only shops don't need booking tools and vice versa - fewer tools = better tool choice. */
export function toolsFor(kind: "retail" | "services" | "hybrid") {
  const retail = new Set(["search_products", "create_order", "order_status"]);
  const booking = new Set(["list_services", "find_slots", "book_appointment"]);
  return AGENT_TOOLS.filter((t) => (kind === "retail" ? !booking.has(t.tool.name) : kind === "services" ? !retail.has(t.tool.name) : true));
}

export async function runTool(ctx: AgentToolContext, name: string, rawInput: unknown): Promise<{ content: string; isError: boolean }> {
  const t = AGENT_TOOLS.find((x) => x.tool.name === name);
  if (!t) return { content: `unknown tool ${name}`, isError: true };
  const parsed = t.input.safeParse(rawInput);
  if (!parsed.success) {
    ctx.toolLog.push({ name, ok: false });
    return { content: `invalid input: ${z.prettifyError(parsed.error)}`, isError: true };
  }
  try {
    const content = JSON.stringify(await t.run(ctx, parsed.data));
    ctx.toolLog.push({ name, ok: true });
    return { content, isError: false };
  } catch (err) {
    ctx.toolLog.push({ name, ok: false });
    // business errors (out of stock, slot taken) are useful to the model; hide internals
    if (err instanceof AppError) return { content: JSON.stringify({ error: err.code, message: err.message }), isError: true };
    throw err;
  }
}
