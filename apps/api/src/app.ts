import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { env, isProd } from "./config";
import type { Ctx } from "./lib/context";
import { AppError } from "./lib/errors";
import { routes } from "./routes";

export async function buildApp(ctx: Ctx) {
  const app = Fastify({
    logger: isProd
      ? { level: "info" }
      : { level: "debug", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: isProd,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.CORS_ORIGINS.split(","), credentials: true });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: "access", signed: false }, sign: { expiresIn: "15m" } });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute", redis: ctx.redis, nameSpace: "rl:" });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  const uploadDir = resolve(env.UPLOAD_DIR);
  mkdirSync(uploadDir, { recursive: true });
  await app.register(fastifyStatic, { root: uploadDir, prefix: "/uploads/", decorateReply: false, maxAge: "30d", immutable: true });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({ error: "validation_error", message: "invalid request", details: err.validation });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.code ?? "bad_request", message: err.message });
    }
    // unique violations surface as 409 so clients can show a friendly message
    const pgCode = (err as { cause?: { code?: string } }).cause?.code;
    if (pgCode === "23505") return reply.status(409).send({ error: "duplicate", message: "already exists" });
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: "internal_error", message: "something went wrong" });
  });

  app.get("/health", { config: { rateLimit: false } }, async () => {
    await ctx.redis.ping();
    return { ok: true };
  });

  await app.register(routes(ctx), { prefix: "/v1" });
  return app;
}
