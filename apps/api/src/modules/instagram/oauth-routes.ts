import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { shops } from "@shopino/db";
import { env, isProd, publicApiUrl } from "../../config";
import type { Ctx } from "../../lib/context";
import { audit } from "../../lib/audit";
import { invalidateShopCache, requireShop } from "../../lib/auth";
import { randomToken, safeEqual } from "../../lib/crypto";
import { badRequest } from "../../lib/errors";
import { account, authorizeUrl, exchangeCode, instagramOAuthConfigured, longLivedToken, subscribeWebhooks } from "./oauth";
import { signState, verifyState } from "./oauth-state";

const redirectUri = () => `${publicApiUrl()}/v1/instagram/oauth/callback`;
const NONCE_COOKIE = "ig_oauth";
const settingsUrl = (q: Record<string, string>) => `${env.PUBLIC_WEB_URL}/panel/settings?${new URLSearchParams({ tab: "integrations", ...q })}`;

/** Owner starts "connect Instagram": we hand back Instagram's consent URL with a signed, short-lived state. */
export const instagramOAuthStartRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/:shopId/instagram/oauth/start", { preHandler: requireShop(ctx, "owner"), schema: { params: z.object({ shopId: z.string().uuid() }) } }, async (req, reply) => {
      if (!instagramOAuthConfigured()) throw badRequest("instagram_not_configured", "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET are not set");
      const nonce = randomToken(16);
      // lax: still sent on Instagram's top-level redirect back to us
      reply.setCookie(NONCE_COOKIE, nonce, { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: 600 });
      const state = signState(env.COOKIE_SECRET, { shopId: req.shop.id, userId: req.user.sub, nonce });
      return { url: authorizeUrl(redirectUri(), state) };
    });
  };

/** Instagram redirects here after consent. Public route: the signed state proves which shop and owner asked. */
export const instagramOAuthCallbackRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/oauth/callback",
      { schema: { querystring: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), error_reason: z.string().optional() }) } },
      async (req, reply) => {
        const { code, state, error } = req.query;
        if (error) return reply.redirect(settingsUrl({ ig: "denied" }), 303);
        const st = verifyState(env.COOKIE_SECRET, state ?? "");
        const cookieNonce = req.cookies[NONCE_COOKIE] ?? "";
        reply.clearCookie(NONCE_COOKIE, { path: "/" });
        // the state must come back to the same browser that started the flow
        if (!st || !safeEqual(st.nonce, cookieNonce)) return reply.redirect(settingsUrl({ ig: "error", reason: "state" }), 303);
        if (!code) return reply.redirect(settingsUrl({ ig: "error", reason: "code" }), 303);
        try {
          const short = await exchangeCode(code, redirectUri());
          const long = await longLivedToken(short.access_token);
          const me = await account(long.access_token);
          const taken = await ctx.db.query.shops.findFirst({ where: and(eq(shops.igUserId, me.igUserId), ne(shops.id, st.shopId)), columns: { id: true } });
          if (taken) return reply.redirect(settingsUrl({ ig: "error", reason: "taken" }), 303);
          await subscribeWebhooks(me.igUserId, long.access_token);
          await ctx.db
            .update(shops)
            .set({ igUserId: me.igUserId, igUsername: me.username, igAccessToken: long.access_token, igTokenExpiresAt: new Date(Date.now() + long.expires_in * 1000) })
            .where(eq(shops.id, st.shopId));
          invalidateShopCache(st.shopId);
          await audit(ctx.db, st.shopId, { type: "user", id: st.userId }, "instagram.connect", "shop", st.shopId, { igUserId: me.igUserId, via: "oauth" });
          return reply.redirect(settingsUrl({ ig: "connected" }), 303);
        } catch (err) {
          req.log.warn({ err }, "instagram oauth failed");
          return reply.redirect(settingsUrl({ ig: "error", reason: "exchange" }), 303);
        }
      },
    );
  };
