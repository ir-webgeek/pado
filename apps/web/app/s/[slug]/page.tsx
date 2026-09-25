import type { Metadata } from "next";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { money } from "@/lib/format";
import { getT } from "@/lib/locale-server";
import { publicGet, type PublicProduct, type PublicShop } from "@/lib/server-api";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await publicGet<PublicShop>(`/shops/${slug}`);
  return { title: data?.shop.name ?? slug };
}

export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string }> }) {
  const { slug } = await params;
  const { category } = await searchParams;
  const { t, locale } = await getT();
  const [shop, products] = await Promise.all([
    publicGet<PublicShop>(`/shops/${slug}`),
    publicGet<{ items: PublicProduct[] }>(`/shops/${slug}/products?limit=60${category ? `&category=${encodeURIComponent(category)}` : ""}`, 15),
  ]);
  const items = products?.items ?? [];

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--accent)] px-6 py-12 text-[var(--accent-ink)] sm:px-10 sm:py-16">
        <div className="absolute -end-20 -top-20 size-72 rounded-full bg-white/10 blur-2xl" />
        <h1 className="relative text-3xl font-extrabold sm:text-5xl">{shop?.shop.name}</h1>
        <p className="relative mt-3 max-w-md opacity-80">{shop?.shop.kind === "services" ? t("sf.services") : t("sf.products")}</p>
        {shop?.shop.kind !== "retail" && (
          <Link href={`/b/${slug}`} className="relative mt-6 inline-flex h-11 items-center rounded-full bg-[var(--accent-ink)] px-6 text-sm font-medium text-[var(--accent)]">
            {t("sf.bookNow")}
          </Link>
        )}
      </section>

      {shop?.shop.kind !== "services" && (
        <section>
          <h2 className="mb-4 text-lg font-bold strong">{t("sf.products")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <Link key={p.id} href={`/s/${slug}/p/${p.slug}`} className="group">
                <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-[var(--surface-sunken)]">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0]} alt={p.title} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="flex size-full items-center justify-center muted">
                      <ImageOff className="size-6" />
                    </div>
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium strong">{p.title}</p>
                <p className="num text-sm muted">{p.available > 0 ? money(p.minPrice, locale) : t("sf.outOfStock")}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
