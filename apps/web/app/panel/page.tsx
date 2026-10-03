"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, CalendarClock, MessageCircle, PackageCheck, Receipt } from "lucide-react";
import Link from "next/link";
import { Avatar, Badge, Card, Spinner, statusTone } from "@/components/ui";
import { useApi } from "@/lib/api";
import { money, num, time, weekdayShort } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import type { DictKey } from "@/lib/i18n";
import { SetupChecklist } from "@/components/setup-checklist";

interface Dashboard {
  revenue: { total: number; orders: number; appointments: number; changePct: number | null };
  orders: { total: number; completed: number; avg: number };
  customers: { total: number; new: number };
  attention: { readyToShip: number; awaitingPayment: number; unansweredMessages: number; receiptsToReview: number; lowStock: number; pendingAppointments: number };
  week: { day: string; total: number; orders: number }[];
  recentOrders: { id: string; code: string; total: number; status: string; createdAt: string; customerName: string | null }[];
  bestSellers: { title: string; revenue: number; sold: number }[];
  lowStock: { variantId: string; title: string; sku: string | null; attributes: Record<string, string>; available: number }[];
  today: {
    appointments: { id: string; startsAt: string; endsAt: string; status: string; serviceName: string; color: string; staffId: string; staffName: string; customerName: string | null }[];
    utilization: { staffId: string; bookedMin: number; workingMin: number }[];
  };
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, error } = useApi<Dashboard>(`/shops/${shop.id}/dashboard`, { refreshInterval: 60_000 });
  if (error) return <p className="text-danger">{t("common.error")}</p>;
  if (!data) return <Spinner />;

  const sells = shop.kind !== "services";
  const books = shop.kind !== "retail";
  const attention = [
    sells && { n: data.attention.readyToShip, k: "d.readyToShip", icon: PackageCheck, href: "/panel/orders?status=confirmed", tone: "gold" },
    { n: data.attention.unansweredMessages, k: "d.unanswered", icon: MessageCircle, href: "/panel/inbox", tone: "info" },
    books && { n: data.attention.pendingAppointments, k: "d.pendingAppts", icon: CalendarClock, href: "/panel/appointments", tone: "warning" },
    sells && { n: data.attention.lowStock, k: "d.lowStock", icon: AlertTriangle, href: "/panel/products", tone: "danger" },
    { n: data.attention.receiptsToReview, k: "d.receipts", icon: Receipt, href: "/panel/orders?tab=receipts", tone: "warning" },
  ].filter(Boolean) as { n: number; k: DictKey; icon: typeof PackageCheck; href: string; tone: string }[];
  const maxWeek = Math.max(1, ...data.week.map((w) => w.total));
  const staffNames = new Map(data.today.appointments.map((a) => [a.staffId, a.staffName]));

  return (
    <div className="space-y-4">
      <SetupChecklist />
      <div className="glass relative overflow-hidden rounded-[1.25rem] p-5 sm:p-6">
        <div className="absolute inset-0 bg-[radial-gradient(500px_200px_at_100%_0%,rgb(61_219_196/.14),transparent)]" />
        <p className="relative text-sm muted">
          {t("d.hello")}، {shop.name} 🌙
        </p>
        <h1 className="relative mt-1 text-xl font-bold strong sm:text-2xl">{t("d.clear")}</h1>
        <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {attention.map((a) => (
            <Link key={a.k} href={a.href} className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 transition hover:border-gold/40">
              <span className={clsx("flex size-9 items-center justify-center rounded-xl", a.n ? "bg-gold/15 text-[var(--accent)]" : "bg-[var(--surface-sunken)] muted")}>
                <a.icon className="size-4" />
              </span>
              <span>
                <b className="num block text-lg leading-none strong">{num(a.n, locale)}</b>
                <span className="text-[11px] muted">{t(a.k)}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("d.revenue")} value={money(data.revenue.total, locale, false)} sub={data.revenue.changePct !== null ? `${data.revenue.changePct > 0 ? "+" : ""}${num(data.revenue.changePct, locale)}٪` : t("common.toman")} good={(data.revenue.changePct ?? 0) >= 0} />
        <Stat label={t("d.orders")} value={num(data.orders.total, locale)} sub={`${num(data.orders.completed, locale)} ${t("d.completed")}`} />
        <Stat label={t("d.customers")} value={num(data.customers.total, locale)} sub={`${num(data.customers.new, locale)} ${t("d.newCustomers")}`} />
        <Stat label={t("d.avgOrder")} value={money(data.orders.avg, locale, false)} sub={t("common.toman")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold strong">{t("d.week")}</h2>
            <span className="num text-sm muted">{money(data.week.reduce((a, w) => a + w.total, 0), locale)}</span>
          </div>
          <div className="flex h-44 items-end gap-2">
            {data.week.map((w) => (
              <div key={w.day} className="group flex h-full flex-1 flex-col items-center gap-2">
                <span className="num text-[10px] opacity-0 transition group-hover:opacity-100 muted">{money(w.total, locale, false)}</span>
                {/* bar track needs a definite height for the percentage below to resolve */}
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t-lg bg-gradient-to-t from-slate-brand/50 to-sky-brand transition group-hover:to-gold" style={{ height: `${Math.max(3, (w.total / maxWeek) * 100)}%` }} />
                </div>
                <span className="text-[11px] muted">{weekdayShort(w.day, locale)}</span>
              </div>
            ))}
          </div>
        </Card>

        {books ? (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold strong">{t("d.today")}</h2>
              <Link href="/panel/appointments" className="text-xs text-[var(--accent)]">{t("d.viewAll")}</Link>
            </div>
            {data.today.appointments.length === 0 ? (
              <p className="py-8 text-center text-sm muted">{t("d.noAppts")}</p>
            ) : (
              <ul className="space-y-2">
                {data.today.appointments.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-xl bg-[var(--surface-sunken)] px-3 py-2">
                    <span className="h-8 w-1 rounded-full" style={{ background: a.color }} />
                    <span className="num w-12 text-sm font-semibold strong">{time(a.startsAt, locale)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm strong">{a.customerName}</span>
                      <span className="block truncate text-[11px] muted">
                        {a.serviceName} · {a.staffName}
                      </span>
                    </span>
                    <Badge tone={statusTone(a.status)}>{t(`st.${a.status}` as DictKey)}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {data.today.utilization.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
                <p className="text-xs muted">{t("d.utilization")}</p>
                {data.today.utilization.map((u) => {
                  const pct = Math.min(100, Math.round((u.bookedMin / Math.max(1, u.workingMin)) * 100));
                  return (
                    <div key={u.staffId} className="flex items-center gap-2 text-xs">
                      <span className="w-20 truncate strong">{staffNames.get(u.staffId) ?? "—"}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                        <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="num w-9 text-end muted">{num(pct, locale)}٪</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        ) : (
          <BestSellers data={data} />
        )}
      </div>

      {sells && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold strong">{t("d.recent")}</h2>
              <Link href="/panel/orders" className="text-xs text-[var(--accent)]">{t("d.viewAll")}</Link>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {data.recentOrders.map((o) => (
                <Link key={o.id} href={`/panel/orders/${o.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-90">
                  <Avatar name={o.customerName} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm strong">{o.customerName ?? "—"}</span>
                    <span className="num block text-[11px] muted" dir="ltr">{o.code}</span>
                  </span>
                  <span className="num text-sm strong">{money(o.total, locale)}</span>
                  <Badge tone={statusTone(o.status)}>{t(`st.${o.status}` as DictKey)}</Badge>
                </Link>
              ))}
            </div>
          </Card>
          {books ? <BestSellers data={data} /> : <LowStock data={data} />}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <Card className="!p-4">
      <p className="text-xs muted">{label}</p>
      <p className="num mt-2 text-xl font-bold strong sm:text-2xl">{value}</p>
      {sub && <p className={clsx("mt-1 flex items-center gap-1 text-xs", good === undefined ? "muted" : good ? "text-success" : "text-danger")}>{good !== undefined && <ArrowUpRight className={clsx("size-3", !good && "rotate-90")} />}{sub}</p>}
    </Card>
  );
}

function BestSellers({ data }: { data: Dashboard }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <h2 className="mb-3 font-semibold strong">{t("d.best")}</h2>
      <ol className="space-y-2.5">
        {data.bestSellers.map((b, i) => (
          <li key={b.title} className="flex items-center gap-3 text-sm">
            <span className="num flex size-6 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-xs muted">{num(i + 1, locale)}</span>
            <span className="min-w-0 flex-1 truncate strong">{b.title}</span>
            <span className="num text-xs muted">{num(b.sold, locale)}×</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function LowStock({ data }: { data: Dashboard }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <h2 className="mb-3 font-semibold strong">{t("d.lowStock")}</h2>
      <ul className="space-y-2 text-sm">
        {data.lowStock.map((l) => (
          <li key={l.variantId} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate strong">
              {l.title} <span className="muted">{Object.values(l.attributes).join(" / ")}</span>
            </span>
            <Badge tone={l.available <= 0 ? "danger" : "warning"}>{num(l.available, locale)}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
