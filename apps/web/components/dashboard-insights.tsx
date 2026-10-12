"use client";

import clsx from "clsx";
import { ArrowUpRight, Bot, CalendarCheck, Flag, Hand, CheckCircle2, MessageCircle, MousePointerClick, ShoppingBag, Zap } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { GroupedColumns, RankBars } from "@/components/charts";
import { Card, Spinner } from "@/components/ui";
import { useApi } from "@/lib/api";
import { date, money, num, weekdayShort } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

interface Insights {
  days: number;
  trend: { day: string; orders: number; orderCount: number; bookings: number }[];
  totals: { revenue: number; bookings: number; orders: number; avgOrder: number; changePct: number | null };
  channels: { channel: string; total: number; orders: number }[];
  funnel: { chats: number; newChats: number; siteVisits: number; chatOrders: number; chatRevenue: number };
  ai: { runs: number; replies: number; handoffs: number; errors: number; cost: number; avgMs: number; automationHits: number; automationFailed: number };
  inbox: { needsHuman: number; inProgress: number; resolved: number };
  bookings: { past: number; completed: number; noShow: number; cancelled: number; online: number; upcoming7d: number };
}

const PERIODS = [7, 30, 90] as const;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/**
 * How sales and the app are doing over a chosen period: headline numbers, revenue trend, sales channels,
 * the chat -> site -> order funnel, AI/automation work and inbox load, bookings health.
 */
export function DashboardInsights({ customers, aside }: { customers: { total: number; new: number }; aside?: ReactNode }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const { data } = useApi<Insights>(`/shops/${shop.id}/dashboard/insights?days=${days}`, { refreshInterval: 120_000, keepPreviousData: true });
  const sells = shop.kind !== "services";
  const books = shop.kind !== "retail";

  const series = [
    ...(sells ? [{ name: t("di.ordersRevenue"), color: "var(--series-1)" }] : []),
    ...(books ? [{ name: t("di.bookingsRevenue"), color: "var(--series-2)" }] : []),
  ];

  return (
    <section className="space-y-4" aria-labelledby="di-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="di-title" className="text-lg font-semibold strong">
          {t("di.title")}
        </h2>
        <div className="flex rounded-full bg-[var(--surface-sunken)] p-1 text-xs" role="radiogroup" aria-label={t("di.period")}>
          {PERIODS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={days === p}
              onClick={() => setDays(p)}
              className={clsx("num rounded-full px-3 py-1.5 transition", days === p ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]" : "muted hover:text-[var(--text)]")}
            >
              {t("di.days").replace("{n}", num(p, locale))}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={t("di.revenue")}
              value={money(data.totals.revenue + data.totals.bookings, locale, false)}
              sub={
                data.totals.changePct !== null ? (
                  <span className={clsx("inline-flex items-center gap-0.5", data.totals.changePct >= 0 ? "text-success" : "text-danger")}>
                    <ArrowUpRight className={clsx("size-3", data.totals.changePct < 0 && "rotate-90")} />
                    <span className="num" dir="ltr">
                      {data.totals.changePct > 0 ? "+" : ""}
                      {num(data.totals.changePct, locale)}٪
                    </span>
                    <span className="muted">{t("di.vsPrev")}</span>
                  </span>
                ) : (
                  t("common.toman")
                )
              }
            />
            {sells ? (
              <Tile label={t("di.paidOrders")} value={num(data.totals.orders, locale)} sub={`${t("d.avgOrder")}: ${money(data.totals.avgOrder, locale, false)}`} />
            ) : (
              <Tile label={t("di.completedBookings")} value={num(data.bookings.completed, locale)} sub={`${t("di.upcoming")}: ${num(data.bookings.upcoming7d, locale)}`} />
            )}
            <Tile label={t("di.chatSales")} value={money(data.funnel.chatRevenue, locale, false)} sub={`${num(data.funnel.chatOrders, locale)} ${t("di.ordersFromChat")}`} />
            <Tile label={t("d.customers")} value={num(customers.total, locale)} sub={`${num(customers.new, locale)} ${t("d.newCustomers")}`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className={aside ? "xl:col-span-2" : "xl:col-span-3"}>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="font-semibold strong">{t("di.trend")}</h3>
                <span className="num text-sm muted">{money(data.totals.revenue + data.totals.bookings, locale)}</span>
              </div>
              <GroupedColumns
                height={180}
                series={series}
                groups={data.trend.map((d) => ({
                  key: d.day,
                  label: date(`${d.day}T12:00:00Z`, locale, undefined, { weekday: "long", day: "numeric", month: "long" }),
                  tick: data.days === 7 ? weekdayShort(d.day, locale) : date(`${d.day}T12:00:00Z`, locale, undefined, { day: "numeric" }),
                  values: [...(sells ? [d.orders] : []), ...(books ? [d.bookings] : [])],
                }))}
              />
            </Card>
            {aside}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <h3 className="mb-3 font-semibold strong">{t("di.funnel")}</h3>
              <Funnel
                steps={[
                  { icon: <MessageCircle className="size-3.5" />, label: t("di.activeChats"), value: data.funnel.chats },
                  { icon: <MousePointerClick className="size-3.5" />, label: t("di.visitedSite"), value: data.funnel.siteVisits },
                  { icon: <ShoppingBag className="size-3.5" />, label: t("di.boughtFromChat"), value: data.funnel.chatOrders },
                ]}
              />
              <p className="mt-3 text-xs muted">
                {t("di.conversion")}: <b className="num strong">{num(pct(data.funnel.chatOrders, data.funnel.chats), locale)}٪</b> · {t("di.newChats")}:{" "}
                <b className="num strong">{num(data.funnel.newChats, locale)}</b>
              </p>
            </Card>

            <Card>
              <h3 className="mb-3 flex items-center gap-1.5 font-semibold strong">
                <Bot className="size-4 text-[var(--accent)]" /> {t("di.ai")}
              </h3>
              <dl className="space-y-2 text-sm">
                <Row k={t("di.aiReplies")} v={num(data.ai.replies, locale)} />
                <Row
                  k={t("di.handoffRate")}
                  v={`${num(pct(data.ai.handoffs, data.ai.runs), locale)}٪`}
                  warn={data.ai.runs >= 10 && pct(data.ai.handoffs, data.ai.runs) > 30}
                />
                <Row k={t("di.avgReply")} v={data.ai.avgMs ? `${num(Math.round(data.ai.avgMs / 100) / 10, locale)} ${t("di.sec")}` : "-"} />
                <Row k={t("di.aiCost")} v={money(data.ai.cost, locale)} />
                <Row
                  k={
                    <span className="inline-flex items-center gap-1">
                      <Zap className="size-3.5" /> {t("di.automations")}
                    </span>
                  }
                  v={num(data.ai.automationHits, locale)}
                  warn={data.ai.automationFailed > 0}
                  note={data.ai.automationFailed > 0 ? t("di.failed").replace("{n}", num(data.ai.automationFailed, locale)) : undefined}
                />
              </dl>
            </Card>

            <Card>
              <h3 className="mb-3 font-semibold strong">{t("di.inbox")}</h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <InboxStat href="/panel/inbox?filter=needs_human" icon={<Flag className="size-4 text-warning" />} n={data.inbox.needsHuman} label={t("in.needsHuman")} />
                <InboxStat href="/panel/inbox?filter=in_progress" icon={<Hand className="size-4 text-info" />} n={data.inbox.inProgress} label={t("in.inProgress")} />
                <InboxStat href="/panel/inbox?filter=resolved" icon={<CheckCircle2 className="size-4 text-success" />} n={data.inbox.resolved} label={t("in.resolved")} />
              </div>
              <p className="mt-3 text-xs muted">{t("di.inboxHint")}</p>
            </Card>

            {books ? (
              <Card>
                <h3 className="mb-3 flex items-center gap-1.5 font-semibold strong">
                  <CalendarCheck className="size-4 text-[var(--accent)]" /> {t("di.bookings")}
                </h3>
                <dl className="space-y-2 text-sm">
                  <Row k={t("di.completedBookings")} v={num(data.bookings.completed, locale)} />
                  <Row k={t("di.noShowRate")} v={`${num(pct(data.bookings.noShow, data.bookings.past), locale)}٪`} warn={data.bookings.past >= 10 && pct(data.bookings.noShow, data.bookings.past) > 10} />
                  <Row k={t("di.cancelled")} v={num(data.bookings.cancelled, locale)} />
                  <Row k={t("di.onlineShare")} v={`${num(pct(data.bookings.online, data.bookings.past), locale)}٪`} />
                  <Row k={t("di.upcoming")} v={num(data.bookings.upcoming7d, locale)} />
                </dl>
              </Card>
            ) : (
              <ChannelsCard data={data} />
            )}
          </div>
          {books && sells && data.channels.length > 0 && <ChannelsCard data={data} />}
        </>
      )}
    </section>
  );
}

function ChannelsCard({ data }: { data: Insights }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <h3 className="mb-3 font-semibold strong">{t("di.channels")}</h3>
      {data.channels.length === 0 ? (
        <p className="py-6 text-center text-sm muted">{t("di.noSales")}</p>
      ) : (
        <RankBars
          items={data.channels.map((c) => ({
            key: c.channel,
            label: t(`ch.${c.channel}` as DictKey),
            value: c.total,
            note: `${num(c.orders, locale)} ${t("di.orders")}`,
          }))}
          format={(v) => money(v, locale, false)}
        />
      )}
    </Card>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <Card className="!p-4">
      <p className="text-xs muted">{label}</p>
      <p className="num mt-2 text-xl font-bold strong sm:text-2xl">{value}</p>
      {sub && <div className="mt-1 text-xs muted">{sub}</div>}
    </Card>
  );
}

