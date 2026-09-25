import { createDb } from "@shopino/db";
import { buildApp } from "./app";
import { env } from "./config";
import { Queues } from "./lib/queues";
import { createRedis } from "./lib/redis";

const { db, client } = createDb(env.DATABASE_URL, { max: env.DB_POOL_MAX });
const redis = createRedis();
const queues = new Queues(createRedis({ forWorker: true }));
const app = await buildApp({ db, redis, queues });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await queues.close();
  redis.disconnect();
  await client.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.API_PORT, host: env.API_HOST });
