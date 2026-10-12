import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { igComments, knowledgeEntries } from "@shopino/db";
import { knowledgeInputSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { invalidateShopCache, requireFeature, requireShop } from "../../lib/auth";
import { notFound } from "../../lib/errors";
import { assertAiReady } from "../agent/llm";
import { learnFromDms } from "./learn";
import { searchKnowledge } from "./search";
import { ragSourcesOf } from "../agent/agent";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const knowledgeRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/knowledge", { preHandler: requireShop(ctx), schema: { params } }, async (req) =>
      ctx.db.select().from(knowledgeEntries).where(eq(knowledgeEntries.shopId, req.shop.id)).orderBy(desc(knowledgeEntries.updatedAt)),
    );
    app.post("/:shopId/knowledge", { preHandler: requireShop(ctx, "admin"), schema: { params, body: knowledgeInputSchema } }, async (req) => {
      const [row] = await ctx.db.insert(knowledgeEntries).values({ ...req.body, shopId: req.shop.id }).returning();
      return row;
    });
    // bulk FAQ import: "Q?\nA\n\nQ?\nA" blocks separated by blank lines
    app.post("/:shopId/knowledge/bulk", { preHandler: requireShop(ctx, "admin"), schema: { params, body: z.object({ text: z.string().min(3).max(100_000) }) } }, async (req) => {
      const blocks = req.body.text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
      const rows = blocks.map((b) => {
        const [first, ...rest] = b.split("\n");
        return { shopId: req.shop.id, source: "faq", title: first!.slice(0, 200), content: (rest.join("\n") || first!).slice(0, 8000) };
      });
      if (rows.length) await ctx.db.insert(knowledgeEntries).values(rows);
      return { added: rows.length };
    });
    app.put("/:shopId/knowledge/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: knowledgeInputSchema } }, async (req) => {
      const [row] = await ctx.db
        .update(knowledgeEntries)
        .set(req.body)
        .where(and(eq(knowledgeEntries.id, req.params.id), eq(knowledgeEntries.shopId, req.shop.id)))
        .returning();
      if (!row) throw notFound("entry");
      return row;
    });
    app.delete("/:shopId/knowledge/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      await ctx.db.delete(knowledgeEntries).where(and(eq(knowledgeEntries.id, req.params.id), eq(knowledgeEntries.shopId, req.shop.id)));
      return { ok: true };
    });
    app.get("/:shopId/knowledge/search", { preHandler: requireShop(ctx), schema: { params, querystring: z.object({ q: z.string().min(1).max(300) }) } }, async (req) =>
      searchKnowledge(ctx.db, req.shop.id, req.query.q, 6, ragSourcesOf(req.shop.settings)),
    );
    // RAG overview: entries per source and the last auto-setup run
    app.get("/:shopId/knowledge/stats", { preHandler: requireShop(ctx), schema: { params } }, async (req) => {
      const rows = await ctx.db
        .select({ source: knowledgeEntries.source, n: sql<number>`count(*)::int` })
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.shopId, req.shop.id))
        .groupBy(knowledgeEntries.source);
      const [c] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(igComments).where(eq(igComments.shopId, req.shop.id));
      return { bySource: Object.fromEntries(rows.map((r) => [r.source, r.n])), comments: c?.n ?? 0, rag: req.shop.settings.rag };
    });
    // rebuild products / comments / chat knowledge in the background
    app.post("/:shopId/knowledge/autosetup", { preHandler: requireShop(ctx, "admin"), schema: { params }, config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async (req) => {
      await ctx.queues.add("knowledge.autosetup", { shopId: req.shop.id }, { jobId: `kn-${req.shop.id}-${Date.now()}` });
      return { queued: true };
    });
    app.post("/:shopId/knowledge/learn", { preHandler: requireShop(ctx, "admin"), schema: { params }, config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async (req) => {
      requireFeature(req.shop, "knowledge");
      await assertAiReady(ctx.db, req.shop.id);
      const r = await learnFromDms(ctx.db, req.shop.id);
      invalidateShopCache(req.shop.id);
      return r;
    });
  };
