import { AtSign } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Assistant } from "@/components/store/assistant";
import { CartButton, CartProvider } from "@/components/store/cart";
import { LangToggle } from "@/components/prefs";
import { getT } from "@/lib/locale-server";
import { publicGet, type PublicShop } from "@/lib/server-api";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await publicGet<PublicShop>(`/shops/${slug}`);
  if (!data) notFound();
  const { t } = await getT();
  const { shop } = data;
  return (
    // storefronts use the light "day" palette with the shop's brand color as accent
    <div data-theme="day" className="min-h-dvh bg-[var(--bg)] text-[var(--text-body)]" style={{ "--accent": shop.brandColor === "#d9d0b8" ? "#1b263b" : shop.brandColor } as React.CSSProperties}>
      <CartProvider slug={slug}>
        <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-elev)]/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
            <Link href={`/s/${slug}`} className="text-lg font-extrabold strong">
              {shop.name}
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {shop.kind !== "retail" && (
                <Link href={`/b/${slug}`} className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-medium text-[var(--accent-ink)]">
                  {t("sf.bookNow")}
                </Link>
              )}
              <Link href="/me" className="rounded-full px-3 py-2 text-xs muted hover:bg-[var(--surface-sunken)]">
                {t("p.myBookings")}
              </Link>
              <LangToggle />
              {shop.kind !== "services" && <CartButton />}
            </nav>
          </div>
          {data.categories.length > 0 && shop.kind !== "services" && (
            <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 text-sm">
              <Link href={`/s/${slug}/products`} className="shrink-0 rounded-full px-3 py-1 muted hover:bg-[var(--surface-sunken)]">
                {t("sf.all")}
              </Link>
              {data.categories.map((c) => (
                <Link key={c.id} href={`/s/${slug}/products?category=${c.slug}`} className="shrink-0 rounded-full px-3 py-1 muted hover:bg-[var(--surface-sunken)]">
                  {c.name}
                </Link>
              ))}
            </div>
          )}
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="border-t border-[var(--border)] py-8 text-center text-xs muted">
          {shop.instagram && (
            <a href={`https://instagram.com/${shop.instagram}`} className="mb-2 inline-flex items-center gap-1" target="_blank" rel="noreferrer">
              <AtSign className="size-3.5" /> @{shop.instagram}
            </a>
          )}
          <p>
            {shop.name} · {t("brand.name")}
          </p>
        </footer>
        {shop.assistant && <Assistant slug={slug} />}
      </CartProvider>
    </div>
  );
}
