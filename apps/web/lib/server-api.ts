const base = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Server-side fetch of public API data (SSR for storefront pages). */
export async function publicGet<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${base}/v1/public${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface SiteConfig {
  enamadMeta: string | null;
  enamadHtml: string | null;
  badgeUrl: string | null;
  badgeImage: string | null;
  headHtml: string | null;
}

/** Trust seal / verification settings from the platform admin (cached a few minutes). */
export async function siteConfig(): Promise<SiteConfig | null> {
  try {
    const res = await fetch(`${base}/v1/platform/site`, { next: { revalidate: 30 } });
    return res.ok ? ((await res.json()) as SiteConfig) : null;
  } catch {
    return null;
  }
}

/** Only <meta> and <link> tags from the admin's extra head HTML (no scripts or markup). */
export function headTags(html: string | null): { tag: "meta" | "link"; attrs: Record<string, string> }[] {
  if (!html) return [];
  const out: { tag: "meta" | "link"; attrs: Record<string, string> }[] = [];
  for (const m of html.matchAll(/<(meta|link)\s+([^>]*?)\/?>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const name = a[1]!.toLowerCase();
      if (name.startsWith("on")) continue;
      attrs[name] = a[2] ?? a[3] ?? "";
    }
    if (Object.keys(attrs).length) out.push({ tag: m[1]!.toLowerCase() as "meta" | "link", attrs });
  }
  return out.slice(0, 20);
}

export interface PublicShop {
  shop: {
    id: string;
    slug: string;
    name: string;
    kind: "retail" | "services" | "hybrid";
    logo: string | null;
    brandColor: string;
    theme: string;
    timezone: string;
    instagram: string | null;
    assistant: boolean;
    landing: {
      headline: string;
      subheadline: string;
      highlights: { title: string; text: string }[];
      faq: { q: string; a: string }[];
      featuredCategorySlugs: string[];
    } | null;
  };
  categories: { id: string; name: string; slug: string }[];
}
export interface PublicProduct {
  id: string;
  title: string;
  slug: string;
  images: string[];
  minPrice: number;
  compareAt: number | null;
  available: number;
}
