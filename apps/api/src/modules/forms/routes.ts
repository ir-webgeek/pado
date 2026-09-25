import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { conversations, formSubmissions, forms, messages, shops } from "@shopino/db";
import { formInputSchema } from "@shopino/shared";
import { env } from "../../config";
import type { Ctx } from "../../lib/context";
import { requireFeature, requireShop } from "../../lib/auth";
import { badRequest, notFound } from "../../lib/errors";
import { verifyConversationToken } from "../automations/execute";
import { upsertCustomer } from "../customers/service";
import { escapeHtml, sendTelegram } from "../notifications/telegram";
import { validateSubmission } from "./validate";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const formRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/forms", { preHandler: requireShop(ctx), schema: { params } }, async (req) =>
      ctx.db.select().from(forms).where(eq(forms.shopId, req.shop.id)).orderBy(desc(forms.createdAt)),
    );
    app.post("/:shopId/forms", { preHandler: requireShop(ctx, "admin"), schema: { params, body: formInputSchema } }, async (req) => {
      requireFeature(req.shop, "forms");
      if (new Set(req.body.fields.map((f) => f.key)).size !== req.body.fields.length) throw badRequest("duplicate_keys");
      const [row] = await ctx.db.insert(forms).values({ ...req.body, shopId: req.shop.id }).returning();
      return { ...row, url: `${env.PUBLIC_WEB_URL}/f/${row!.id}` };
    });
    app.put("/:shopId/forms/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: formInputSchema } }, async (req) => {
      const [row] = await ctx.db.update(forms).set(req.body).where(and(eq(forms.id, req.params.id), eq(forms.shopId, req.shop.id))).returning();
      if (!row) throw notFound("form");
      return row;
    });
    app.delete("/:shopId/forms/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      await ctx.db.update(forms).set({ active: false }).where(and(eq(forms.id, req.params.id), eq(forms.shopId, req.shop.id)));
      return { ok: true };
    });
    app.get("/:shopId/forms/:id/submissions", { preHandler: requireShop(ctx, "staff"), schema: { params: withId } }, async (req) =>
      ctx.db
        .select()
        .from(formSubmissions)
        .where(and(eq(formSubmissions.formId, req.params.id), eq(formSubmissions.shopId, req.shop.id)))
        .orderBy(desc(formSubmissions.createdAt))
        .limit(500),
    );
  };

export const publicFormRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    const idParams = z.object({ id: z.string().uuid() });

    app.get("/forms/:id", { schema: { params: idParams } }, async (req) => {
      const f = await ctx.db.query.forms.findFirst({ where: and(eq(forms.id, req.params.id), eq(forms.active, true)) });
      if (!f) throw notFound("form");
      const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, f.shopId), columns: { name: true, slug: true, brandColor: true } });
      return { form: { id: f.id, title: f.title, description: f.description, fields: f.fields }, shop };
    });

    app.post(
      "/forms/:id",
      {
        schema: { params: idParams, querystring: z.object({ c: z.string().optional() }), body: z.record(z.string(), z.unknown()) },
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      },
      async (req, reply) => {
        const f = await ctx.db.query.forms.findFirst({ where: and(eq(forms.id, req.params.id), eq(forms.active, true)) });
        if (!f) throw notFound("form");
        const { data, errors } = validateSubmission(f.fields, req.body);
        if (Object.keys(errors).length) return reply.status(400).send({ error: "validation_error", message: "check the highlighted fields", details: errors });

        // link to the DM conversation that sent the form, and to a customer by phone
        const convId = verifyConversationToken(req.query.c);
        const conv = convId ? await ctx.db.query.conversations.findFirst({ where: and(eq(conversations.id, convId), eq(conversations.shopId, f.shopId)) }) : undefined;
        const phoneField = f.fields.find((x) => x.type === "phone");
        const nameField = f.fields.find((x) => x.key === "name" || x.key === "full_name");
        const phone = phoneField ? (data[phoneField.key] as string | undefined) : undefined;
        const customer = phone ? await upsertCustomer(ctx.db, f.shopId, { phone, name: nameField ? String(data[nameField.key] ?? "") || undefined : undefined }) : null;

        await ctx.db.insert(formSubmissions).values({ shopId: f.shopId, formId: f.id, customerId: customer?.id ?? conv?.customerId ?? null, conversationId: conv?.id, data });
        await ctx.db.update(forms).set({ submissions: sql`${forms.submissions} + 1` }).where(eq(forms.id, f.id));
        if (conv) {
          const summary = f.fields.map((x) => `${x.label}: ${String(data[x.key] ?? "-")}`).join("\n");
          await ctx.db.insert(messages).values({ shopId: f.shopId, conversationId: conv.id, direction: "in", sender: "customer", text: `📝 ${f.title}\n${summary}`, meta: { formId: f.id } });
          await ctx.db.update(conversations).set({ unread: sql`${conversations.unread} + 1`, lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
        }
        const shop = await ctx.db.query.shops.findFirst({ where: eq(shops.id, f.shopId), columns: { telegramChatId: true } });
        if (shop?.telegramChatId) {
          await sendTelegram(shop.telegramChatId, `📝 <b>New form submission</b>: ${escapeHtml(f.title)}`, { text: "Open", url: `${env.PUBLIC_WEB_URL}/panel/forms` }).catch(() => undefined);
        }
        return { ok: true, message: f.successMessage };
      },
    );
  };
