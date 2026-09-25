import type { Database } from "@shopino/db";
import type { Redis } from "ioredis";
import type { Queues } from "./queues";

/** Process-wide dependencies shared by the HTTP server and the workers. */
export interface Ctx {
  db: Database;
  redis: Redis;
  queues: Queues;
}
