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
import { fetchProfile } from "./account";

const redirectUri = () => `${publicApiUrl()}/v1/instagram/oauth/callback`;
const NONCE_COOKIE = "ig_oauth";
const RETURN_PAGES = { settings: "/panel/settings?tab=integrations", instagram: "/panel/instagram", onboarding: "/onboarding?step=connect" } as const;
type ReturnPage = keyof typeof RETURN_PAGES;
const returnUrl = (ret: ReturnPage | undefined, q: Record<string, string>) => {
  const path = RETURN_PAGES[ret ?? "settings"];
  return `${env.PUBLIC_WEB_URL}${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(q)}`;
};

/** Owner starts "connect Instagram": we hand back Instagram's consent URL with a signed, short-lived state. */
export const instagramOAuthStartRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      "/:shopId/instagram/oauth/start",
      {
        preHandler: requireShop(ctx, "owner"),
        schema: { params: z.object({ shopId: z.string().uuid() }), body: z.object({ returnTo: z.enum(["settings", "instagram", "onboarding"]).optional() }).nullish() },
      },
      async (req, reply) => {
      if (!instagramOAuthConfigured()) throw badRequest("instagram_not_configured", "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET are not set");
      const nonce = randomToken(16);
      // lax: still sent on Instagram's top-level redirect back to us
      reply.setCookie(NONCE_COOKIE, nonce, { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: 600 });
      const state = signState(env.COOKIE_SECRET, { shopId: req.shop.id, userId: req.user.sub, nonce, ret: req.body?.returnTo });
      return { url: authorizeUrl(redirectUri(), state) };
      },
    );
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
        if (error) return reply.redirect(returnUrl(verifyState(env.COOKIE_SECRET, state ?? "")?.ret, { ig: "denied" }), 303);
        const st = verifyState(env.COOKIE_SECRET, state ?? "");
        const cookieNonce = req.cookies[NONCE_COOKIE] ?? "";
        reply.clearCookie(NONCE_COOKIE, { path: "/" });
        // the state must come back to the same browser that started the flow
        if (!st || !safeEqual(st.nonce, cookieNonce)) return reply.redirect(returnUrl(undefined, { ig: "error", reason: "state" }), 303);
        if (!code) return reply.redirect(returnUrl(st.ret, { ig: "error", reason: "code" }), 303);
        try {
          const short = await exchangeCode(code, redirectUri());
          const long = await longLivedToken(short.access_token);
          const me = await account(long.access_token);
          const taken = await ctx.db.query.shops.findFirst({ where: and(eq(shops.igUserId, me.igUserId), ne(shops.id, st.shopId)), columns: { id: true } });
          if (taken) return reply.redirect(returnUrl(st.ret, { ig: "error", reason: "taken" }), 303);
          await subscribeWebhooks(me.igUserId, long.access_token);
          const profile = await fetchProfile(long.access_token).catch(() => null);
          const now = new Date();
          await ctx.db
            .update(shops)
            .set({
              igUserId: me.igUserId,
              igUsername: me.username,
              igAccessToken: long.access_token,
              igTokenExpiresAt: new Date(now.getTime() + long.expires_in * 1000),
              igConnectedAt: now,
              igTokenRefreshedAt: null,
              igWebhookSubscribedAt: now,
              igProfile: profile ? { name: profile.name, accountType: profile.accountType, pictureUrl: profile.pictureUrl, followers: profile.followers, follows: profile.follows, mediaCount: profile.mediaCount, fetchedAt: profile.fetchedAt } : null,
              igLastError: null,
              igLastErrorAt: null,
            })
            .where(eq(shops.id, st.shopId));
          invalidateShopCache(st.shopId);
          await audit(ctx.db, st.shopId, { type: "user", id: st.userId }, "instagram.connect", "shop", st.shopId, { igUserId: me.igUserId, via: "oauth" });
          // first knowledge build from the freshly connected page (comments, chats, products)
          await ctx.queues.add("knowledge.autosetup", { shopId: st.shopId }, { jobId: `kn-${st.shopId}-connect-${Date.now()}` });
          // pull the page's recent posts so product import is ready when the owner opens it
          await ctx.queues.add("instagram.sync-media", { shopId: st.shopId }, { jobId: `igsync-${st.shopId}-${Date.now()}` });
          return reply.redirect(returnUrl(st.ret, { ig: "connected" }), 303);
        } catch (err) {
          req.log.warn({ err }, "instagram oauth failed");
          return reply.redirect(returnUrl(st.ret, { ig: "error", reason: "exchange" }), 303);
        }
      },
    );
  };
