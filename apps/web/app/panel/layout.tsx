"use client";

import clsx from "clsx";
import {
  CalendarClock,
  ChartColumn,
  ClipboardList,
  Warehouse,
  Images,
  ShieldCheck,
  Sparkles,
  Zap,
  ChevronDown,
  ExternalLink,
  LayoutGrid,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Package,
  Scissors,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/logo";
import { LangToggle, ThemeToggle } from "@/components/prefs";
import { Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { ShopProvider, useShop, type ShopSummary } from "@/lib/shop";

interface Me {
  user: { id: string; phone: string; name: string | null; isSuperAdmin: boolean };
  shops: ShopSummary[];
}

interface NavItem {
  href: string;
  key: DictKey;
  icon: typeof LayoutGrid;
  kinds?: ShopSummary["kind"][];
}

const groups: { key: DictKey; items: NavItem[] }[] = [
  {
    key: "p.group.shop",
    items: [
      { href: "/panel", key: "p.dashboard", icon: LayoutGrid },
      { href: "/panel/orders", key: "p.orders", icon: ShoppingBag, kinds: ["retail", "hybrid"] },
      { href: "/panel/products", key: "p.products", icon: Package, kinds: ["retail", "hybrid"] },
      { href: "/panel/inventory", key: "p.inventory", icon: Warehouse, kinds: ["retail", "hybrid"] },
    ],
  },
  {
    key: "p.group.booking",
    items: [
      { href: "/panel/appointments", key: "p.appointments", icon: CalendarClock, kinds: ["services", "hybrid"] },
      { href: "/panel/services", key: "p.services", icon: Scissors, kinds: ["services", "hybrid"] },
    ],
  },
  {
    key: "p.group.automation",
    items: [
      { href: "/panel/inbox", key: "p.inbox", icon: MessageCircle },
      { href: "/panel/automations", key: "p.automations", icon: Zap },
      { href: "/panel/forms", key: "p.forms", icon: ClipboardList },
      { href: "/panel/ai", key: "p.ai", icon: Sparkles },
      { href: "/panel/instagram", key: "p.instagram", icon: Images, kinds: ["retail", "hybrid"] },
    ],
  },
  {
    key: "p.group.growth",
    items: [
      { href: "/panel/customers", key: "p.customers", icon: Users },
      { href: "/panel/reports", key: "p.reports", icon: ChartColumn },
    ],
  },
  { key: "p.group.account", items: [{ href: "/panel/settings", key: "p.settings", icon: Settings }] },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, error } = useApi<Me>("/auth/me", { revalidateOnFocus: false });
  const [shopId, setShopId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (error) router.replace("/login");
  }, [error, router]);
  useEffect(() => {
    if (!me) return;
    if (!me.shops.length) {
      router.replace("/onboarding");
      return;
    }
    const saved = localStorage.getItem("shopId");
    setShopId(me.shops.some((s) => s.id === saved) ? saved : me.shops[0]!.id);
  }, [me, router]);
  useEffect(() => setMenuOpen(false), [pathname]);

  const shop = me?.shops.find((s) => s.id === shopId);
  const ctx = useMemo(
    () =>
      shop && me
        ? {
            shop,
            shops: me.shops,
            switchShop: (id: string) => {
              localStorage.setItem("shopId", id);
              setShopId(id);
            },
          }
        : null,
    [shop, me],
  );

  if (!ctx) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.kinds || i.kinds.includes(ctx.shop.kind)) }))
    .filter((g) => g.items.length);
  const flat = visible.flatMap((g) => g.items);
  const isActive = (href: string) => (href === "/panel" ? pathname === "/panel" : pathname.startsWith(href));
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  };

  return (
    <ShopProvider value={ctx}>
      <div className="night-sky min-h-dvh">
        <div className="mx-auto flex max-w-[1500px] gap-4 p-0 lg:p-4">
          {/* sidebar */}
          <aside className="glass sticky top-4 hidden h-[calc(100dvh-2rem)] w-64 shrink-0 flex-col rounded-[1.25rem] p-3 lg:flex">
            <div className="flex items-center justify-between px-2 pb-4 pt-1">
              <Logo label={t("brand.name")} />
            </div>
            <ShopSwitcher />
            <nav className="scroll-thin mt-3 flex-1 space-y-4 overflow-y-auto">
              {visible.map((g) => (
                <div key={g.key}>
                  <p className="mb-1 px-3 text-[11px] font-medium muted">{t(g.key)}</p>
                  {g.items.map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={clsx(
                        "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                        isActive(it.href) ? "bg-gold/15 font-medium text-[var(--accent)]" : "muted hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]",
                      )}
                    >
                      {isActive(it.href) && <span className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-[var(--accent)]" />}
                      <it.icon className="size-4" /> {t(it.key)}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
            <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-3">
              {me?.user.isSuperAdmin && (
                <Link href="/admin" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-[var(--accent)] hover:bg-[var(--surface-sunken)]">
                  <ShieldCheck className="size-4" /> {t("p.admin")}
                </Link>
              )}
              <a href={`/s/${ctx.shop.slug}`} target="_blank" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm muted hover:bg-[var(--surface-sunken)]">
                <ExternalLink className="size-4" /> {t("p.viewStore")}
              </a>
              <div className="flex items-center justify-between px-1">
                <div className="flex">
                  <LangToggle />
                  <ThemeToggle />
                </div>
                <button onClick={logout} className="rounded-full p-2 muted hover:text-danger" aria-label={t("p.logout")}>
                  <LogOut className="size-4" />
                </button>
              </div>
            </div>
          </aside>

          {/* content */}
          <main className="min-w-0 flex-1 px-4 pb-28 pt-4 lg:px-2 lg:pb-8 lg:pt-2">
            <div className="mb-4 flex items-center justify-between lg:hidden">
              <Logo label={t("brand.name")} />
              <div className="flex items-center">
                <LangToggle />
                <ThemeToggle />
              </div>
            </div>
            {/* keyed by route so each page enters with the same soft rise */}
            <div key={pathname} className="animate-rise">
              {children}
            </div>
          </main>
        </div>

        {/* mobile bottom nav */}
        <nav className="glass fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl px-1 py-1.5 lg:hidden">
          {flat.slice(0, 4).map((it) => (
            <Link key={it.href} href={it.href} className={clsx("flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px]", isActive(it.href) ? "text-[var(--accent)]" : "muted")}>
              <it.icon className="size-5" />
              {t(it.key)}
            </Link>
          ))}
          <button onClick={() => setMenuOpen((v) => !v)} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] muted">
            <MoreHorizontal className="size-5" />…
          </button>
        </nav>
        {menuOpen && (
          <div className="glass fixed inset-x-3 bottom-20 z-40 space-y-1 rounded-2xl p-2 lg:hidden">
            <ShopSwitcher />
            {flat.slice(4).map((it) => (
              <Link key={it.href} href={it.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm strong hover:bg-[var(--surface-sunken)]">
                <it.icon className="size-4" /> {t(it.key)}
              </Link>
            ))}
            <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-danger">
              <LogOut className="size-4" /> {t("p.logout")}
            </button>
          </div>
        )}
      </div>
    </ShopProvider>
  );
}

function ShopSwitcher() {
  const { shop, shops, switchShop } = useShop();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2.5 text-start">
        <span className="flex size-8 items-center justify-center rounded-lg bg-gold/20 font-bold text-[var(--accent)]">{shop.name.charAt(0)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold strong">{shop.name}</span>
          <span className="block text-[11px] uppercase muted">{shop.plan}</span>
        </span>
        {shops.length > 1 && <ChevronDown className="size-4 muted" />}
      </button>
      {open && shops.length > 1 && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-1 shadow-xl">
          {shops.map((s) => (
            <button key={s.id} onClick={() => (switchShop(s.id), setOpen(false))} className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-[var(--surface-sunken)]">
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
