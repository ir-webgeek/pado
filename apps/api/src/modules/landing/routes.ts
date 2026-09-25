import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { categories, knowledgeEntries, products, services, shops, type StoreLanding } from "@shopino/db";
import type { Ctx } from "../../lib/context";
import { requireFeature, requireShop } from "../../lib/auth";
import { assertAiReady, chargeAi, structured } from "../agent/llm";

const params = z.object({ shopId: z.string().uuid() });

const landingSchema = z.object({
  headline: z.string().max(80),
  subheadline: z.string().max(200),
  highlights: z.array(z.object({ title: z.string().max(40), text: z.string().max(160) })).max(4),
  faq: z.array(z.object({ q: z.string().max(140), a: z.string().max(400) })).max(6),
  featuredCategorySlugs: z.array(z.string()).max(4),
});

export const landingRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    // AI writes the storefront landing (hero, highlights, FAQ) from the shop's own data; editable afterwards
    app.post("/:shopId/landing/generate", { preHandler: requireShop(ctx, "admin"), schema: { params }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
      requireFeature(req.shop, "landing_ai");
      await assertAiReady(ctx.db, req.shop.id);
      const [cats, prods, svcs, kb] = await Promise.all([
        ctx.db.select({ name: categories.name, slug: categories.slug }).from(categories).where(eq(categories.shopId, req.shop.id)),
        ctx.db.select({ title: products.title, description: products.description }).from(products).where(and(eq(products.shopId, req.shop.id), eq(products.status, "active"))).orderBy(desc(products.createdAt)).limit(30),
        ctx.db.select({ name: services.name, description: services.description, price: services.price }).from(services).where(and(eq(services.shopId, req.shop.id), eq(services.active, true))).limit(20),
        ctx.db.select({ title: knowledgeEntries.title, content: knowledgeEntries.content }).from(knowledgeEntries).where(and(eq(knowledgeEntries.shopId, req.shop.id), eq(knowledgeEntries.active, true))).limit(20),
      ]);
      const brief = [
        `Shop: ${req.shop.name} (${req.shop.kind})`,
        `Categories: ${cats.map((c) => `${c.name} [${c.slug}]`).join(", ") || "-"}`,
        `Products:\n${prods.map((p) => `- ${p.title}: ${p.description.slice(0, 160)}`).join("\n") || "-"}`,
        `Services:\n${svcs.map((s) => `- ${s.name}: ${s.description.slice(0, 120)}`).join("\n") || "-"}`,
        `Policies / FAQ:\n${kb.map((k) => `- ${k.title}: ${k.content.slice(0, 300)}`).join("\n") || "-"}`,
      ].join("\n\n");
      const { data, usage } = await structured({
        schema: landingSchema,
        system:
          "You write concise, warm storefront landing copy for small Instagram-first businesses in the language of their catalog (usually Persian). Use only facts from the brief; FAQ answers must come from the policies given. featuredCategorySlugs must be slugs from the brief.",
        content: brief,
        maxTokens: 4000,
        effort: "low",
      });
      await chargeAi(ctx.db, req.shop.id, usage, { type: "landing", id: req.shop.id });
      const landing: StoreLanding = { ...data, featuredCategorySlugs: data.featuredCategorySlugs.filter((s) => cats.some((c) => c.slug === s)), generatedAt: new Date().toISOString() };
      await ctx.db.update(shops).set({ landing }).where(eq(shops.id, req.shop.id));
      return landing;
    });

    app.put(
      "/:shopId/landing",
      { preHandler: requireShop(ctx, "admin"), schema: { params, body: landingSchema } },
      async (req) => {
        const landing: StoreLanding = { ...req.body, generatedAt: new Date().toISOString() };
        await ctx.db.update(shops).set({ landing }).where(eq(shops.id, req.shop.id));
        return landing;
      },
    );
  };
