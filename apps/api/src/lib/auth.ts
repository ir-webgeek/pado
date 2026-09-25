import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { resolveShopSettings, shopMembers, shops, type ShopSettings } from "@shopino/db";
import type { MemberRole, PlanFeature, PlanId } from "@shopino/shared";
import { planHas } from "@shopino/shared";
import { TtlCache } from "./cache";
import type { Ctx } from "./context";
import { forbidden, notFound, paymentRequired, unauthorized } from "./errors";

export interface ShopCtx {
  id: string;
  slug: string;
  name: string;
  kind: "retail" | "services" | "hybrid";
  plan: PlanId;
  planExpiresAt: Date | null;
  timezone: string;
  settings: ShopSettings;
  role: MemberRole;
  memberId: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; typ: "access" };
    user: { sub: string; typ: "access" };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    shop: ShopCtx;
  }
}

const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, staff: 1, admin: 2, owner: 3 };
const membershipCache = new TtlCache<ShopCtx | null>(10_000);

export function invalidateShopCache(shopId: string) {
  membershipCache.deleteByPrefix(`${shopId}:`);
}

export async function authenticate(req: FastifyRequest) {
  try {
    await req.jwtVerify();
  } catch {
    throw unauthorized();
  }
  if (req.user.typ !== "access") throw unauthorized();
}

async function loadShopCtx(ctx: Ctx, shopId: string, userId: string): Promise<ShopCtx | null> {
  const key = `${shopId}:${userId}`;
  const cached = membershipCache.get(key);
  if (cached !== undefined) return cached;
  const [row] = await ctx.db
    .select({ shop: shops, memberId: shopMembers.id, role: shopMembers.role })
    .from(shopMembers)
    .innerJoin(shops, eq(shops.id, shopMembers.shopId))
    .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, userId)))
    .limit(1);
  const value: ShopCtx | null = row
    ? {
        id: row.shop.id,
        slug: row.shop.slug,
        name: row.shop.name,
        kind: row.shop.kind,
        plan: row.shop.plan,
        planExpiresAt: row.shop.planExpiresAt,
        timezone: row.shop.timezone,
        settings: resolveShopSettings(row.shop.settings),
        role: row.role,
        memberId: row.memberId,
      }
    : null;
  membershipCache.set(key, value);
  return value;
}

/** preHandler factory: authenticates, then loads `req.shop` from the `:shopId` route param and checks the role. */
export function requireShop(ctx: Ctx, minRole: MemberRole = "viewer") {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    await authenticate(req);
    const shopId = (req.params as { shopId?: string }).shopId;
    if (!shopId || !/^[0-9a-f-]{36}$/i.test(shopId)) throw notFound("shop");
    const shop = await loadShopCtx(ctx, shopId, req.user.sub);
    if (!shop) throw notFound("shop");
    if (ROLE_RANK[shop.role] < ROLE_RANK[minRole]) throw forbidden(`requires ${minRole} role`);
    // writes are blocked while the plan is expired (reads stay available)
    if (req.method !== "GET" && shop.planExpiresAt && shop.planExpiresAt < new Date()) {
      throw paymentRequired("plan_expired", "subscription expired - renew to continue");
    }
    req.shop = shop;
  };
}

export function requireFeature(shop: ShopCtx, feature: PlanFeature) {
  if (!planHas(shop.plan, feature)) throw paymentRequired("plan_feature", `your plan does not include ${feature}`);
}
