import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { igMedia, shops } from "@shopino/db";
import { badRequest } from "../../lib/errors";
import { accountStatus, checkAccount, refreshShopToken, resubscribeWebhooks } from "./account";
import type { Ctx } from "../../lib/context";
import { requireFeature, requireShop } from "../../lib/auth";
import { aiAvailable, assertAiReady } from "../agent/llm";
import { addManualMedia, importAsProduct, importMany, scanCaptions, syncMedia } from "./importer";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const instagramImportRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    // view: products (scanned, look like products) | others (scanned non-products and unscanned) | imported | ignored
    const VIEWS = ["products", "others", "imported", "ignored"] as const;
    const isProduct = sql`coalesce((${igMedia.extracted}->>'isProduct')::boolean, false)`;
    const viewWhere = (view: (typeof VIEWS)[number]) =>
      view === "products"
        ? and(eq(igMedia.status, "analyzed"), sql`${isProduct}`)
        : view === "others"
          ? or(eq(igMedia.status, "new"), and(eq(igMedia.status, "analyzed"), sql`not ${isProduct}`))
          : eq(igMedia.status, view);
    app.get(
      "/:shopId/instagram/media",
      {
        preHandler: requireShop(ctx),
        schema: { params, querystring: z.object({ status: z.enum(["new", "analyzed", "imported", "ignored"]).optional(), view: z.enum(VIEWS).optional() }) },
      },
      async (req) =>
        ctx.db
          .select()
          .from(igMedia)
          .where(
            and(
              eq(igMedia.shopId, req.shop.id),
              req.query.view ? viewWhere(req.query.view) : req.query.status ? eq(igMedia.status, req.query.status) : undefined,
            ),
          )
          .orderBy(desc(igMedia.postedAt))
          .limit(200),
    );
    app.get("/:shopId/instagram/media/counts", { preHandler: requireShop(ctx), schema: { params } }, async (req) => {
      const [row] = await ctx.db
        .select({
          products: sql<number>`count(*) filter (where ${igMedia.status} = 'analyzed' and ${isProduct})::int`,
          others: sql<number>`count(*) filter (where ${igMedia.status} = 'new' or (${igMedia.status} = 'analyzed' and not ${isProduct}))::int`,
          imported: sql<number>`count(*) filter (where ${igMedia.status} = 'imported')::int`,
          ignored: sql<number>`count(*) filter (where ${igMedia.status} = 'ignored')::int`,
          aiScanned: sql<number>`count(*) filter (where ${igMedia.extracted}->>'source' = 'ai')::int`,
        })
        .from(igMedia)
        .where(eq(igMedia.shopId, req.shop.id));
      return { ...row!, aiAvailable: aiAvailable() };
    });
    // free caption scan (no AI): instant, also runs on every sync
    app.post("/:shopId/instagram/scan", { preHandler: requireShop(ctx, "staff"), schema: { params, body: z.object({ ids: z.array(z.string().uuid()).max(200).optional() }) } }, async (req) =>
      scanCaptions(ctx.db, req.shop.id, req.body.ids),
    );
    app.post(
      "/:shopId/instagram/import-bulk",
      {
        preHandler: requireShop(ctx, "staff"),
        schema: { params, body: z.object({ ids: z.array(z.string().uuid()).min(1).max(30), status: z.enum(["draft", "active"]).default("draft"), stock: z.number().int().min(0).max(10_000).default(1) }) },
      },
      async (req) => importMany(ctx.db, req.shop, req.body.ids, { status: req.body.status, stock: req.body.stock }, req.user.sub),
    );
    app.post("/:shopId/instagram/sync", { preHandler: requireShop(ctx, "admin"), schema: { params }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) =>
      syncMedia(ctx.db, req.shop.id),
    );
    app.post(
      "/:shopId/instagram/media/manual",
      { preHandler: requireShop(ctx, "staff"), schema: { params, body: z.object({ caption: z.string().max(5000), imageUrls: z.array(z.string().url()).min(1).max(10) }) } },
      async (req) => addManualMedia(ctx.db, req.shop.id, req.body),
    );
    // AI: detect which posts are products and extract title / price / sizes (runs in the worker)
    app.post("/:shopId/instagram/analyze", { preHandler: requireShop(ctx, "admin"), schema: { params, body: z.object({ ids: z.array(z.string().uuid()).max(50).optional() }) } }, async (req) => {
      requireFeature(req.shop, "ig_import");
      await assertAiReady(ctx.db, req.shop.id);
      const rows = await ctx.db
        .select({ id: igMedia.id })
        .from(igMedia)
        // default: everything not imported that has only the free caption scan
        .where(
          and(
            eq(igMedia.shopId, req.shop.id),
            req.body.ids?.length
              ? inArray(igMedia.id, req.body.ids)
              : and(inArray(igMedia.status, ["new", "analyzed"]), sql`coalesce(${igMedia.extracted}->>'source', '') <> 'ai'`),
          ),
        )
        .limit(50);
      const ids = rows.map((r) => r.id);
      if (ids.length) await ctx.queues.add("instagram.analyze", { shopId: req.shop.id, mediaRowIds: ids });
      return { queued: ids.length };
    });
    app.post(
      "/:shopId/instagram/media/:id/import",
      {
        preHandler: requireShop(ctx, "staff"),
        schema: {
          params: withId,
          body: z.object({
            title: z.string().min(1).max(200),
            description: z.string().max(10000).default(""),
            price: z.number().int().min(0),
            categoryName: z.string().max(80).optional(),
            status: z.enum(["draft", "active"]).default("draft"),
            variants: z.array(z.object({ attributes: z.record(z.string(), z.string()), price: z.number().int().min(0), stock: z.number().int().min(0) })).max(50).default([]),
          }),
        },
      },
      async (req) => importAsProduct(ctx.db, req.shop, req.params.id, req.body, req.user.sub),
    );
    // ---- connected account management
    app.get("/:shopId/instagram/account", { preHandler: requireShop(ctx, "staff"), schema: { params } }, async (req) => {
      const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, req.shop.id) });
      return accountStatus(ctx.db, shop!);
    });
    const action = (fn: (shopId: string) => Promise<unknown>) => async (req: { shop: { id: string } }) => {
      try {
        return { ok: true, result: await fn(req.shop.id) };
      } catch (err) {
        throw badRequest("instagram_error", (err as Error).message);
      }
    };
    app.post("/:shopId/instagram/account/check", { preHandler: requireShop(ctx, "admin"), schema: { params }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, action((id) => checkAccount(ctx.db, id)));
    app.post("/:shopId/instagram/account/refresh-token", { preHandler: requireShop(ctx, "admin"), schema: { params }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, action((id) => refreshShopToken(ctx.db, id)));
    app.post("/:shopId/instagram/account/resubscribe", { preHandler: requireShop(ctx, "admin"), schema: { params }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, action((id) => resubscribeWebhooks(ctx.db, id)));

    app.post("/:shopId/instagram/media/:id/ignore", { preHandler: requireShop(ctx, "staff"), schema: { params: withId } }, async (req) => {
      await ctx.db.update(igMedia).set({ status: "ignored" }).where(and(eq(igMedia.id, req.params.id), eq(igMedia.shopId, req.shop.id)));
      return { ok: true };
    });
  };
