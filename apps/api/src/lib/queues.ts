import { Queue, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";

export const QUEUE_NAMES = { events: "events", inbound: "inbound", scheduled: "scheduled" } as const;

/** Job name -> payload. Keeping this in one map gives type-safe enqueue + dispatch. */
export interface JobPayloads {
  // scheduled
  "order.expire": { orderId: string };
  "appointment.reminder": { appointmentId: string; offsetMin: number };
  "appointment.hold-expire": { appointmentId: string };
  "customers.recompute-segments": { shopId?: string };
  // events
  "notify.order-paid": { orderId: string };
  "notify.order-shipped": { orderId: string };
  "notify.receipt-uploaded": { paymentId: string };
  "notify.appointment-booked": { appointmentId: string };
  "notify.appointment-cancelled": { appointmentId: string };
  "notify.wallet-refund": { appointmentId: string };
  "campaign.send": { campaignId: string };
  "pricing.refresh-usd": Record<string, never>;
  "instagram.refresh-tokens": Record<string, never>;
  "instagram.analyze": { shopId: string; mediaRowIds: string[] };
  // inbound
  "ig.message": { shopId: string; igsid: string; mid: string; text: string; attachments?: { type: string; url?: string }[]; storyReplyId?: string };
  "ig.comment": { shopId: string; commentId: string; text: string; fromId: string; username?: string; mediaId?: string };
}
export type JobName = keyof JobPayloads;

const queueOf: Record<JobName, keyof typeof QUEUE_NAMES> = {
  "order.expire": "scheduled",
  "appointment.reminder": "scheduled",
  "appointment.hold-expire": "scheduled",
  "customers.recompute-segments": "scheduled",
  "notify.order-paid": "events",
  "notify.order-shipped": "events",
  "notify.receipt-uploaded": "events",
  "notify.appointment-booked": "events",
  "notify.appointment-cancelled": "events",
  "notify.wallet-refund": "events",
  "campaign.send": "events",
  "pricing.refresh-usd": "scheduled",
  "instagram.refresh-tokens": "scheduled",
  "instagram.analyze": "inbound",
  "ig.message": "inbound",
  "ig.comment": "inbound",
};

const defaults: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export class Queues {
  readonly queues: Record<keyof typeof QUEUE_NAMES, Queue>;
  constructor(connection: Redis) {
    this.queues = {
      events: new Queue(QUEUE_NAMES.events, { connection, defaultJobOptions: defaults }),
      inbound: new Queue(QUEUE_NAMES.inbound, { connection, defaultJobOptions: { ...defaults, attempts: 3 } }),
      scheduled: new Queue(QUEUE_NAMES.scheduled, { connection, defaultJobOptions: defaults }),
    };
  }

  add<N extends JobName>(name: N, data: JobPayloads[N], opts: JobsOptions = {}) {
    return this.queues[queueOf[name]].add(name, data, opts);
  }

  /** Delayed job that fires at `at`; `jobId` makes it idempotent (re-scheduling the same id is a no-op). */
  at<N extends JobName>(name: N, data: JobPayloads[N], at: Date, jobId: string) {
    return this.add(name, data, { delay: Math.max(0, at.getTime() - Date.now()), jobId });
  }

  async close() {
    await Promise.all(Object.values(this.queues).map((q) => q.close()));
  }
}
