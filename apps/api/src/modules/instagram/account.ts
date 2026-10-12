import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { agentRuns, automationEvents, conversations, igComments, messages, shops, type Database, type IgProfile } from "@shopino/db";
import { planHas, type PlanId } from "@shopino/shared";
import { env, publicApiUrl } from "../../config";
import { cfg } from "../../lib/platform";
import { IG_SCOPES, IG_WEBHOOK_FIELDS, instagramOAuthConfigured, refreshToken, subscribeWebhooks } from "./oauth";
import { unwrap } from "./oauth-state";

/**
 * Managing a connected Instagram account: profile snapshot, token lifetime, webhook subscription and
 * activity. Profile fields follow Meta's "Instagram API with Instagram Login" GET /me reference.
 * Meta documents POST /{IG_ID}/subscribed_apps but no call to read the subscription back, so we record
 * when subscribing last succeeded and when the last event actually arrived.
 */
const DAY = 86_400_000;
/** Meta only refreshes long-lived tokens that are at least 24 hours old */
const MIN_TOKEN_AGE = DAY;

type ShopRow = typeof shops.$inferSelect;

const graph = (path: string) => `https://graph.instagram.com/${cfg("META_GRAPH_VERSION") ?? env.META_GRAPH_VERSION}/${path}`;

export async function fetchProfile(token: string): Promise<IgProfile & { igUserId: string; username: string }> {
  const fields = "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count";
  const res = await fetch(graph(`me?${new URLSearchParams({ fields, access_token: token })}`), { signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(`instagram profile failed (${res.status}): ${json.error?.message ?? res.statusText}`);
  const me = unwrap<{
    user_id: string | number;
    username: string;
    name?: string;
    account_type?: string;
    profile_picture_url?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
  }>(json);
  return {
    igUserId: String(me.user_id),
    username: me.username,
    name: me.name ?? null,
    accountType: me.account_type ?? null,
    pictureUrl: me.profile_picture_url ?? null,
    followers: me.followers_count ?? null,
    follows: me.follows_count ?? null,
    mediaCount: me.media_count ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

async function load(db: Database, shopId: string) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop?.igUserId || !shop.igAccessToken) throw new Error("instagram is not connected");
  return shop;
}

async function recordError(db: Database, shopId: string, err: unknown) {
  await db.update(shops).set({ igLastError: (err as Error).message.slice(0, 500), igLastErrorAt: new Date() }).where(eq(shops.id, shopId));
}

/** GET /me with the shop's token: proves the token works and refreshes the profile snapshot. */
export async function checkAccount(db: Database, shopId: string) {
  const shop = await load(db, shopId);
  try {
    const p = await fetchProfile(shop.igAccessToken!);
    if (p.igUserId !== shop.igUserId) throw new Error(`token belongs to @${p.username}, not the connected account`);
    const { igUserId: _i, username, ...profile } = p;
    await db.update(shops).set({ igUsername: username, igProfile: profile, igLastError: null, igLastErrorAt: null }).where(eq(shops.id, shopId));
    return { ok: true as const, profile: p };
  } catch (err) {
    await recordError(db, shopId, err);
    throw err;
  }
}

export async function refreshShopToken(db: Database, shopId: string, opts: { force?: boolean } = {}) {
  const shop = await load(db, shopId);
  const issued = shop.igTokenRefreshedAt ?? shop.igConnectedAt;
  if (!opts.force && issued && Date.now() - issued.getTime() < MIN_TOKEN_AGE) {
    throw new Error("the token is less than 24 hours old; Instagram refreshes it only after that");
  }
  try {
    const r = await refreshToken(shop.igAccessToken!);
    const now = new Date();
    await db
      .update(shops)
      .set({ igAccessToken: r.access_token, igTokenExpiresAt: new Date(now.getTime() + r.expires_in * 1000), igTokenRefreshedAt: now, igLastError: null, igLastErrorAt: null })
      .where(eq(shops.id, shopId));
    return { expiresAt: new Date(now.getTime() + r.expires_in * 1000) };
  } catch (err) {
    await recordError(db, shopId, err);
    throw err;
  }
}

export async function resubscribeWebhooks(db: Database, shopId: string) {
  const shop = await load(db, shopId);
  try {
    await subscribeWebhooks(shop.igUserId!, shop.igAccessToken!);
    await db.update(shops).set({ igWebhookSubscribedAt: new Date(), igLastError: null, igLastErrorAt: null }).where(eq(shops.id, shopId));
    return { ok: true, fields: IG_WEBHOOK_FIELDS };
  } catch (err) {
    await recordError(db, shopId, err);
    throw err;
  }
}

/** Called from the webhook: last-event time per account (at most one write a minute) and a global heartbeat. */
export async function noteWebhookEvent(db: Database, redis: Redis, shopId: string | null) {
  const day = new Date().toISOString().slice(0, 10);
  await redis.multi().set("ig:webhook:last", Date.now()).incr(`ig:webhook:count:${day}`).expire(`ig:webhook:count:${day}`, 8 * 86400).exec();
  if (!shopId) return;
  await db
    .update(shops)
    .set({ igLastEventAt: new Date() })
    .where(and(eq(shops.id, shopId), or(isNull(shops.igLastEventAt), lt(shops.igLastEventAt, new Date(Date.now() - 60_000)))));
}

export async function webhookHeartbeat(redis: Redis) {
  const day = (offset: number) => new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);
  const [last, today, yesterday] = await redis.mget("ig:webhook:last", `ig:webhook:count:${day(0)}`, `ig:webhook:count:${day(1)}`);
  return { lastAt: last ? new Date(Number(last)).toISOString() : null, today: Number(today ?? 0), yesterday: Number(yesterday ?? 0) };
}

export function tokenState(shop: Pick<ShopRow, "igTokenExpiresAt" | "igTokenRefreshedAt" | "igConnectedAt">) {
  const expiresAt = shop.igTokenExpiresAt;
  const daysLeft = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / DAY) : null;
  const issued = shop.igTokenRefreshedAt ?? shop.igConnectedAt;
  return {
    expiresAt,
    daysLeft,
    refreshedAt: shop.igTokenRefreshedAt,
    /** earliest time Instagram will accept a refresh */
    refreshableAt: issued ? new Date(issued.getTime() + MIN_TOKEN_AGE) : null,
    health: daysLeft === null ? "unknown" : daysLeft < 0 ? "expired" : daysLeft <= 10 ? "expiring" : "ok",
  } as const;
}

