import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { resolveShopSettings, shopMembers, shopRoles, shops, type ShopSettings } from "@shopino/db";
import type { MemberRole, PlanFeature, PlanId } from "@shopino/shared";
import { BUILTIN_PERMISSIONS, canAccess, planHas, sectionOfRoute, type Permissions } from "@shopino/shared";
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
  /** effective panel permissions (built-in role, or the member's custom role) */
  permissions: Permissions;
  customRole: { id: string; name: string } | null;
  suspended: boolean;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; typ: "access" | "customer" };
    user: { sub: string; typ: "access" | "customer" };
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

/** Customer portal session: a JWT (typ "customer", sub = normalized phone) in the `cust` cookie. */
export function customerPhone(req: FastifyRequest): string {
  const token = req.cookies.cust ?? (req.headers["x-customer-token"] as string | undefined);
  if (!token) throw unauthorized();
  try {
    const p = req.server.jwt.verify<{ sub: string; typ: string }>(token);
    if (p.typ !== "customer") throw new Error("wrong token type");
    return p.sub;
  } catch {
    throw unauthorized("session expired");
  }
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
    .select({ shop: shops, memberId: shopMembers.id, role: shopMembers.role, customRole: shopRoles })
    .from(shopMembers)
    .innerJoin(shops, eq(shops.id, shopMembers.shopId))
    .leftJoin(shopRoles, and(eq(shopRoles.id, shopMembers.customRoleId), eq(shopRoles.shopId, shopMembers.shopId)))
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
        // the owner always keeps full access; a custom role only applies to other members
        customRole: row.customRole && row.role !== "owner" ? { id: row.customRole.id, name: row.customRole.name } : null,
        permissions:
          row.customRole && row.role !== "owner"
            ? { ...BUILTIN_PERMISSIONS.viewer, ...(row.customRole.permissions as Partial<Permissions>) }
            : BUILTIN_PERMISSIONS[row.role],
        suspended: Boolean(row.shop.suspendedAt),
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
    if (shop.customRole) {
      // custom roles: the section of the route decides (GET = view, anything else = edit)
      if (minRole === "owner") throw forbidden("requires owner role");
      const section = sectionOfRoute(req.routeOptions.url ?? "");
      const need = req.method === "GET" ? "view" : "edit";
      const allowed = section ? canAccess(shop.permissions, section, need) : need === "view" || canAccess(shop.permissions, "settings", "edit");
      if (!allowed) throw forbidden(`your role cannot ${need} ${section ?? "settings"}`);
    } else if (ROLE_RANK[shop.role] < ROLE_RANK[minRole]) throw forbidden(`requires ${minRole} role`);
    if (req.method !== "GET" && shop.suspended) throw forbidden("this shop is suspended - contact support");
    // writes are blocked while the plan is expired (reads stay available)
    if (req.method !== "GET" && shop.planExpiresAt && shop.planExpiresAt < new Date()) {
      throw paymentRequired("plan_expired", "subscription expired - renew to continue");
    }
    req.shop = shop;
  };
}

/** Team access stays with built-in owners/admins: a custom role could otherwise widen its own permissions. */
export async function requireBuiltinRole(req: FastifyRequest) {
  if (req.shop.customRole) throw forbidden("only owners and admins manage team access");
}

export function requireFeature(shop: ShopCtx, feature: PlanFeature) {
  if (!planHas(shop.plan, feature)) throw paymentRequired("plan_feature", `your plan does not include ${feature}`);
}
