import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { ProductGrid } from "@/components/store/product-grid";
import { getT } from "@/lib/locale-server";
import { publicGet, type PublicProduct, type PublicShop } from "@/lib/server-api";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await publicGet<PublicShop>(`/shops/${slug}`);
  return { title: data?.shop.name ?? slug, description: data?.shop.landing?.subheadline };
}

/** Store landing: AI-generated (editable) hero, highlights and FAQ over the live catalog. */
export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { t, locale } = await getT();
  const Arrow = locale === "fa" ? ArrowLeft : ArrowRight;
  const [data, latest, popular] = await Promise.all([
    publicGet<PublicShop>(`/shops/${slug}`),
    publicGet<{ items: PublicProduct[] }>(`/shops/${slug}/products?limit=8&sort=new`, 15),
    publicGet<{ items: PublicProduct[] }>(`/shops/${slug}/products?limit=4&sort=popular&inStock=true`, 60),
  ]);
  const shop = data?.shop;
  const landing = shop?.landing;
  const featured = (data?.categories ?? []).filter((c) => landing?.featuredCategorySlugs.includes(c.slug));

  return (
    <div className="space-y-12">
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--accent)] px-6 py-12 text-[var(--accent-ink)] sm:px-10 sm:py-16">
        <div className="absolute -end-20 -top-20 size-72 rounded-full bg-white/10 blur-2xl" />
        <h1 className="relative max-w-2xl text-3xl font-extrabold leading-tight sm:text-5xl">{landing?.headline || shop?.name}</h1>
        <p className="relative mt-4 max-w-xl opacity-80">{landing?.subheadline || (shop?.kind === "services" ? t("sf.services") : t("sf.products"))}</p>
        <div className="relative mt-7 flex flex-wrap gap-3">
          {shop?.kind !== "services" && (
            <Link href={`/s/${slug}/products`} className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--accent-ink)] px-6 text-sm font-medium text-[var(--accent)]">
              {t("sf.all")} <Arrow className="size-4" />
            </Link>
          )}
          {shop?.kind !== "retail" && (
            <Link href={`/b/${slug}`} className="inline-flex h-11 items-center rounded-full border border-current/30 px-6 text-sm font-medium">
              {t("sf.bookNow")}
            </Link>
          )}
        </div>
      </section>

      {landing?.highlights.length ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {landing.highlights.map((h) => (
            <div key={h.title} className="card p-5">
              <Sparkles className="size-5 text-[var(--accent)]" />
              <p className="mt-3 font-semibold strong">{h.title}</p>
              <p className="mt-1 text-sm leading-7 muted">{h.text}</p>
            </div>
          ))}
        </section>
      ) : null}

      {featured.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((c) => (
            <Link key={c.id} href={`/s/${slug}/products?category=${c.slug}`} className="card flex items-center justify-between p-5 transition hover:border-[var(--accent)]">
              <span className="font-semibold strong">{c.name}</span>
              <Arrow className="size-4 muted" />
            </Link>
          ))}
        </section>
      )}

      {shop?.kind !== "services" && (popular?.items.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-bold strong">{t("sf.sort.popular")}</h2>
          <ProductGrid slug={slug} items={popular!.items} locale={locale} soldOut={t("sf.outOfStock")} />
        </section>
      )}
      {shop?.kind !== "services" && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold strong">{t("sf.sort.new")}</h2>
            <Link href={`/s/${slug}/products`} className="text-sm text-[var(--accent)]">{t("sf.all")}</Link>
          </div>
          <ProductGrid slug={slug} items={latest?.items ?? []} locale={locale} soldOut={t("sf.outOfStock")} />
        </section>
      )}

      {landing?.faq.length ? (
        <section className="mx-auto max-w-3xl">
          <h2 className="mb-4 text-lg font-bold strong">{t("sf.faq")}</h2>
          <div className="space-y-2">
            {landing.faq.map((f) => (
              <details key={f.q} className="card group p-0 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 font-medium strong">
                  {f.q}
                  <span className="text-xl muted transition group-open:rotate-45">+</span>
                </summary>
                <p className="px-5 pb-5 text-sm leading-7 muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