function Row({ k, v, warn, note }: { k: ReactNode; v: string; warn?: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="muted">{k}</dt>
      <dd className={clsx("num font-medium", warn ? "text-warning" : "strong")}>
        {v}
        {note && <span className="ms-1 text-[11px]">({note})</span>}
      </dd>
    </div>
  );
}

function InboxStat({ href, icon, n, label }: { href: string; icon: ReactNode; n: number; label: string }) {
  const { locale } = useI18n();
  return (
    <Link href={href} className="rounded-xl bg-[var(--surface-sunken)] px-2 py-3 transition hover:ring-1 hover:ring-gold/40">
      <span className="flex justify-center">{icon}</span>
      <b className="num mt-1 block text-lg leading-none strong">{num(n, locale)}</b>
      <span className="text-[11px] muted">{label}</span>
    </Link>
  );
}

/** Steps of one measure, each bar relative to the first step; the drop between steps is the story. */
function Funnel({ steps }: { steps: { icon: ReactNode; label: string; value: number }[] }) {
  const { locale } = useI18n();
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => (
        <li key={s.label}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 strong">
              {s.icon} {s.label}
            </span>
            <span className="num muted">
              {num(s.value, locale)}
              {i > 0 && steps[0]!.value > 0 && <span className="ms-1">({num(pct(s.value, steps[0]!.value), locale)}٪)</span>}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-[var(--surface-sunken)]">
            <div className="h-full rounded-full" style={{ width: `${Math.max(s.value ? 2 : 0, (s.value / top) * 100)}%`, background: "var(--series-1)" }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
