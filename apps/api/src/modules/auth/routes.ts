import type { FastifyReply } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, shopMembers, shops, users } from "@shopino/db";
import { normalizeIranPhone, requestOtpSchema, verifyOtpSchema } from "@shopino/shared";
import { env, isProd } from "../../config";
import type { Ctx } from "../../lib/context";
import { otpCode, randomToken, safeEqual, sha256 } from "../../lib/crypto";
import { AppError, badRequest, unauthorized } from "../../lib/errors";
import { authenticate } from "../../lib/auth";
import { sendSms } from "../notifications/sms";

const OTP_TTL_S = 120;
const REFRESH_TTL_DAYS = 30;

export const authRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    const cookieBase = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };

    async function issueSession(reply: FastifyReply, userId: string, userAgent?: string) {
      const refresh = randomToken(32);
      await ctx.db.insert(sessions).values({
        userId,
        tokenHash: sha256(refresh),
        userAgent: userAgent?.slice(0, 200),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
      });
      const accessToken = await reply.jwtSign({ sub: userId, typ: "access" });
      reply
        .setCookie("access", accessToken, { ...cookieBase, maxAge: 15 * 60 })
        // path "/" so the cookie also reaches the API through the web app's /api proxy
        .setCookie("refresh", refresh, { ...cookieBase, maxAge: REFRESH_TTL_DAYS * 86400 });
      return { accessToken, refreshToken: refresh };
    }

    app.post(
      "/otp",
      { schema: { body: requestOtpSchema }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
      async (req) => {
        const phone = normalizeIranPhone(req.body.phone);
        if (!phone) throw badRequest("invalid_phone", "enter a valid mobile number");
        const throttleKey = `otp:throttle:${phone}`;
        const sent = await ctx.redis.incr(throttleKey);
        if (sent === 1) await ctx.redis.expire(throttleKey, 600);
        if (sent > 5) throw new AppError(429, "too_many_requests", "too many codes requested, try again later");

        const code = otpCode();
        await ctx.redis.set(`otp:${phone}`, JSON.stringify({ h: sha256(code), tries: 0 }), "EX", OTP_TTL_S);
        await sendSms(phone, `کد ورود شاپینو: ${code}`);
        if (env.OTP_DEV_ECHO && !isProd) req.log.warn({ phone, code }, "OTP (dev echo)");
        return { ok: true, ttl: OTP_TTL_S, ...(env.OTP_DEV_ECHO && !isProd ? { devCode: code } : {}) };
      },
    );

    app.post(
      "/verify",
      { schema: { body: verifyOtpSchema }, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
      async (req, reply) => {
        const phone = normalizeIranPhone(req.body.phone);
        if (!phone) throw badRequest("invalid_phone");
        const key = `otp:${phone}`;
        const raw = await ctx.redis.get(key);
        if (!raw) throw badRequest("otp_expired", "code expired, request a new one");
        const state = JSON.parse(raw) as { h: string; tries: number };
        if (state.tries >= 5) {
          await ctx.redis.del(key);
          throw badRequest("otp_locked", "too many wrong attempts");
        }
        if (!safeEqual(state.h, sha256(req.body.code))) {
          await ctx.redis.set(key, JSON.stringify({ ...state, tries: state.tries + 1 }), "KEEPTTL");
          throw badRequest("otp_invalid", "wrong code");
        }
        await ctx.redis.del(key);

        const [user] = await ctx.db
          .insert(users)
          .values({ phone })
          .onConflictDoUpdate({ target: users.phone, set: { phone } })
          .returning();
        const tokens = await issueSession(reply, user!.id, req.headers["user-agent"]);
        return { user: { id: user!.id, phone: user!.phone, name: user!.name }, ...tokens };
      },
    );

    app.post("/refresh", async (req, reply) => {
      const token = req.cookies.refresh ?? (req.headers["x-refresh-token"] as string | undefined);
      if (!token) throw unauthorized();
      const [session] = await ctx.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
        .returning();
      if (!session) throw unauthorized("session expired");
      return issueSession(reply, session.userId, req.headers["user-agent"]);
    });

    app.post("/logout", async (req, reply) => {
      const token = req.cookies.refresh;
      if (token) await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
      reply.clearCookie("access", { path: "/" }).clearCookie("refresh", { path: "/" });
      return { ok: true };
    });

    app.get("/me", { preHandler: authenticate }, async (req) => {
      const user = await ctx.db.query.users.findFirst({ where: eq(users.id, req.user.sub) });
      if (!user) throw unauthorized();
      const memberships = await ctx.db
        .select({ id: shops.id, slug: shops.slug, name: shops.name, kind: shops.kind, plan: shops.plan, role: shopMembers.role })
        .from(shopMembers)
        .innerJoin(shops, eq(shops.id, shopMembers.shopId))
        .where(eq(shopMembers.userId, user.id));
      return { user: { id: user.id, phone: user.phone, name: user.name }, shops: memberships };
    });
  };
