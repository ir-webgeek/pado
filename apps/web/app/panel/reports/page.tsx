"use client";

import clsx from "clsx";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EXPENSE_CATEGORIES, addDaysIso, daysBetweenIso, isoToJalali, jalaliToIso, zonedIsoDate, zonedToUtc } from "@shopino/shared";
import { GroupedColumns, RankBars, StatTile, type ColumnGroup } from "@/components/charts";
import { DatePicker } from "@/components/date-picker";
import { Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Tabs } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { monthOf } from "@/lib/calendar";
import { date as fmtDate, latinDigits, money, num } from "@/lib/format";
import type { DictKey, Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

type Tab = "performance" | "finance" | "expenses";
type Preset = "7" | "30" | "90" | "month" | "lastMonth" | "year";
/** inclusive start, exclusive end, ISO dates in the shop timezone */
interface Range {
  from: string;
  to: string;
}

function presetRange(p: Preset, today: string, locale: Locale): Range {
  const tomorrow = addDaysIso(today, 1);
  if (p === "7" || p === "30" || p === "90") return { from: addDaysIso(tomorrow, -Number(p)), to: tomorrow };
  const m = monthOf(today, locale);
  if (p === "month") return { from: m.first, to: tomorrow };
  if (p === "lastMonth") return { from: monthOf(m.prev, locale).first, to: m.first };
  const yearStart = locale === "fa" ? jalaliToIso(isoToJalali(today).jy, 1, 1) : `${today.slice(0, 4)}-01-01`;
  return { from: yearStart, to: tomorrow };
}

function useShopTz() {
  const { shop } = useShop();
  const { data } = useApi<{ shop: { timezone: string } }>(`/shops/${shop.id}`, { revalidateOnFocus: false });
  return data?.shop.timezone ?? "Asia/Tehran";
}

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const tz = useShopTz();
  const today = zonedIsoDate(new Date(), tz);
  const [tab, setTab] = useState<Tab>("performance");
  const [preset, setPreset] = useState<Preset | null>("30");
  const [range, setRange] = useState<Range>(() => presetRange("30", today, locale));
  const q = `from=${encodeURIComponent(zonedToUtc(range.from, 0, tz).toISOString())}&to=${encodeURIComponent(zonedToUtc(range.to, 0, tz).toISOString())}`;
  const pick = (p: Preset) => {
    setPreset(p);
    setRange(presetRange(p, today, locale));
  };
  return (
    <div>
      <PageHeader title={t("p.reports")} />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "performance", label: t("rp.performance") },
            { value: "finance", label: t("rp.finance") },
            { value: "expenses", label: t("rp.expenses") },
          ]}
        />
      </div>
      <Card className="mb-4 flex flex-wrap items-end gap-3 !p-3">
        <div className="flex flex-wrap gap-1">
          {(["7", "30", "90", "month", "lastMonth", "year"] as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => pick(p)}
              className={clsx("rounded-full px-3 py-1.5 text-xs transition", preset === p ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "muted hover:bg-[var(--surface-sunken)]")}
            >
              {t(`rp.range.${p}` as DictKey)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Field label={t("rp.from")} className="w-60">
            <DatePicker tz={tz} value={range.from} max={addDaysIso(range.to, -1)} onChange={(d) => (setPreset(null), setRange((r) => ({ ...r, from: d })))} />
          </Field>
          <Field label={t("rp.to")} className="w-60">
            <DatePicker tz={tz} value={addDaysIso(range.to, -1)} min={range.from} onChange={(d) => (setPreset(null), setRange((r) => ({ ...r, to: addDaysIso(d, 1) })))} />
          </Field>
        </div>
      </Card>
      {tab === "performance" ? <Performance q={q} /> : tab === "finance" ? <Finance q={q} range={range} /> : <Expenses q={q} tz={tz} today={today} />}
    </div>
  );
}

