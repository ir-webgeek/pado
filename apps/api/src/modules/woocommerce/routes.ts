import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { shops, wooImports } from "@shopino/db";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { assertPublicHttpsUrl } from "../../lib/safe-url";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { storeBase, wooCurrency, wooGet } from "./client";
import { unitForCurrency } from "./import";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });
// a run whose worker died is not "running" forever: after this it no longer blocks a new import
const STALE_MS = 2 * 3600_000;

const connectBody = z.object({
  url: z.string().trim().url().max(300),
  key: z.string().trim().regex(/^ck_[A-Za-z0-9]+$/, "consumer key starts with ck_").max(100),
  secret: z.string().trim().regex(/^cs_[A-Za-z0-9]+$/, "consumer secret starts with cs_").max(100),
});
const importBody = z.object({
  unit: z.enum(["toman", "rial"]),
  defaultStock: z.number().int().min(0).max(100_000).default(0),
  status: z.enum(["active", "draft"]).default("draft"),
});

export const woocommerceRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/woocommerce", { preHandler: requireShop(ctx, "admin"), schema: { params } }, async (req) => {
      const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, req.shop.id), columns: { wooUrl: true, wooConsumerKey: true } });
      const imports = await ctx.db.select().from(wooImports).where(eq(wooImports.shopId, req.shop.id)).orderBy(desc(wooImports.createdAt)).limit(5);
      return { connected: Boolean(shop?.wooConsumerKey), url: shop?.wooUrl ?? null, imports };
    });

    app.post("/:shopId/woocommerce/connect", { preHandler: requireShop(ctx, "admin"), schema: { params, body: connectBody } }, async (req) => {
      let url: string;
      try {
        url = storeBase((await assertPublicHttpsUrl(req.body.url)).toString());
      } catch (err) {
        throw badRequest("woo_bad_url", (err as Error).message);
      }
      const creds = { url, key: req.body.key, secret: req.body.secret };
      let total: number;
      try {
        total = (await wooGet<unknown[]>(creds, "products", { per_page: 1 })).total;
      } catch (err) {
        throw badRequest("woo_unreachable", (err as Error).message.slice(0, 300));
      }
      const currency = await wooCurrency(creds);
      await ctx.db.update(shops).set({ wooUrl: url, wooConsumerKey: creds.key, wooConsumerSecret: creds.secret }).where(eq(shops.id, req.shop.id));
      return { connected: true, url, products: total, currency, suggestedUnit: unitForCurrency(currency) };
    });

    app.delete("/:shopId/woocommerce", { preHandler: requireShop(ctx, "admin"), schema: { params } }, async (req) => {
      await ctx.db.update(shops).set({ wooUrl: null, wooConsumerKey: null, wooConsumerSecret: null }).where(eq(shops.id, req.shop.id));
      return { ok: true };
    });

    app.post("/:shopId/woocommerce/import", { preHandler: requireShop(ctx, "admin"), schema: { params, body: importBody } }, async (req) => {
      const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, req.shop.id), columns: { wooConsumerKey: true } });
      if (!shop?.wooConsumerKey) throw badRequest("woo_not_connected");
      const busy = await ctx.db.query.wooImports.findFirst({
        where: and(eq(wooImports.shopId, req.shop.id), inArray(wooImports.status, ["queued", "running"])),
        orderBy: desc(wooImports.createdAt),
      });
      if (busy && Date.now() - busy.createdAt.getTime() < STALE_MS) throw conflict("woo_import_running");
      if (busy) await ctx.db.update(wooImports).set({ status: "failed", finishedAt: new Date() }).where(and(eq(wooImports.shopId, req.shop.id), inArray(wooImports.status, ["queued", "running"]), lt(wooImports.createdAt, new Date(Date.now() - STALE_MS))));
      const [row] = await ctx.db.insert(wooImports).values({ shopId: req.shop.id, options: req.body, createdBy: req.user.sub }).returning();
      // one attempt: the run records its own failures, and a retry would find the row no longer queued
      await ctx.queues.add("woocommerce.import", { importId: row!.id }, { attempts: 1 });
      return row!;
    });

    app.get("/:shopId/woocommerce/imports/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      const row = await ctx.db.query.wooImports.findFirst({ where: and(eq(wooImports.id, req.params.id), eq(wooImports.shopId, req.shop.id)) });
      if (!row) throw notFound("import");
      return row;
    });
  };
