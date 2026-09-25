import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveShopSettings, shopMembers, shops, shippingMethods, staff, users, walletTransactions } from "@shopino/db";
import { MEMBER_ROLES, PLANS, createShopSchema, normalizeIranPhone, updateShopSettingsSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { authenticate, invalidateShopCache, requireShop } from "../../lib/auth";
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
          .values({ name, slug, kind, ownerId: req.user.sub, igUsername: instagramHandle, planExpiresAt: new Date(Date.now() + 14 * 86400_000) })
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
        shop: { ...rest, settings: resolveShopSettings(shop.settings), instagramConnected: Boolean(igAccessToken) },
        role: req.shop.role,
        plan: PLANS[shop.plan],
      };
    });

    app.patch(
      "/:shopId/settings",
      { preHandler: requireShop(ctx, "admin"), schema: { params: shopParams, body: updateShopSettingsSchema } },
      async (req) => {
        const { name, kind, brandColor, theme, timezone, telegramChatId, ...nested } = req.body;
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
          .set({ name, kind, brandColor, theme, timezone, telegramChatId, settings: merged })
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