interface PerfResp {
  staff: { id: string; name: string; color: string; total: number; completed: number; noShow: number; cancelled: number; revenue: number; minutes: number }[];
  services: { id: string; name: string; completed: number; revenue: number }[];
  products: { title: string; sold: number; revenue: number }[];
  orderChannels: { channel: string; n: number; total: number }[];
  appointmentChannels: { channel: string; n: number }[];
  appointmentStatus: Record<string, number>;
  newCustomers: number;
  fromDm: { orders: number; revenue: number; bookings: number };
}

function Performance({ q }: { q: string }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data } = useApi<PerfResp>(`/shops/${shop.id}/reports/performance?${q}`);
  if (!data) return <Spinner />;
  const bookings = shop.kind !== "retail";
  const store = shop.kind !== "services";
  const ordersTotal = data.orderChannels.reduce((s, c) => s + c.total, 0);
  const ordersCount = data.orderChannels.reduce((s, c) => s + c.n, 0);
  const serviceRevenue = data.services.reduce((s, x) => s + x.revenue, 0);
  const offline = data.appointmentChannels.filter((c) => ["pos", "phone"].includes(c.channel)).reduce((s, c) => s + c.n, 0);
  const online = data.appointmentChannels.reduce((s, c) => s + c.n, 0) - offline;
  const m = (v: number) => money(v, locale);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {store && <StatTile label={t("rp.revOrders")} value={m(ordersTotal)} sub={`${num(ordersCount, locale)} ${t("rp.orders")}`} />}
        {bookings && <StatTile label={t("rp.revServices")} value={m(serviceRevenue)} sub={`${num(data.appointmentStatus.completed ?? 0, locale)} ${t("rp.completed")}`} />}
        {bookings && (
          <StatTile
            label={t("rp.bookings")}
            value={num(online + offline, locale)}
            sub={`${t("ap.online")} ${num(online, locale)} · ${t("ap.offline")} ${num(offline, locale)}`}
          />
        )}
        <StatTile label={t("rp.newCustomers")} value={num(data.newCustomers, locale)} />
        <StatTile
          label={t("rp.fromDm")}
          value={store ? m(data.fromDm.revenue) : num(data.fromDm.bookings, locale)}
          sub={[store && `${num(data.fromDm.orders, locale)} ${t("rp.orders")}`, bookings && `${num(data.fromDm.bookings, locale)} ${t("rp.bookings")}`].filter(Boolean).join(" · ")}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {bookings && (
          <Card>
            <h3 className="mb-3 font-semibold strong">{t("rp.staff")}</h3>
            {data.staff.length === 0 ? (
              <Empty title={t("rp.noData")} />
            ) : (
              <RankBars
                format={m}
                items={data.staff.map((s) => ({
                  key: s.id,
                  label: s.name,
                  value: s.revenue,
                  note: `${num(s.completed, locale)} ${t("rp.completed")} · ${num(s.noShow, locale)} ${t("rp.noShow")} · ${num(Math.round(s.minutes / 6) / 10, locale)} ${t("rp.hours")}`,
                }))}
              />
            )}
          </Card>
        )}
        {bookings && (
          <Card>
            <h3 className="mb-3 font-semibold strong">{t("rp.services")}</h3>
            {data.services.length === 0 ? (
              <Empty title={t("rp.noData")} />
            ) : (
              <RankBars format={m} items={data.services.map((s) => ({ key: s.id, label: s.name, value: s.revenue, note: `${num(s.completed, locale)} ${t("rp.completed")}` }))} />
            )}
          </Card>
        )}
        {store && (
          <Card>
            <h3 className="mb-3 font-semibold strong">{t("rp.products")}</h3>
            {data.products.length === 0 ? (
              <Empty title={t("rp.noData")} />
            ) : (
              <RankBars format={m} items={data.products.map((p) => ({ key: p.title, label: p.title, value: p.revenue, note: `${num(p.sold, locale)} ${t("rp.sold")}` }))} />
            )}
          </Card>
        )}
        {store && (
          <Card>
            <h3 className="mb-3 font-semibold strong">{t("rp.channels")}</h3>
            {data.orderChannels.length === 0 ? (
              <Empty title={t("rp.noData")} />
            ) : (
              <RankBars
                format={m}
                items={[...data.orderChannels].sort((a, b) => b.total - a.total).map((c) => ({ key: c.channel, label: t(`ch.${c.channel}` as DictKey), value: c.total, note: `${num(c.n, locale)} ${t("rp.orders")}` }))}
              />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

interface FinanceResp {
  revenue: { orders: number; services: number; keptDeposits: number; total: number; orderCount: number; serviceCount: number; shipping: number };
  cogs: { total: number; itemsMissingCost: number };
  grossProfit: number;
  expenses: { total: number; byCategory: { category: string; total: number }[] };
  platform: { total: number; byKind: { kind: string; total: number }[] };
  netProfit: number;
  cashIn: { method: string; total: number; count: number }[];
  customerWalletLiability: number;
  daily: { day: string; income: number; expenses: number }[];
}

/** Daily buckets for short ranges, calendar months (Jalali in fa) for long ones. */
function bucket(daily: FinanceResp["daily"], range: Range, locale: Locale): ColumnGroup[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days = daysBetweenIso(range.from, range.to);
  const out: ColumnGroup[] = [];
  if (days <= 45) {
    for (let d = range.from; d < range.to; d = addDaysIso(d, 1)) {
      const v = byDay.get(d);
      const at = `${d}T12:00:00Z`;
      out.push({
        key: d,
        label: fmtDate(at, locale, "UTC", { weekday: "short", day: "numeric", month: "long" }),
        tick: fmtDate(at, locale, "UTC", { day: "numeric" }),
        values: [v?.income ?? 0, v?.expenses ?? 0],
      });
    }
    return out;
  }
  for (let first = monthOf(range.from, locale).first; first < range.to; ) {
    const m = monthOf(first, locale);
    let income = 0;
    let expenses = 0;
    for (const d of m.days) {
      const v = byDay.get(d);
      income += v?.income ?? 0;
      expenses += v?.expenses ?? 0;
    }
    out.push({ key: m.first, label: m.label, values: [income, expenses] });
    first = m.next;
  }
  return out;
}

function Finance({ q, range }: { q: string; range: Range }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, error } = useApi<FinanceResp>(`/shops/${shop.id}/reports/finance?${q}`);
  const groups = useMemo(() => (data ? bucket(data.daily, range, locale) : []), [data, range, locale]);
  if (error instanceof ApiError && error.status === 403) return <Card><p className="py-8 text-center muted">{t("rp.adminOnly")}</p></Card>;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const m = (v: number) => money(v, locale);
  const costs = data.expenses.total + data.platform.total;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t("rp.revenue")}
          value={m(data.revenue.total)}
          sub={[
            data.revenue.orders > 0 && `${t("rp.revOrders")} ${money(data.revenue.orders, locale, false)}`,
            data.revenue.services > 0 && `${t("rp.revServices")} ${money(data.revenue.services, locale, false)}`,
            data.revenue.keptDeposits > 0 && `${t("rp.kept")} ${money(data.revenue.keptDeposits, locale, false)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <StatTile label={t("rp.cogs")} value={m(data.cogs.total)} />
        <StatTile label={t("rp.gross")} value={m(data.grossProfit)} />
        <StatTile label={t("rp.expenses")} value={m(costs)} sub={data.platform.total > 0 ? `${t("rp.platform")}: ${money(data.platform.total, locale, false)}` : undefined} />
        <StatTile label={t("rp.net")} value={m(data.netProfit)} tone={data.netProfit >= 0 ? "good" : "bad"} />
      </div>
      {data.cogs.itemsMissingCost > 0 && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {num(data.cogs.itemsMissingCost, locale)} {t("rp.missingCost")}
        </p>
      )}
      <Card>
        <h3 className="mb-3 font-semibold strong">{t("rp.incomeVsExpense")}</h3>
        <GroupedColumns
          groups={groups}
          series={[
            { name: t("rp.income"), color: "var(--series-1)" },
            { name: t("rp.expenses"), color: "var(--series-2)" },
          ]}
        />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold strong">{t("rp.byCategory")}</h3>
          {data.expenses.byCategory.length === 0 && data.platform.total === 0 ? (
            <Empty title={t("rp.noData")} />
          ) : (
            <RankBars
              color="var(--series-2)"
              format={m}
              items={[
                ...data.expenses.byCategory.map((c) => ({ key: c.category, label: t(`exp.cat.${c.category}` as DictKey), value: c.total })),
                ...(data.platform.total > 0 ? [{ key: "platform", label: t("rp.platform"), value: data.platform.total }] : []),
              ].sort((a, b) => b.value - a.value)}
            />
          )}
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold strong">{t("rp.cashIn")}</h3>
          {data.cashIn.length === 0 ? (
            <Empty title={t("rp.noData")} />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.cashIn.map((c) => (
                <li key={c.method} className="flex justify-between rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
                  <span>
                    {t(`pm.${c.method}` as DictKey)} <span className="text-xs muted">({num(c.count, locale)})</span>
                  </span>
                  <span className="num strong">{m(c.total)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 flex justify-between border-t border-[var(--border)] pt-3 text-sm">
            <span className="muted">{t("rp.walletLiability")}</span>
            <span className="num strong">{m(data.customerWalletLiability)}</span>
          </p>
        </Card>
      </div>
    </div>
  );
}

interface Expense {
  id: string;
  category: string;
  amount: number;
  spentAt: string;
  note: string | null;
}

function Expenses({ q, tz, today }: { q: string; tz: string; today: string }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, error, mutate } = useApi<Expense[]>(`/shops/${shop.id}/expenses?${q}`);
  const [category, setCategory] = useState<(typeof EXPENSE_CATEGORIES)[number]>("rent");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const value = Number(latinDigits(amount).replace(/\D/g, "") || 0);
  if (error instanceof ApiError && error.status === 403) return <Card><p className="py-8 text-center muted">{t("rp.adminOnly")}</p></Card>;

  async function add() {
    setBusy(true);
    setFormError(null);
    try {
      // noon in the shop's timezone keeps the expense on the chosen day in every report
      await api(`/shops/${shop.id}/expenses`, { method: "POST", json: { category, amount: value, spentAt: zonedToUtc(day, 12 * 60, tz).toISOString(), note: note || undefined } });
      setAmount("");
      setNote("");
      mutate();
    } catch (e) {
      setFormError(e);
    } finally {
      setBusy(false);
    }
  }
  const total = (data ?? []).reduce((s, e) => s + e.amount, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Card className="h-fit space-y-3">
        <h3 className="font-semibold strong">{t("exp.add")}</h3>
        <Field label={t("exp.category")}>
          <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(`exp.cat.${c}` as DictKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("exp.amount")} hint={value ? money(value, locale) : undefined}>
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("exp.date")}>
          <DatePicker tz={tz} value={day} max={today} onChange={setDay} />
        </Field>
        <Field label={t("ap.note")}>
          <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorNote error={formError} />
        <Button variant="primary" className="w-full" loading={busy} disabled={!value} onClick={add}>
          {t("exp.add")}
        </Button>
      </Card>
      <Card>
        {!data ? (
          <Spinner />
        ) : data.length === 0 ? (
          <Empty title={t("rp.noData")} />
        ) : (
          <>
            <ul className="divide-y divide-[var(--border)]">
              {data.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="strong">{t(`exp.cat.${e.category}` as DictKey)}</span>
                    {e.note && <span className="muted"> · {e.note}</span>}
                    <span className="block text-xs muted">{fmtDate(e.spentAt, locale, tz)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num strong">{money(e.amount, locale)}</span>
                    <button
                      type="button"
                      aria-label="delete"
                      className="rounded-full p-1.5 muted hover:text-danger"
                      onClick={async () => {
                        if (!confirm(`${t("sv.remove")}?`)) return;
                        await api(`/shops/${shop.id}/expenses/${e.id}`, { method: "DELETE" });
                        mutate();
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between border-t border-[var(--border)] pt-3 text-sm font-semibold strong">
              <span>{t("o.total")}</span>
              <span className="num">{money(total, locale)}</span>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
