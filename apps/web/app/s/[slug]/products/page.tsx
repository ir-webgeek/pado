"use client";

import clsx from "clsx";
import { ImageOff, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { useApi } from "@/lib/api";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";

interface Item {
  id: string;
  title: string;
  slug: string;
  images: string[];
  minPrice: number;
  compareAt: number | null;
  available: number;
}
const SORTS = ["new", "popular", "price_asc", "price_desc"] as const;
const RESERVED = new Set(["category", "q", "minPrice", "maxPrice", "inStock", "sort", "limit", "offset"]);

/** Product listing page with URL-driven filters (shareable, back-button friendly). */
export default function PlpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <Plp slug={slug} />
    </Suspense>
  );
}

function Plp({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const sp = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const { data: facets } = useApi<{ attributes: Record<string, string[]>; price: { min: number; max: number } | null }>(`/public/shops/${slug}/facets`);
  const { data: shop } = useApi<{ categories: { id: string; name: string; slug: string }[] }>(`/public/shops/${slug}`);
  const query = sp.toString();
  const { data } = useApi<{ items: Item[] }>(`/public/shops/${slug}/products?limit=60&${query}`);

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (v === null || v === "" || next.get(k) === v) next.delete(k);
    else next.set(k, v);
    router.replace(`/s/${slug}/products${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  const active = useMemo(() => [...sp.entries()].filter(([k]) => k !== "sort"), [sp]);
  const chip = (on: boolean) =>
    clsx("rounded-full border px-3 py-1.5 text-xs transition", on ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] strong hover:bg-[var(--surface-sunken)]");

  const filters = (
    <div className="space-y-5">
      <div>
        <p className="label">{t("sf.category")}</p>
        <div className="flex flex-wrap gap-1.5">
          {(shop?.categories ?? []).map((c) => (
            <button key={c.id} className={chip(sp.get("category") === c.slug)} onClick={() => set("category", c.slug)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
      {Object.entries(facets?.attributes ?? {}).map(([k, values]) => (
        <div key={k}>
          <p className="label">{k}</p>
          <div className="flex flex-wrap gap-1.5">
            {values.map((v) => (
              <button key={v} className={chip(sp.get(k) === v)} onClick={() => set(k, v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}
      {facets?.price && (
        <div>
          <p className="label">{t("sf.priceMax")}</p>
          <input
            type="range"
            className="w-full accent-[var(--accent)]"
            min={facets.price.min}
            max={facets.price.max}
            step={Math.max(1000, Math.round((facets.price.max - facets.price.min) / 50 / 1000) * 1000)}
            value={Number(sp.get("maxPrice") ?? facets.price.max)}
            onChange={(e) => set("maxPrice", e.target.value === String(facets.price!.max) ? null : e.target.value)}
          />
          <p className="num text-xs muted">{money(Number(sp.get("maxPrice") ?? facets.price.max), locale)}</p>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm strong">
        <input type="checkbox" className="accent-[var(--accent)]" checked={sp.get("inStock") === "true"} onChange={(e) => set("inStock", e.target.checked ? "true" : null)} />
        {t("sf.inStock")}
      </label>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside className="hidden lg:block">{filters}</aside>
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="me-auto text-xl font-bold strong">{t("sf.all")}</h1>
          <button className={clsx(chip(false), "lg:hidden inline-flex items-center gap-1")} onClick={() => setShowFilters(true)}>
            <SlidersHorizontal className="size-3.5" /> {t("sf.filters")}
          </button>
          <select className="input !w-auto !py-1.5 text-sm" value={sp.get("sort") ?? "new"} onChange={(e) => set("sort", e.target.value === "new" ? null : e.target.value)}>
            {SORTS.map((s) => (
              <option key={s} value={s}>{t(`sf.sort.${s}`)}</option>
            ))}
          </select>
        </div>
        {active.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {active.map(([k, v]) => (
              <button key={k} className={clsx(chip(true), "inline-flex items-center gap-1")} onClick={() => set(k, null)}>
                {RESERVED.has(k) && k !== "category" ? t(k === "inStock" ? "sf.inStock" : "sf.priceMax") : v} <X className="size-3" />
              </button>
            ))}
            <button className="text-xs muted" onClick={() => router.replace(`/s/${slug}/products`)}>{t("sf.clear")}</button>
          </div>
        )}
        {!data ? (
          <Spinner />
        ) : data.items.length === 0 ? (
          <p className="py-16 text-center muted">{t("me.empty")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {data.items.map((p) => (
              <Link key={p.id} href={`/s/${slug}/p/${p.slug}`} className="group">
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[var(--surface-sunken)]">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0]} alt={p.title} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="flex size-full items-center justify-center muted">
                      <ImageOff className="size-6" />
                    </div>
                  )}
                  {p.available <= 0 && <span className="absolute start-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">{t("sf.outOfStock")}</span>}
                </div>
                <p className="mt-2 truncate text-sm font-medium strong">{p.title}</p>
                <p className="num text-sm muted">
                  {money(p.minPrice, locale)}
                  {p.compareAt && p.compareAt > p.minPrice && <span className="ms-1 text-xs line-through">{money(p.compareAt, locale, false)}</span>}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 lg:hidden" onClick={() => setShowFilters(false)}>
          <div className="max-h-[80dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--bg-elev)] p-5" onClick={(e) => e.stopPropagation()}>
            {filters}
            <button className="mt-5 h-11 w-full rounded-full bg-[var(--accent)] text-sm font-medium text-[var(--accent-ink)]" onClick={() => setShowFilters(false)}>
              {t("a.close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
