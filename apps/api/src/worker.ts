import { Worker, type Job } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { createDb, customers, resolveShopSettings, shops } from "@shopino/db";
import { env } from "./config";
import { QUEUE_NAMES, Queues, type JobName, type JobPayloads } from "./lib/queues";
import { createRedis } from "./lib/redis";
import { expireHoldIfDue } from "./modules/appointments/service";
import { computeSegment } from "./modules/customers/segments";
import { handleComment, handleInbound } from "./modules/inbox/pipeline";
import {
  notifyAppointmentBooked,
  notifyAppointmentCancelled,
  notifyOrderPaid,
  notifyOrderShipped,
  notifyReceiptUploaded,
  notifyWalletRefund,
  sendAppointmentReminder,
  sendCampaign,
} from "./modules/notifications/notify";
import { expireOrderIfDue } from "./modules/orders/service";
import { refreshUsdRateFromSource } from "./modules/pricing/service";
import { analyzeMedia } from "./modules/instagram/importer";
import { refreshInstagramTokens } from "./modules/instagram/token-refresh";

const { db, client } = createDb(env.DATABASE_URL, { max: 10 });
const connection = createRedis({ forWorker: true });
const redis = createRedis();
const queues = new Queues(connection);

async function recomputeSegments(shopId?: string) {
  const list = shopId ? await db.select().from(shops).where(eq(shops.id, shopId)) : await db.select().from(shops);
  for (const shop of list) {
    const settings = resolveShopSettings(shop.settings);
    let lastId: string | undefined;
    for (;;) {
      const batch = await db
        .select()
        .from(customers)
        .where(lastId ? sql`${customers.shopId} = ${shop.id} and ${customers.id} > ${lastId}` : eq(customers.shopId, shop.id))
        .orderBy(customers.id)
        .limit(1000);
      if (!batch.length) break;
      for (const c of batch) {
        const seg = computeSegment(c, settings);
        if (seg !== c.segment) await db.update(customers).set({ segment: seg }).where(eq(customers.id, c.id));
      }
      lastId = batch.at(-1)!.id;
    }
  }
}

type Handlers = { [N in JobName]: (data: JobPayloads[N]) => Promise<unknown> };

const handlers: Handlers = {
  "order.expire": ({ orderId }) => expireOrderIfDue(db, orderId),
  "appointment.hold-expire": ({ appointmentId }) => expireHoldIfDue(db, appointmentId),
  "appointment.reminder": ({ appointmentId, offsetMin }) => sendAppointmentReminder(db, appointmentId, offsetMin),
  "customers.recompute-segments": ({ shopId }) => recomputeSegments(shopId),
  "notify.order-paid": ({ orderId }) => notifyOrderPaid(db, orderId),
  "notify.order-shipped": ({ orderId }) => notifyOrderShipped(db, orderId),
  "notify.receipt-uploaded": ({ paymentId }) => notifyReceiptUploaded(db, paymentId),
  "notify.appointment-booked": ({ appointmentId }) => notifyAppointmentBooked(db, appointmentId),
  "notify.appointment-cancelled": ({ appointmentId }) => notifyAppointmentCancelled(db, appointmentId),
  "notify.wallet-refund": ({ appointmentId }) => notifyWalletRefund(db, appointmentId),
  "campaign.send": ({ campaignId }) => sendCampaign(db, campaignId),
  "ig.message": (d) =>
    handleInbound(db, queues, redis, { shopId: d.shopId, channel: "instagram", externalUserId: d.igsid, text: d.text, externalId: d.mid, attachments: d.attachments, storyReplyId: d.storyReplyId }),
  "ig.comment": (d) => handleComment(db, redis, d),
  "pricing.refresh-usd": () => refreshUsdRateFromSource(db),
  "instagram.analyze": ({ shopId, mediaRowIds }) => analyzeMedia(db, shopId, mediaRowIds),
  "instagram.refresh-tokens": () => refreshInstagramTokens(db),
};

const process = (job: Job) => {
  const handler = handlers[job.name as JobName] as ((data: unknown) => Promise<unknown>) | undefined;
  if (!handler) throw new Error(`no handler for job ${job.name}`);
  return handler(job.data);
};

// concurrency per queue: inbound runs LLM calls (I/O bound), scheduled jobs are tiny
const workers = [
  new Worker(QUEUE_NAMES.events, process, { connection, concurrency: 20 }),
  new Worker(QUEUE_NAMES.inbound, process, { connection, concurrency: 16 }),
  new Worker(QUEUE_NAMES.scheduled, process, { connection, concurrency: 20 }),
];
for (const w of workers) {
  w.on("failed", (job, err) => console.error(`[worker] ${job?.name} ${job?.id} failed:`, err.message));
}

// nightly segment refresh (people drift into "at risk" without any new event)
await queues.queues.scheduled.upsertJobScheduler(
  "nightly-segments",
  { pattern: "30 3 * * *", tz: "Asia/Tehran" },
  { name: "customers.recompute-segments", data: {} },
);

// long-lived Instagram tokens expire after 60 days unless refreshed
await queues.queues.scheduled.upsertJobScheduler("ig-token-refresh", { pattern: "15 4 * * *", tz: "Asia/Tehran" }, { name: "instagram.refresh-tokens", data: {} });

if (env.USD_RATE_URL) {
  await queues.queues.scheduled.upsertJobScheduler("usd-rate", { every: 60 * 60_000 }, { name: "pricing.refresh-usd", data: {} });
}

console.log("worker started");

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await queues.close();
  redis.disconnect();
  await client.end({ timeout: 5 });
  globalThis.process.exit(0);
};
globalThis.process.on("SIGINT", () => void shutdown());
globalThis.process.on("SIGTERM", () => void shutdown());
