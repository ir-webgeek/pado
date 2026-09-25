import { Redis } from "ioredis";
import { env } from "../config";

export function createRedis(opts: { forWorker?: boolean } = {}) {
  // BullMQ workers require maxRetriesPerRequest: null (blocking commands)
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: opts.forWorker ? null : 3, enableReadyCheck: true });
}
