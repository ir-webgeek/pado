"use client";

import { Package, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Avatar, Badge, Button, Card, Empty, Input, PageHeader, Spinner, Tabs, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, money, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import type { OrderRow } from "@/lib/types";

const TABS = ["all", "awaiting_payment", "confirmed", "processing", "ready_to_ship", "shipped", "completed", "cancelled", "receipts"] as const;
type Tab = (typeof TABS)[number];

export default function OrdersPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const router = useRouter();
  const params = useSearchParams();
  const tab = ((params.get("tab") ?? params.get("status") ?? "all") as Tab) || "all";
  const [q, setQ] = useState("");
  const query = new URLSearchParams({ limit: "50", ...(tab !== "all" && tab !== "receipts" ? { status: tab } : {}), ...(q ? { q } : {}) });
  const { data, mutate } = useApi<{ items: OrderRow[]; counts: Record<string, number> }>(tab === "receipts" ? null : `/shops/${shop.id}/orders?${query}`);
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const next: Record<string, { to: string; label: DictKey }> = {
    confirmed: { to: "processing", label: "a.startProcessing" },
    processing: { to: "ready_to_ship", label: "a.readyToShip" },
    shipped: { to: "delivered", label: "a.deliver" },
    delivered: { to: "completed", label: "a.complete" },
  };

  return (
    <div>
      <PageHeader title={t("p.orders")} subtitle={`${num(total, locale)} · ${num(counts.ready_to_ship ?? 0, locale)} ${t("d.readyToShip")}`} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs
          value={tab}
          onChange={(v) => router.replace(`/panel/orders?tab=${v}`)}
          items={TABS.map((s) => ({
            value: s,
            label: s === "all" ? t("o.all") : s === "receipts" ? t("o.receipts") : t(`st.${s}` as DictKey),
            count: s === "all" ? total : s === "receipts" ? undefined : counts[s],
          }))}
        />
        {tab !== "receipts" && (
          <div className="relative sm:ms-auto sm:w-64">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 muted" />
            <Input className="ps-9" placeholder={t("a.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>

      {tab === "receipts" ? (
        <Receipts />
      ) : !data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <Card>
          <Empty icon={<Package className="size-6" />} title={t("o.empty")} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {data.items.map((o) => (
            <Card key={o.id} className="flex flex-col gap-3 !p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/panel/orders/${o.id}`} className="num font-semibold strong" dir="ltr">
                  #{o.code}
                </Link>
                <Badge tone={statusTone(o.status)}>{t(`st.${o.status}` as DictKey)}</Badge>
              </div>
              <p className="-mt-2 text-[11px] muted">
                {t(`ch.${o.channel}` as DictKey)} · {dateTime(o.createdAt, locale)}
              </p>
              <div className="flex items-center gap-2.5">
                <Avatar name={o.customer?.name ?? o.address?.fullName} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm strong">{o.customer?.name ?? o.address?.fullName ?? "—"}</p>
                  <p className="num truncate text-[11px] muted" dir="ltr">
                    {o.address?.city ?? o.customer?.city ?? ""} {o.customer?.phone ?? ""}
                  </p>
                </div>
                <Badge tone={statusTone(o.paymentStatus)}>{t(`pay.${o.paymentStatus}` as DictKey)}</Badge>
              </div>
              <ul className="space-y-1 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-xs">
                {o.items.slice(0, 3).map((it, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate strong">
                      {it.title} {it.variantLabel && <span className="muted">· {it.variantLabel}</span>}
                    </span>
                    <span className="num muted">×{num(it.quantity, locale)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-2">
                <span className="num font-bold strong">{money(o.total, locale)}</span>
                {next[o.status] && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      await api(`/shops/${shop.id}/orders/${o.id}/status`, { method: "POST", json: { status: next[o.status]!.to } });
                      mutate();
                    }}
                  >
                    {t(next[o.status]!.label)}
                  </Button>
                )}
                {o.status === "ready_to_ship" && (
                  <Link href={`/panel/orders/${o.id}`}>
                    <Button size="sm" variant="primary">{t("a.ship")}</Button>
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Receipts() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<{ id: string; amount: number; receiptUrl: string | null; createdAt: string; orderId: string | null; appointmentId: string | null }[]>(`/shops/${shop.id}/payments/pending`);
  if (!data) return <Spinner />;
  if (!data.length) return <Card><Empty title={t("o.empty")} /></Card>;
  const review = async (id: string, approve: boolean) => {
    await api(`/shops/${shop.id}/payments/${id}/review`, { method: "POST", json: { approve } });
    mutate();
  };
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {data.map((p) => (
        <Card key={p.id} className="space-y-3">
          {p.receiptUrl && (
            <a href={p.receiptUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.receiptUrl} alt="receipt" className="h-48 w-full rounded-xl object-cover" />
            </a>
          )}
          <div className="flex items-center justify-between">
            <span className="num font-bold strong">{money(p.amount, locale)}</span>
            <span className="text-xs muted">{dateTime(p.createdAt, locale)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={() => review(p.id, true)}>{t("a.approve")}</Button>
            <Button variant="danger" onClick={() => review(p.id, false)}>{t("a.reject")}</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
