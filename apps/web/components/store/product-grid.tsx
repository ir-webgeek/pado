import Link from "next/link";
import { ImageOff } from "lucide-react";
import { money } from "@/lib/format";
import type { PublicProduct } from "@/lib/server-api";

export function ProductGrid({ slug, items, locale, soldOut }: { slug: string; items: PublicProduct[]; locale: "fa" | "en"; soldOut: string }) {
  return (
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
          <p className="num text-sm muted">{p.available > 0 ? money(p.minPrice, locale) : soldOut}</p>
        </Link>
      ))}
    </div>
  );
}
