import type { MemberRole } from "./enums";

/**
 * Panel sections a team role can be given access to. Each route under /shops/:shopId/<segment> belongs
 * to one section; GET needs "view", anything else "edit".
 */
export const PERMISSION_SECTIONS = ["dashboard", "orders", "products", "inventory", "appointments", "inbox", "automations", "ai", "customers", "reports", "settings"] as const;
export type PermissionSection = (typeof PERMISSION_SECTIONS)[number];
export const PERMISSION_LEVELS = ["none", "view", "edit"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];
export type Permissions = Record<PermissionSection, PermissionLevel>;

const SEGMENTS: Record<string, PermissionSection> = {
  dashboard: "dashboard",
  setup: "dashboard",
  orders: "orders",
  payments: "orders",
  "shipping-methods": "orders",
  products: "products",
  categories: "products",
  pricing: "products",
  woocommerce: "products",
  inventory: "inventory",
  appointments: "appointments",
  services: "appointments",
  staff: "appointments",
  slots: "appointments",
  "time-off": "appointments",
  conversations: "inbox",
  agent: "inbox",
  instagram: "inbox",
  automations: "automations",
  forms: "automations",
  knowledge: "ai",
  landing: "ai",
  customers: "customers",
  campaigns: "customers",
  discounts: "customers",
  reports: "reports",
  expenses: "reports",
  finance: "reports",
  settings: "settings",
  members: "settings",
  roles: "settings",
  wallet: "settings",
};

/** "/v1/shops/:shopId/orders/:id" -> "orders"; the shop root and unknown segments -> null */
export function sectionOfRoute(url: string): PermissionSection | null {
  const m = url.match(/\/shops\/:shopId\/([a-z-]+)/);
  if (!m) return null;
  return SEGMENTS[m[1]!] ?? "settings";
}

/** Panel page -> section, to hide what a role cannot open. */
export function sectionOfPage(href: string): PermissionSection | null {
  const seg = href.match(/^\/panel\/([a-z-]+)/)?.[1];
  if (!seg) return href === "/panel" ? "dashboard" : null;
  const map: Record<string, PermissionSection> = { inbox: "inbox", ai: "ai", reports: "reports", settings: "settings", instagram: "inbox" };
  return map[seg] ?? SEGMENTS[seg] ?? null;
}

const all = (level: PermissionLevel) => Object.fromEntries(PERMISSION_SECTIONS.map((s) => [s, level])) as Permissions;

/** What the built-in roles can do (custom roles are edited by the owner). */
export const BUILTIN_PERMISSIONS: Record<MemberRole, Permissions> = {
  owner: all("edit"),
  admin: all("edit"),
  staff: {
    dashboard: "view",
    orders: "edit",
    products: "edit",
    inventory: "edit",
    appointments: "edit",
    inbox: "edit",
    automations: "view",
    ai: "view",
    customers: "view",
    reports: "none",
    settings: "none",
  },
  viewer: { ...all("view"), inbox: "none", settings: "none" },
};

export const canAccess = (p: Permissions, section: PermissionSection, need: "view" | "edit") =>
  need === "view" ? p[section] !== "none" : p[section] === "edit";
