import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { igMedia } from "@shopino/db";
import type { Ctx } from "../../lib/context";
import { requireFeature, requireShop } from "../../lib/auth";
import { assertAiReady } from "../agent/llm";
import { addManualMedia, importAsProduct, syncMedia } from "./importer";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const instagramImportRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/instagram/media", { preHandler: requireShop(ctx), schema: { params, querystring: z.object({ status: z.enum(["new", "analyzed", "imported", "ignored"]).optional() }) } }, async (req) =>
      ctx.db
        .select()
        .from(igMedia)
        .where(and(eq(igMedia.shopId, req.shop.id), req.query.status ? eq(igMedia.status, req.query.status) : undefined))
        .orderBy(desc(igMedia.postedAt))
        .limit(200),
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
        .where(and(eq(igMedia.shopId, req.shop.id), req.body.ids?.length ? inArray(igMedia.id, req.body.ids) : eq(igMedia.status, "new")))
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
    app.post("/:shopId/instagram/media/:id/ignore", { preHandler: requireShop(ctx, "staff"), schema: { params: withId } }, async (req) => {
      await ctx.db.update(igMedia).set({ status: "ignored" }).where(and(eq(igMedia.id, req.params.id), eq(igMedia.shopId, req.shop.id)));
      return { ok: true };
    });
  };
