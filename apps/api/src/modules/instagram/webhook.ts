import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { shops } from "@shopino/db";
import { env } from "../../config";
import { TtlCache } from "../../lib/cache";
import type { Ctx } from "../../lib/context";
import { verifySignature } from "./client";

interface IgWebhook {
  object?: string;
  entry?: {
    id: string;
    time?: number;
    messaging?: {
      sender: { id: string };
      recipient: { id: string };
      timestamp?: number;
      message?: {
        mid: string;
        text?: string;
        is_echo?: boolean;
        is_deleted?: boolean;
        attachments?: { type: string; payload?: { url?: string } }[];
        reply_to?: { mid?: string; story?: { id: string; url?: string } };
      };
    }[];
    changes?: { field: string; value: { id: string; text?: string; from?: { id: string; username?: string }; media?: { id: string } } }[];
  }[];
}

const shopByIg = new TtlCache<string | null>(60_000);

export const instagramWebhook =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    // keep the raw body for signature verification (scoped to this plugin only)
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
      try {
        done(null, { raw: body, json: JSON.parse((body as Buffer).toString("utf8") || "{}") });
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    app.get("/instagram", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === env.META_VERIFY_TOKEN) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
      return reply.status(403).send("forbidden");
    });

    app.post("/instagram", { config: { rateLimit: false } }, async (req, reply) => {
      const { raw, json } = req.body as { raw: Buffer; json: IgWebhook };
      if (!verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined)) return reply.status(401).send("bad signature");

      for (const entry of json.entry ?? []) {
        let shopId = shopByIg.get(entry.id);
        if (shopId === undefined) {
          const s = await ctx.db.query.shops.findFirst({ where: eq(shops.igUserId, entry.id), columns: { id: true } });
          shopId = s?.id ?? null;
          shopByIg.set(entry.id, shopId);
        }
        if (!shopId) continue;

        for (const m of entry.messaging ?? []) {
          if (!m.message || m.message.is_echo || m.message.is_deleted) continue;
          await ctx.queues.add(
            "ig.message",
            {
              shopId,
              igsid: m.sender.id,
              mid: m.message.mid,
              text: m.message.text ?? "",
              attachments: m.message.attachments?.map((a) => ({ type: a.type, url: a.payload?.url })),
              storyReplyId: m.message.reply_to?.story?.id,
            },
            { jobId: `igm-${m.message.mid}` },
          );
        }
        for (const c of entry.changes ?? []) {
          if (c.field !== "comments" || !c.value.from || c.value.from.id === entry.id) continue;
          await ctx.queues.add(
            "ig.comment",
            { shopId, commentId: c.value.id, text: c.value.text ?? "", fromId: c.value.from.id, username: c.value.from.username, mediaId: c.value.media?.id },
            { jobId: `igc-${c.value.id}` },
          );
        }
      }
      // Meta retries on non-200; always ack quickly once jobs are queued
      return reply.send("EVENT_RECEIVED");
    });
  };
