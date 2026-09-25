import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { automationEvents, automationRules, forms } from "@shopino/db";
import { AUTOMATION_TRIGGERS, automationRuleInputSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireFeature, requireShop } from "../../lib/auth";
import { badRequest, notFound } from "../../lib/errors";
import { describe } from "./execute";
import { matchRule } from "./match";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const automationRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    async function assertForms(shopId: string, body: z.infer<typeof automationRuleInputSchema>) {
      const ids = body.messages.filter((m) => m.kind === "form").map((m) => (m as { formId: string }).formId);
      for (const id of ids) {
        const f = await ctx.db.query.forms.findFirst({ where: and(eq(forms.id, id), eq(forms.shopId, shopId)) });
        if (!f) throw badRequest("invalid_form", "the selected form does not exist");
      }
      if (body.trigger !== "comment" && body.messages.length === 0) throw badRequest("no_messages", "add at least one message");
      if (body.trigger === "comment" && !body.privateReply && !body.publicReply && body.messages.length === 0) throw badRequest("no_reply", "add a reply");
    }

    app.get("/:shopId/automations", { preHandler: requireShop(ctx), schema: { params } }, async (req) =>
      ctx.db.select().from(automationRules).where(eq(automationRules.shopId, req.shop.id)).orderBy(desc(automationRules.priority), desc(automationRules.createdAt)),
    );
    app.post("/:shopId/automations", { preHandler: requireShop(ctx, "admin"), schema: { params, body: automationRuleInputSchema } }, async (req) => {
      requireFeature(req.shop, "automations");
      await assertForms(req.shop.id, req.body);
      const [row] = await ctx.db.insert(automationRules).values({ ...req.body, shopId: req.shop.id }).returning();
      return row;
    });
    app.put("/:shopId/automations/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: automationRuleInputSchema } }, async (req) => {
      await assertForms(req.shop.id, req.body);
      const [row] = await ctx.db.update(automationRules).set(req.body).where(and(eq(automationRules.id, req.params.id), eq(automationRules.shopId, req.shop.id))).returning();
      if (!row) throw notFound("rule");
      return row;
    });
    app.delete("/:shopId/automations/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      await ctx.db.delete(automationRules).where(and(eq(automationRules.id, req.params.id), eq(automationRules.shopId, req.shop.id)));
      return { ok: true };
    });
    app.get("/:shopId/automations/events", { preHandler: requireShop(ctx), schema: { params } }, async (req) =>
      ctx.db.select().from(automationEvents).where(eq(automationEvents.shopId, req.shop.id)).orderBy(desc(automationEvents.createdAt)).limit(100),
    );

    // dry run: which rule would answer this, and what would be sent
    app.post(
      "/:shopId/automations/test",
      { preHandler: requireShop(ctx), schema: { params, body: z.object({ trigger: z.enum(AUTOMATION_TRIGGERS), text: z.string().max(1000).default(""), mediaId: z.string().optional() }) } },
      async (req) => {
        const rules = await ctx.db.select().from(automationRules).where(eq(automationRules.shopId, req.shop.id));
        const rule = matchRule(rules, req.body);
        if (!rule) return { matched: false };
        return {
          matched: true,
          rule: { id: rule.id, name: rule.name },
          publicReply: rule.publicReply,
          privateReply: rule.privateReply,
          messages: rule.messages.map((m) => describe(m)),
        };
      },
    );
  };
