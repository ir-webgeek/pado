import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  categories,
  customers,
  orders,
  payments,
  productVariants,
  products,
  resolveShopSettings,
  services,
  shippingMethods,
  shops,
  staff,
  staffServices,
} from "@shopino/db";
import { PAYMENT_METHODS, planHas, completeOrderSchema, createAppointmentSchema, createOrderSchema, rescheduleSchema, slotQuerySchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { TtlCache } from "../../lib/cache";
import { safeEqual } from "../../lib/crypto";
import { conflict, notFound } from "../../lib/errors";
import { saveUpload } from "../../lib/uploads";
import { createOrder, getOrderFull, prepareCheckout } from "../orders/service";
import { attachReceipt, startAppointmentPayment, startOrderPayment, handleGatewayCallback } from "../payments/service";
import { bookAppointment, getSlots, rescheduleAppointment, transitionAppointment } from "../appointments/service";
import { aiAvailable } from "../agent/llm";
import { handleInbound } from "../inbox/pipeline";

type ShopRow = typeof shops.$inferSelect;
const shopBySlug = new TtlCache<ShopRow | null>(15_000);

export const storefrontRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    async function shopOr404(slug: string) {
      let shop = shopBySlug.get(slug);
      if (shop === undefined) {
        shop = (await ctx.db.query.shops.findFirst({ where: eq(shops.slug, slug) })) ?? null;
        shopBySlug.set(slug, shop);
      }
      if (!shop || shop.suspendedAt) throw notFound("shop");
      return shop;
    }

    const slugParams = z.object({ slug: z.string() });

    app.get("/shops/:slug", { schema: { params: slugParams } }, async (req, reply) => {
      const shop = await shopOr404(req.params.slug);
      const settings = resolveShopSettings(shop.settings);
      const [cats, methods] = await Promise.all([
        ctx.db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories).where(eq(categories.shopId, shop.id)).orderBy(categories.sort),
        ctx.db.select().from(shippingMethods).where(and(eq(shippingMethods.shopId, shop.id), eq(shippingMethods.active, true))).orderBy(shippingMethods.sort),
      ]);
      reply.header("cache-control", "public, max-age=30, stale-while-revalidate=300");
      return {
        shop: {
          id: shop.id,
          slug: shop.slug,
          name: shop.name,
          kind: shop.kind,
          logo: shop.logo,
          brandColor: shop.brandColor,
          theme: shop.theme,
          timezone: shop.timezone,
          instagram: shop.igUsername,
          acceptsCardToCard: Boolean(settings.cardToCard.cardNumber),
          loyalty: settings.loyalty.enabled ? { pointValue: settings.loyalty.pointValue } : null,
          landing: shop.landing,
          assistant: settings.agent.consultOnWeb && planHas(shop.plan, "ai_consult") && aiAvailable(),
        },
        categories: cats,
        shippingMethods: methods.map((m) => ({ id: m.id, name: m.name, carrier: m.carrier, price: m.price, freeOver: m.freeOver })),
      };
    });

    app.get(
      "/shops/:slug/products",
      {
        schema: {
          params: slugParams,
          querystring: z
            .object({
              category: z.string().optional(),
              q: z.string().max(80).optional(),
              minPrice: z.coerce.number().int().min(0).optional(),
              maxPrice: z.coerce.number().int().min(0).optional(),
              inStock: z.coerce.boolean().optional(),
              sort: z.enum(["new", "price_asc", "price_desc", "popular"]).default("new"),
              limit: z.coerce.number().int().max(60).default(30),
              offset: z.coerce.number().int().min(0).default(0),
            })
            .catchall(z.string()),
        },
      },
      async (req, reply) => {
        const shop = await shopOr404(req.params.slug);
        const { category, q, minPrice, maxPrice, inStock, sort, limit, offset, ...rest } = req.query;
        // any other query key filters on a variant attribute: ?size=38&color=cream
        const attrFilters = Object.entries(rest).filter(([k, v]) => /^[\p{L}\p{N}_ -]{1,40}$/u.test(k) && typeof v === "string" && v.length <= 60) as [string, string][];
        const cat = category ? await ctx.db.query.categories.findFirst({ where: and(eq(categories.shopId, shop.id), eq(categories.slug, category)) }) : undefined;

        const variantMatch = and(
          eq(productVariants.productId, products.id),
          inStock ? sql`${productVariants.stock} - ${productVariants.reserved} > 0` : undefined,
          minPrice !== undefined ? sql`${productVariants.price} >= ${minPrice}` : undefined,
          maxPrice !== undefined ? sql`${productVariants.price} <= ${maxPrice}` : undefined,
          ...attrFilters.map(([k, v]) => sql`${productVariants.attributes} @> ${JSON.stringify({ [k]: v })}::jsonb`),
        );
        const orderBy =
          sort === "price_asc"
            ? sql`min(${productVariants.price}) asc`
            : sort === "price_desc"
              ? sql`min(${productVariants.price}) desc`
              : sort === "popular"
                ? sql`(select coalesce(sum(oi.quantity),0) from order_items oi where oi.product_id = ${products.id}) desc`
                : sql`${products.createdAt} desc`;
        const rows = await ctx.db
          .select({
            id: products.id,
            title: products.title,
            slug: products.slug,
            images: products.images,
            minPrice: sql<number>`min(${productVariants.price})::bigint`,
            compareAt: sql<number | null>`max(${productVariants.compareAtPrice})::bigint`,
            available: sql<number>`sum(${productVariants.stock} - ${productVariants.reserved})::int`,
          })
          .from(products)
          .innerJoin(productVariants, variantMatch)
          .where(
            and(
              eq(products.shopId, shop.id),
              eq(products.status, "active"),
              cat ? eq(products.categoryId, cat.id) : undefined,
              q ? sql`${products.title} ILIKE ${"%" + q + "%"}` : undefined,
            ),
          )
          .groupBy(products.id)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset);
        reply.header("cache-control", "public, max-age=15, stale-while-revalidate=120");
        return { items: rows.map((r) => ({ ...r, minPrice: Number(r.minPrice), compareAt: r.compareAt ? Number(r.compareAt) : null })) };
      },
    );

    // facets for the product listing page: attribute values and price range of what is on sale
    app.get("/shops/:slug/facets", { schema: { params: slugParams } }, async (req, reply) => {
      const shop = await shopOr404(req.params.slug);
      const rows = await ctx.db
        .select({ attributes: productVariants.attributes, price: productVariants.price })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(eq(products.shopId, shop.id), eq(products.status, "active")));
      const attrs: Record<string, Set<string>> = {};
      for (const r of rows) for (const [k, v] of Object.entries(r.attributes)) (attrs[k] ??= new Set()).add(v);
      const prices = rows.map((r) => r.price);
      reply.header("cache-control", "public, max-age=60");
      return {
        attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b, "fa", { numeric: true }))])),
        price: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
      };
    });

    // AI shopping / booking consultant on the storefront and booking pages
    app.post(
      "/shops/:slug/assistant",
      {
        schema: {
          params: slugParams,
          body: z.object({
            sessionId: z.string().regex(/^[A-Za-z0-9_-]{12,64}$/),
            text: z.string().min(1).max(1000),
            context: z.object({ productSlug: z.string().max(120).optional(), serviceId: z.string().uuid().optional() }).optional(),
          }),
        },
        config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
      },
      async (req) => {
        const shop = await shopOr404(req.params.slug);
        const settings = resolveShopSettings(shop.settings);
        if (!(settings.agent.consultOnWeb && planHas(shop.plan, "ai_consult") && aiAvailable())) throw notFound("assistant");
        let pageContext: string | undefined;
        if (req.body.context?.productSlug) {
          const p = await ctx.db.query.products.findFirst({ where: and(eq(products.shopId, shop.id), eq(products.slug, req.body.context.productSlug)) });
          if (p) pageContext = `product "${p.title}" (use search_products to get its variants and stock)`;
        } else if (req.body.context?.serviceId) {
          const s = await ctx.db.query.services.findFirst({ where: and(eq(services.shopId, shop.id), eq(services.id, req.body.context.serviceId)) });
          if (s) pageContext = `booking page for service "${s.name}" (serviceId ${s.id})`;
        }
        const r = await handleInbound(ctx.db, ctx.queues, ctx.redis, {
          shopId: shop.id,
          channel: "web",
          externalUserId: `web-${req.body.sessionId}`,
          username: "web visitor",
          text: req.body.text,
          pageContext,
        });
        return { reply: r.reply, handoff: Boolean(r.handoff) };
      },
    );

    app.get("/shops/:slug/products/:productSlug", { schema: { params: slugParams.extend({ productSlug: z.string() }) } }, async (req) => {
      const shop = await shopOr404(req.params.slug);
      const p = await ctx.db.query.products.findFirst({
        where: and(eq(products.shopId, shop.id), eq(products.slug, req.params.productSlug), eq(products.status, "active")),
      });
      if (!p) throw notFound("product");
      const variants = await ctx.db
        .select({
          id: productVariants.id,
          attributes: productVariants.attributes,
          price: productVariants.price,
          compareAtPrice: productVariants.compareAtPrice,
          available: sql<number>`${productVariants.stock} - ${productVariants.reserved}`,
        })
        .from(productVariants)
        .where(eq(productVariants.productId, p.id))
        .orderBy(productVariants.position);
      return { product: { ...p, variants } };
    });

    // cart -> order (stock is reserved immediately)
    app.post(
      "/shops/:slug/orders",
      { schema: { params: slugParams, body: createOrderSchema.pick({ items: true, discountCode: true, note: true }) }, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (req) => {
        const shop = await shopOr404(req.params.slug);
        const order = await createOrder(ctx.db, ctx.queues, shop.id, { ...req.body, channel: "web", reserveMinutes: 60 }, { type: "customer" });
        return { code: order.code, token: order.accessToken };
      },
    );

    // ---- order completion / tracking link (the link the agent sends in the DM)
    const orderParams = z.object({ code: z.string() });
    const tokenQuery = z.object({ t: z.string() });

    async function orderWithToken(code: string, token: string) {
      const o = await getOrderFull(ctx.db, { code });
      if (!safeEqual(o.accessToken, token)) throw notFound("order");
      return o;
    }

    app.get("/orders/:code", { schema: { params: orderParams, querystring: tokenQuery } }, async (req) => {
      const o = await orderWithToken(req.params.code, req.query.t);
      const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, o.shopId) });
      const settings = resolveShopSettings(shop!.settings);
      const methods = await ctx.db.select().from(shippingMethods).where(and(eq(shippingMethods.shopId, o.shopId), eq(shippingMethods.active, true))).orderBy(shippingMethods.sort);
      const pending = await ctx.db.query.payments.findFirst({
        where: and(eq(payments.orderId, o.id), inArray(payments.status, ["initiated", "pending_review"]), eq(payments.method, "card_to_card")),
      });
      const { accessToken: _t, customer, events, ...order } = o;
      return {
        order: { ...order, timeline: events.map((e) => ({ type: e.type, at: e.createdAt })) },
        customer: customer ? { name: customer.name, points: customer.points } : null,
        shop: { name: shop!.name, slug: shop!.slug, brandColor: shop!.brandColor, logo: shop!.logo },
        shippingMethods: methods.map((m) => ({ id: m.id, name: m.name, price: m.price, freeOver: m.freeOver })),
        paymentMethods: ["gateway", ...(settings.cardToCard.cardNumber ? ["card_to_card"] : [])],
        loyalty: settings.loyalty.enabled ? { pointValue: settings.loyalty.pointValue } : null,
        pendingCardPayment: pending ? { id: pending.id, status: pending.status, card: settings.cardToCard } : null,
      };
    });

    app.post(
      "/orders/:code/complete",
      { schema: { params: orderParams, querystring: tokenQuery, body: completeOrderSchema }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (req) => {
        const o = await orderWithToken(req.params.code, req.query.t);
        await ctx.db.transaction((tx) => prepareCheckout(tx, o.id, req.body));
        return startOrderPayment(ctx.db, o.id);
      },
    );

    app.post(
      "/payments/:paymentId/receipt",
      { schema: { params: z.object({ paymentId: z.string().uuid() }), querystring: z.object({ code: z.string(), t: z.string() }) }, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (req) => {
        // the order/booking token proves the uploader owns this payment
        const p = await ctx.db.query.payments.findFirst({ where: eq(payments.id, req.params.paymentId) });
        if (!p) throw notFound("payment");
        if (p.orderId) {
          const o = await ctx.db.query.orders.findFirst({ where: eq(orders.id, p.orderId) });
          if (!o || o.code !== req.query.code || !safeEqual(o.accessToken, req.query.t)) throw notFound("payment");
        } else if (p.appointmentId) {
          const a = await ctx.db.query.appointments.findFirst({ where: eq(appointments.id, p.appointmentId) });
          if (!a || a.code !== req.query.code || !safeEqual(a.accessToken, req.query.t)) throw notFound("payment");
        }
        const url = await saveUpload(await req.file(), "receipts");
        await attachReceipt(ctx.db, ctx.queues, p.id, url);
        return { ok: true };
      },
    );

    // ---- services & booking
    app.get("/shops/:slug/services", { schema: { params: slugParams } }, async (req, reply) => {
      const shop = await shopOr404(req.params.slug);
      const [svc, team, links] = await Promise.all([
        ctx.db
          .select()
          .from(services)
          .where(and(eq(services.shopId, shop.id), eq(services.active, true), eq(services.onlineBookable, true)))
          .orderBy(asc(services.sort)),
        ctx.db.select({ id: staff.id, name: staff.name, title: staff.title, avatar: staff.avatar, color: staff.color }).from(staff).where(and(eq(staff.shopId, shop.id), eq(staff.active, true))).orderBy(staff.sort),
        ctx.db.select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId }).from(staffServices).innerJoin(staff, eq(staff.id, staffServices.staffId)).where(eq(staff.shopId, shop.id)),
      ]);
      reply.header("cache-control", "public, max-age=30");
      return {
        services: svc.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          durationMin: s.durationMin,
          price: s.price,
          priceFrom: s.priceFrom,
          deposit: s.deposit,
          capacity: s.capacity,
          color: s.color,
          image: s.image,
          staffIds: links.filter((l) => l.serviceId === s.id).map((l) => l.staffId),
        })),
        staff: team,
      };
    });

    app.get("/shops/:slug/slots", { schema: { params: slugParams, querystring: slotQuerySchema } }, async (req) => {
      const shop = await shopOr404(req.params.slug);
      return { days: await getSlots(ctx.db, shop.id, req.query) };
    });

    app.post(
      "/shops/:slug/bookings",
      { schema: { params: slugParams, body: createAppointmentSchema.omit({ channel: true }) }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (req) => {
        const shop = await shopOr404(req.params.slug);
        const svc = await ctx.db.query.services.findFirst({ where: and(eq(services.id, req.body.serviceId), eq(services.shopId, shop.id)) });
        if (!svc?.onlineBookable) throw notFound("service");
        const appt = await bookAppointment(ctx.db, ctx.queues, shop.id, { ...req.body, channel: "web" }, { type: "customer" });
        return { code: appt.code, token: appt.accessToken, status: appt.status, depositAmount: appt.depositAmount };
      },
    );

    async function bookingWithToken(code: string, token: string) {
      const a = await ctx.db.query.appointments.findFirst({ where: eq(appointments.code, code) });
      if (!a || !safeEqual(a.accessToken, token)) throw notFound("booking");
      return a;
    }

    app.get("/bookings/:code", { schema: { params: orderParams, querystring: tokenQuery } }, async (req) => {
      const a = await bookingWithToken(req.params.code, req.query.t);
      const [svc, st, shop, cust] = await Promise.all([
        ctx.db.query.services.findFirst({ where: eq(services.id, a.serviceId) }),
        ctx.db.query.staff.findFirst({ where: eq(staff.id, a.staffId) }),
        ctx.db.query.shops.findFirst({ where: eq(shops.id, a.shopId) }),
        ctx.db.query.customers.findFirst({ where: eq(customers.id, a.customerId) }),
      ]);
      const settings = resolveShopSettings(shop!.settings);
      const { accessToken: _t, internalNote: _n, ...booking } = a;
      return {
        booking,
        service: { id: svc!.id, name: svc!.name, durationMin: svc!.durationMin },
        staff: { id: st!.id, name: st!.name, title: st!.title },
        customer: { name: cust?.name },
        shop: { name: shop!.name, slug: shop!.slug, brandColor: shop!.brandColor, timezone: shop!.timezone },
        policy: { cancelWindowMin: settings.booking.cancelWindowMin },
        paymentMethods: ["gateway", ...(settings.cardToCard.cardNumber ? ["card_to_card"] : [])],
        card: settings.cardToCard.cardNumber ? settings.cardToCard : null,
      };
    });

    app.post(
      "/bookings/:code/pay",
      { schema: { params: orderParams, querystring: tokenQuery, body: z.object({ method: z.enum(PAYMENT_METHODS).default("gateway") }) } },
      async (req) => {
        const a = await bookingWithToken(req.params.code, req.query.t);
        return startAppointmentPayment(ctx.db, a.id, req.body.method);
      },
    );

    app.post(
      "/bookings/:code/cancel",
      { schema: { params: orderParams, querystring: tokenQuery, body: z.object({ reason: z.string().max(300).optional() }) } },
      async (req) => {
        const a = await bookingWithToken(req.params.code, req.query.t);
        const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, a.shopId) });
        const { booking } = resolveShopSettings(shop!.settings);
        if (a.startsAt.getTime() - Date.now() < booking.cancelWindowMin * 60_000) {
          throw conflict("too_late", "online cancellation window has passed - please contact the shop");
        }
        const updated = await transitionAppointment(ctx.db, ctx.queues, a.shopId, a.id, "cancelled", { type: "customer" }, req.body.reason, "customer");
        return { status: updated.status };
      },
    );

    app.post("/bookings/:code/reschedule", { schema: { params: orderParams, querystring: tokenQuery, body: rescheduleSchema } }, async (req) => {
      const a = await bookingWithToken(req.params.code, req.query.t);
      const updated = await rescheduleAppointment(ctx.db, ctx.queues, a.shopId, a.id, req.body, { type: "customer" }, false);
      return { startsAt: updated.startsAt, staffId: updated.staffId };
    });
  };

export const payCallbackRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/callback/:provider", { schema: { params: z.object({ provider: z.string() }), querystring: z.record(z.string(), z.string()) } }, async (req, reply) => {
      const { redirect } = await handleGatewayCallback(ctx.db, ctx.queues, req.params.provider, req.query);
      return reply.redirect(redirect, 303);
    });
  };
