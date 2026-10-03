/**
 * WooCommerce REST API v3 -> Shopino product mapping. Pure, so it is unit tested. Field names follow
 * the official docs (woocommerce.github.io/woocommerce-rest-api-docs): products and variations carry
 * string prices (regular_price, sale_price, price), manage_stock / stock_quantity / stock_status, and a
 * variation's attributes are [{ name, option }].
 */
export type WooUnit = "toman" | "rial";

export interface WooImage {
  src: string;
}
export interface WooProduct {
  id: number;
  name: string;
  type: string;
  status: string;
  description?: string;
  short_description?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: string;
  images?: WooImage[];
  categories?: { id: number; name: string }[];
  variations?: number[];
}
export interface WooVariation {
  id: number;
  status?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  manage_stock?: boolean | "parent";
  stock_quantity?: number | null;
  stock_status?: string;
  attributes?: { name: string; option: string }[];
}

export interface MappedVariant {
  sku?: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  stock: number;
}

/** Woo prices are decimal strings in the store currency; Shopino stores whole Toman. */
export function toToman(raw: string | undefined, unit: WooUnit): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(unit === "rial" ? n / 10 : n);
}

export function stripHtml(html: string | undefined): string {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 10_000);
}

function stockOf(manage: boolean | "parent" | undefined, qty: number | null | undefined, status: string | undefined, defaultStock: number, parentQty?: number | null) {
  if (manage === true) return Math.max(0, qty ?? 0);
  if (manage === "parent") return Math.max(0, parentQty ?? 0);
  return status === "outofstock" ? 0 : defaultStock;
}

function prices(p: { price?: string; regular_price?: string; sale_price?: string }, unit: WooUnit) {
  const regular = toToman(p.regular_price, unit);
  const sale = toToman(p.sale_price, unit);
  if (sale !== null && regular !== null && sale < regular) return { price: sale, compareAtPrice: regular };
  return { price: regular ?? toToman(p.price, unit) ?? 0, compareAtPrice: null };
}

const sku = (s: string | undefined) => (s && s.trim() ? s.trim().slice(0, 60) : undefined);

export function mapSimple(p: WooProduct, unit: WooUnit, defaultStock: number): MappedVariant {
  return { sku: sku(p.sku), attributes: {}, ...prices(p, unit), stock: stockOf(p.manage_stock, p.stock_quantity, p.stock_status, defaultStock) };
}

/**
 * `sharingParent` is how many of the product's variations draw on the parent's stock. Shopino tracks stock
 * per variant, so a shared pool is split evenly (rounded down) rather than copied into each variant,
 * which would multiply sellable units.
 */
export function mapVariation(v: WooVariation, parent: WooProduct, unit: WooUnit, defaultStock: number, sharingParent = 1): MappedVariant {
  const parentShare = parent.stock_quantity == null ? null : Math.floor(Math.max(0, parent.stock_quantity) / Math.max(1, sharingParent));
  return {
    sku: sku(v.sku),
    attributes: Object.fromEntries((v.attributes ?? []).filter((a) => a.option).map((a) => [a.name.slice(0, 40), a.option.slice(0, 60)])),
    ...prices(v, unit),
    stock: stockOf(v.manage_stock, v.stock_quantity, v.stock_status, defaultStock, parentShare),
  };
}

/** Match an imported variant to an existing one so re-imports update instead of duplicating. */
export function variantKey(v: { sku?: string | null; attributes: Record<string, string> }) {
  if (v.sku) return `sku:${v.sku}`;
  return `attr:${JSON.stringify(Object.entries(v.attributes).sort(([a], [b]) => a.localeCompare(b)))}`;
}
