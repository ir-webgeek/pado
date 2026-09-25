import type { FastifyReply } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, shopMembers, shops, users } from "@shopino/db";
import { normalizeIranPhone, requestOtpSchema, verifyOtpSchema } from "@shopino/shared";
import { env, isProd } from "../../config";
import { requestOtp, verifyOtp } from "../../lib/otp";
import type { Ctx } from "../../lib/context";
import { randomToken, sha256 } from "../../lib/crypto";
import { unauthorized } from "../../lib/errors";
import { authenticate } from "../../lib/auth";

const superAdminPhones = () => new Set(env.SUPER_ADMIN_PHONES.split(",").map((p) => normalizeIranPhone(p.trim())).filter(Boolean) as string[]);
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
        const r = await requestOtp(ctx.redis, req.body.phone, "staff", "کد ورود شاپینو");
        return { ok: true, ttl: r.ttl, ...(r.devCode ? { devCode: r.devCode } : {}) };
      },
    );

    app.post(
      "/verify",
      { schema: { body: verifyOtpSchema }, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
      async (req, reply) => {
        const phone = await verifyOtp(ctx.redis, req.body.phone, req.body.code, "staff");
        const [user] = await ctx.db
          .insert(users)
          .values({ phone, isSuperAdmin: superAdminPhones().has(phone) })
          .onConflictDoUpdate({ target: users.phone, set: { phone, ...(superAdminPhones().has(phone) ? { isSuperAdmin: true } : {}) } })
          .returning();
        const tokens = await issueSession(reply, user!.id, req.headers["user-agent"]);
        return { user: { id: user!.id, phone: user!.phone, name: user!.name, isSuperAdmin: user!.isSuperAdmin }, ...tokens };
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
      return { user: { id: user.id, phone: user.phone, name: user.name, isSuperAdmin: user.isSuperAdmin }, shops: memberships };
    });
  };
