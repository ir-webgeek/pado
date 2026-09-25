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