/** Everything the account page shows. */
export async function accountStatus(db: Database, shop: ShopRow) {
  const connected = Boolean(shop.igUserId && shop.igAccessToken);
  const base = {
    connected,
    oauthAvailable: instagramOAuthConfigured(),
    plan: {
      id: shop.plan,
      expiresAt: shop.planExpiresAt,
      daysLeft: shop.planExpiresAt ? Math.floor((shop.planExpiresAt.getTime() - Date.now()) / DAY) : null,
      automations: planHas(shop.plan as PlanId, "automations"),
      agent: planHas(shop.plan as PlanId, "agent"),
    },
    scopes: IG_SCOPES,
    messagingWindowHours: 24,
  };
  if (!connected) return { ...base, account: null };
  const since = new Date(Date.now() - 7 * DAY);
  const igConvs = and(eq(conversations.shopId, shop.id), eq(conversations.channel, "instagram"));
  const [[dm], [cm], [auto], [ai]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, last: sql<string | null>`max(${messages.createdAt})` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(igConvs, eq(messages.direction, "in"), gte(messages.createdAt, since))),
    db
      .select({ n: sql<number>`count(*)::int`, last: sql<string | null>`max(${igComments.postedAt})` })
      .from(igComments)
      .where(and(eq(igComments.shopId, shop.id), eq(igComments.byShop, false), gte(igComments.createdAt, since))),
    db.select({ n: sql<number>`count(*)::int` }).from(automationEvents).where(and(eq(automationEvents.shopId, shop.id), gte(automationEvents.createdAt, since))),
    db.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(and(eq(agentRuns.shopId, shop.id), eq(agentRuns.channel, "instagram"), gte(agentRuns.createdAt, since))),
  ]);
  return {
    ...base,
    account: {
      igUserId: shop.igUserId,
      username: shop.igUsername,
      profile: shop.igProfile,
      connectedAt: shop.igConnectedAt,
      token: tokenState(shop),
      webhook: { subscribedAt: shop.igWebhookSubscribedAt, fields: IG_WEBHOOK_FIELDS, lastEventAt: shop.igLastEventAt },
      lastError: shop.igLastError ? { message: shop.igLastError, at: shop.igLastErrorAt } : null,
      activity7d: { dms: dm?.n ?? 0, lastDmAt: dm?.last ?? null, comments: cm?.n ?? 0, lastCommentAt: cm?.last ?? null, automations: auto?.n ?? 0, aiReplies: ai?.n ?? 0 },
    },
  };
}

/** Values the platform admin pastes into the Meta app dashboard. */
export function metaSetup() {
  const api = publicApiUrl();
  return {
    redirectUri: `${api}/v1/instagram/oauth/callback`,
    webhookUrl: `${api}/v1/webhooks/instagram`,
    verifyToken: cfg("META_VERIFY_TOKEN") ?? null,
    scopes: IG_SCOPES,
    webhookFields: IG_WEBHOOK_FIELDS,
    graphVersion: cfg("META_GRAPH_VERSION") ?? env.META_GRAPH_VERSION,
    appIdSet: Boolean(cfg("INSTAGRAM_APP_ID")),
    appSecretSet: Boolean(cfg("INSTAGRAM_APP_SECRET") ?? cfg("META_APP_SECRET")),
    signatureSecretSet: Boolean(cfg("META_APP_SECRET")),
    httpsPublicUrl: api.startsWith("https://"),
    oauthConfigured: instagramOAuthConfigured(),
  };
}

/** Forget the account: token, ids and state. (Meta documents no unsubscribe call; events for an unknown id are ignored.) */
export async function disconnectInstagram(db: Database, shopId: string) {
  await db
    .update(shops)
    .set({
      igUserId: null,
      igAccessToken: null,
      igTokenExpiresAt: null,
      igConnectedAt: null,
      igTokenRefreshedAt: null,
      igWebhookSubscribedAt: null,
      igLastEventAt: null,
      igProfile: null,
      igLastError: null,
      igLastErrorAt: null,
    })
    .where(eq(shops.id, shopId));
}
