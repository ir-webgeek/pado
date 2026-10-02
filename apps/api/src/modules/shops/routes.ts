import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  orders,
  products,
  resolveShopSettings,
  services,
  shopMembers,
  shops,
  shippingMethods,
  staff,
  users,
  walletTransactions,
  workingHours,
} from "@shopino/db";
import { MEMBER_ROLES, PLANS, createShopSchema, normalizeIranPhone, updateShopSettingsSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { authenticate, invalidateShopCache, requireShop } from "../../lib/auth";
import { instagramOAuthConfigured } from "../instagram/oauth";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";

const RESERVED_SLUGS = new Set(["www", "api", "app", "admin", "panel", "shop", "help", "blog", "static", "assets", "booking", "login", "pay"]);

export const shopRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/", { preHandler: authenticate, schema: { body: createShopSchema } }, async (req) => {
      const { name, slug, kind, instagramHandle } = req.body;
      if (RESERVED_SLUGS.has(slug)) throw conflict("slug_taken", "this address is reserved");
      const taken = await ctx.db.query.shops.findFirst({ where: eq(shops.slug, slug), columns: { id: true } });
      if (taken) throw conflict("slug_taken", "this address is taken");

      return ctx.db.transaction(async (tx) => {
        const [shop] = await tx
          .insert(shops)
          // free plan never expires: appointments + static automations are free forever
          .values({ name, slug, kind, ownerId: req.user.sub, igUsername: instagramHandle, plan: "free", planExpiresAt: null })
          .returning();
        const [member] = await tx.insert(shopMembers).values({ shopId: shop!.id, userId: req.user.sub, role: "owner" }).returning();
        await tx.insert(shippingMethods).values([
          { shopId: shop!.id, name: "پست پیشتاز", carrier: "post", price: 90_000, sort: 0 },
          { shopId: shop!.id, name: "تحویل حضوری", carrier: "pickup", price: 0, sort: 1 },
        ]);
        if (kind !== "retail") {
          const owner = await tx.query.users.findFirst({ where: eq(users.id, req.user.sub) });
          await tx.insert(staff).values({ shopId: shop!.id, memberId: member!.id, name: owner?.name ?? name, title: "" });
        }
        await tx.insert(walletTransactions).values({ shopId: shop!.id, kind: "adjustment", amount: 0, balanceAfter: 0, meta: { note: "wallet opened" } });
        await audit(tx, shop!.id, { type: "user", id: req.user.sub }, "shop.create", "shop", shop!.id);
        return { shop: { id: shop!.id, slug: shop!.slug, name: shop!.name, kind: shop!.kind, plan: shop!.plan } };
      });
    });

    app.get("/slug-available", { schema: { querystring: z.object({ slug: z.string() }) } }, async (req) => {
      const slug = req.query.slug.toLowerCase();
      if (RESERVED_SLUGS.has(slug)) return { available: false };
      const taken = await ctx.db.query.shops.findFirst({ where: eq(shops.slug, slug), columns: { id: true } });
      return { available: !taken };
    });

    const shopParams = z.object({ shopId: z.string().uuid() });

    app.get("/:shopId", { preHandler: requireShop(ctx), schema: { params: shopParams } }, async (req) => {
      const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, req.shop.id) });
      if (!shop) throw notFound("shop");
      const { igAccessToken, ...rest } = shop;
      return {
        shop: { ...rest, settings: resolveShopSettings(shop.settings), instagramConnected: Boolean(igAccessToken), instagramOAuth: instagramOAuthConfigured() },
        role: req.shop.role,
        plan: PLANS[shop.plan],
      };
    });

    /** Guided setup: which first-run steps this shop has done, derived from its data (never stored). */
    app.get("/:shopId/setup", { preHandler: requireShop(ctx), schema: { params: shopParams } }, async (req) => {
      const shopId = req.shop.id;
      const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
      if (!shop) throw notFound("shop");
      const settings = resolveShopSettings(shop.settings);
      const one = (table: typeof products | typeof services | typeof workingHours | typeof orders | typeof appointments, extra?: SQL) =>
        ctx.db
          .select({ id: table.id })
          .from(table)
          .where(and(eq(table.shopId, shopId), extra))
          .limit(1)
          .then((r) => r.length > 0);
      const sells = shop.kind !== "services";
      const books = shop.kind !== "retail";
      const [hasProduct, hasService, hasHours, hasOrder, hasBooking] = await Promise.all([
        sells ? one(products, eq(products.status, "active")) : false,
        books ? one(services, eq(services.active, true)) : false,
        books ? one(workingHours) : false,
        sells ? one(orders) : false,
        books ? one(appointments) : false,
      ]);
      const steps = [
        { key: "brand", done: Boolean(shop.logo) || shop.brandColor !== "#d9d0b8", href: "/panel/settings" },
        ...(sells ? [{ key: "product", done: hasProduct, href: "/panel/products" }] : []),
        ...(books ? [{ key: "service", done: hasService, href: "/panel/services" }] : []),
        ...(books ? [{ key: "hours", done: hasHours, href: "/panel/services" }] : []),
        { key: "payment", done: Boolean(settings.cardToCard.cardNumber || shop.settlementIban), href: "/panel/settings?tab=payments" },
        ...(sells ? [{ key: "invoice", done: Boolean(settings.invoice.phone || settings.invoice.address), href: "/panel/settings" }] : []),
        { key: "instagram", done: Boolean(shop.igAccessToken), href: "/panel/settings?tab=integrations" },
        { key: "firstSale", done: hasOrder || hasBooking, href: books ? `/b/${shop.slug}` : `/s/${shop.slug}` },
      ];
      return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
    });

    app.patch(
      "/:shopId/settings",
      { preHandler: requireShop(ctx, "admin"), schema: { params: shopParams, body: updateShopSettingsSchema } },
      async (req) => {
        const { name, kind, brandColor, theme, timezone, logo, telegramChatId, settlementIban, ...nested } = req.body;
        if (timezone) {
          try {
            new Intl.DateTimeFormat("en", { timeZone: timezone });
          } catch {
            throw badRequest("invalid_timezone");
          }
        }
        const current = await ctx.db.query.shops.findFirst({ where: eq(shops.id, req.shop.id), columns: { settings: true } });
        const merged = { ...(current?.settings ?? {}) } as Record<string, unknown>;
        for (const [k, v] of Object.entries(nested)) {
          if (v === undefined) continue;
          merged[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? { ...(merged[k] as object), ...v } : v;
        }
        const [updated] = await ctx.db
          .update(shops)
          .set({ name, kind, brandColor, theme, timezone, logo, telegramChatId, settlementIban, settings: merged })
          .where(eq(shops.id, req.shop.id))
          .returning();
        invalidateShopCache(req.shop.id);
        await audit(ctx.db, req.shop.id, { type: "user", id: req.user.sub }, "shop.settings", "shop", req.shop.id, req.body);
        return { settings: resolveShopSettings(updated!.settings) };
      },
    );

    // ---- team
    app.get("/:shopId/members", { preHandler: requireShop(ctx, "admin"), schema: { params: shopParams } }, async (req) => {
      return ctx.db
        .select({ id: shopMembers.id, role: shopMembers.role, userId: users.id, phone: users.phone, name: users.name })
        .from(shopMembers)
        .innerJoin(users, eq(users.id, shopMembers.userId))
        .where(eq(shopMembers.shopId, req.shop.id));
    });

    app.post(
      "/:shopId/members",
      {
        preHandler: requireShop(ctx, "admin"),
        schema: { params: shopParams, body: z.object({ phone: z.string(), role: z.enum(MEMBER_ROLES).exclude(["owner"]), name: z.string().optional() }) },
      },
      async (req) => {
        const phone = normalizeIranPhone(req.body.phone);
        if (!phone) throw badRequest("invalid_phone");
        const [user] = await ctx.db
          .insert(users)
          .values({ phone, name: req.body.name })
          .onConflictDoUpdate({ target: users.phone, set: { phone } })
          .returning();
        const [member] = await ctx.db
          .insert(shopMembers)
          .values({ shopId: req.shop.id, userId: user!.id, role: req.body.role })
          .onConflictDoUpdate({ target: [shopMembers.shopId, shopMembers.userId], set: { role: req.body.role } })
          .returning();
        invalidateShopCache(req.shop.id);
        await audit(ctx.db, req.shop.id, { type: "user", id: req.user.sub }, "member.upsert", "member", member!.id, { phone, role: req.body.role });
        return member;
      },
    );

    app.delete(
      "/:shopId/members/:memberId",
      { preHandler: requireShop(ctx, "owner"), schema: { params: shopParams.extend({ memberId: z.string().uuid() }) } },
      async (req) => {
        const where = and(eq(shopMembers.id, req.params.memberId), eq(shopMembers.shopId, req.shop.id));
        const member = await ctx.db.query.shopMembers.findFirst({ where });
        if (!member) throw notFound("member");
        if (member.role === "owner") throw badRequest("cannot_remove_owner");
        await ctx.db.delete(shopMembers).where(where);
        invalidateShopCache(req.shop.id);
        return { ok: true };
      },
    );
  };
