"use client";

import clsx from "clsx";
import { Crown, Megaphone, Search, Users } from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { date, dateTime, latinDigits, money, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import type { Customer } from "@/lib/types";

const SEGMENTS = ["all", "vip", "regular", "new", "at_risk", "lost", "near_vip"] as const;
type Seg = (typeof SEGMENTS)[number];

export default function CustomersPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [seg, setSeg] = useState<Seg>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [campaign, setCampaign] = useState(false);
  const list = useApi<{ items: Customer[]; counts: Record<string, number>; vipRule: { minOrders: number; minSpend: number; withinDays: number } }>(
    seg === "near_vip" ? null : `/shops/${shop.id}/customers?limit=100&sort=${seg === "at_risk" || seg === "lost" ? "spent" : "recent"}${seg !== "all" ? `&segment=${seg}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );
  const near = useApi<Customer[]>(seg === "near_vip" ? `/shops/${shop.id}/customers/near-vip` : null);
  const counts = list.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = seg === "near_vip" ? near.data : list.data?.items;
  const rule = list.data?.vipRule;

  return (
    <div>
      <PageHeader
        title={t("p.customers")}
        subtitle={rule && `${t("c.vipRule")}: ${num(rule.minOrders, locale)}+ ${t("c.orders")} · ${money(rule.minSpend, locale)} · ${num(rule.withinDays, locale)} ${locale === "fa" ? "روز" : "days"}`}
        actions={
          <Button variant="primary" onClick={() => setCampaign(true)}>
            <Megaphone className="size-4" /> {t("c.campaign")}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["vip", "regular", "at_risk", "new"] as const).map((s) => (
          <button key={s} onClick={() => setSeg(s)} className="card flex items-center gap-3 p-3 text-start transition hover:border-gold/40">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--surface-sunken)]">
              {s === "vip" ? <Crown className="size-5 text-[var(--accent)]" /> : <Users className="size-5 muted" />}
            </span>
            <span>
              <b className="num block text-xl strong">{num(counts[s] ?? 0, locale)}</b>
              <span className="text-xs muted">{t(`seg.${s}` as DictKey)}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs
          value={seg}
          onChange={setSeg}
          items={SEGMENTS.map((s) => ({ value: s, label: s === "all" ? t("c.all") : s === "near_vip" ? t("c.nearVip") : t(`seg.${s}` as DictKey), count: s === "all" ? total : s === "near_vip" ? undefined : counts[s] }))}
        />
        {seg !== "near_vip" && (
          <div className="relative sm:ms-auto sm:w-64">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 muted" />
            <Input className="ps-9" placeholder={t("a.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>

      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <Empty icon={<Users className="size-6" />} title="—" />
        </Card>
      ) : (
        <Card className="!p-0">
          <div className="divide-y divide-[var(--border)]">
            {rows.map((c) => (
              <button key={c.id} onClick={() => setOpen(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-[var(--surface-sunken)]">
                <Avatar name={c.name ?? c.instagramUsername} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium strong">{c.name ?? `@${c.instagramUsername ?? "—"}`}</span>
                    <Badge tone={statusTone(c.segment)}>{t(`seg.${c.segment}` as DictKey)}</Badge>
                  </span>
                  <span className="num block truncate text-xs muted">
                    {num(c.ordersCount, locale)} {t("c.orders")} · {num(c.appointmentsCount, locale)} {t("c.visits")} · {t("c.last")}: {date(c.lastOrderAt ?? c.lastVisitAt, locale)}
                  </span>
                </span>
                {c.vipProgress !== undefined && (
                  <span className="hidden w-28 sm:block">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                      <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${c.vipProgress * 100}%` }} />
                    </span>
                  </span>
                )}
                <span className="num text-end text-sm strong">
                  {money(c.totalSpent, locale)}
                  <span className="block text-[11px] font-normal muted">
                    {num(c.points, locale)} {t("c.points")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}
      {open && <CustomerModal id={open} onClose={() => setOpen(null)} />}
      {campaign && <CampaignModal initialSegment={seg === "near_vip" || seg === "all" ? "all" : seg} onClose={() => setCampaign(false)} />}
    </div>
  );
}

function CustomerModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<{
    customer: Customer;
    orders: { id: string; code: string; total: number; status: string; createdAt: string }[];
    appointments: { id: string; serviceName: string; startsAt: string; status: string }[];
    points: { id: string; delta: number; reason: string; createdAt: string }[];
    wallet: WalletTx[];
  }>(`/shops/${shop.id}/customers/${id}`);
  const [notes, setNotes] = useState<string | null>(null);
  if (!data) return null;
  const c = data.customer;
  return (
    <Modal open onClose={onClose} title={c.name ?? c.phone ?? "—"} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(c.segment)}>{t(`seg.${c.segment}` as DictKey)}</Badge>
          {c.phone && <span className="num text-sm muted" dir="ltr">{c.phone}</span>}
          {c.instagramUsername && <span className="text-sm muted" dir="ltr">@{c.instagramUsername}</span>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            [t("c.spent"), money(c.totalSpent, locale)],
            [t("c.orders"), num(c.ordersCount, locale)],
            [t("c.visits"), num(c.appointmentsCount, locale)],
            [t("c.points"), num(c.points, locale)],
            [t("w.customer"), money(c.walletBalance, locale)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-[var(--surface-sunken)] p-3">
              <p className="text-[11px] muted">{k}</p>
              <p className="num mt-1 font-bold strong">{v}</p>
            </div>
          ))}
        </div>
        <Field label={t("ap.note")}>
          <Textarea
            className="min-h-16"
            value={notes ?? c.notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== null && api(`/shops/${shop.id}/customers/${c.id}`, { method: "PATCH", json: { notes } })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="label">{t("p.orders")}</p>
            <ul className="space-y-1.5 text-sm">
              {data.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
                  <span className="num" dir="ltr">{o.code}</span>
                  <span className="num muted">{money(o.total, locale)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label">{t("p.appointments")}</p>
            <ul className="space-y-1.5 text-sm">
              {data.appointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
                  <span className="truncate">{a.serviceName}</span>
                  <span className="text-xs muted">{dateTime(a.startsAt, locale)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <CustomerWallet customerId={c.id} history={data.wallet} onChanged={() => mutate()} />
      </div>
    </Modal>
  );
}

interface WalletTx {
  id: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  note: string | null;
  createdAt: string;
}

function CustomerWallet({ customerId, history, onChanged }: { customerId: string; history: WalletTx[]; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const value = Number(latinDigits(amount).replace(/[^\d-]/g, "") || 0);
  async function adjust() {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/customers/${customerId}/wallet`, { method: "POST", json: { amount: value, note: note || undefined } });
      setAmount("");
      setNote("");
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
      <p className="label">{t("w.adjust")}</p>
      <div className="flex flex-wrap gap-2">
        <Input className="!w-40" dir="ltr" inputMode="numeric" placeholder="-50000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input className="min-w-40 flex-1" placeholder={t("ap.note")} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button loading={busy} disabled={!value} onClick={adjust}>
          {t("a.save")}
        </Button>
      </div>
      <p className="text-xs muted">{t("w.amountHint")}</p>
      <ErrorNote error={error} />
      {history.length > 0 && (
        <ul className="space-y-1 text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-1.5">
              <span className="truncate">
                {t(`w.reason.${h.reason}` as DictKey)}
                {h.note && <span className="muted"> · {h.note}</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className={clsx("num", h.amount > 0 ? "text-success" : "text-danger")} dir="ltr">
                  {h.amount > 0 ? "+" : ""}
                  {num(h.amount, locale)}
                </span>
                <span className="text-xs muted">{dateTime(h.createdAt, locale)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignModal({ initialSegment, onClose }: { initialSegment: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [segment, setSegment] = useState(initialSegment);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ recipients: number; parts: number; cost: number; balance: number } | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const body = { name: name || segment, segment, message };

  return (
    <Modal open onClose={onClose} title={t("c.campaign")}>
      {sent ? (
        <p className="py-6 text-center strong">✓ {t("s.saved")}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("fm.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("p.customers")}>
              <Select value={segment} onChange={(e) => (setSegment(e.target.value), setPreview(null))}>
                {["all", "vip", "regular", "new", "at_risk", "lost"].map((s) => (
                  <option key={s} value={s}>{s === "all" ? t("c.all") : t(`seg.${s}` as DictKey)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("c.sms")} hint={`${num(message.length, locale)}`}>
            <Textarea value={message} onChange={(e) => (setMessage(e.target.value), setPreview(null))} />
          </Field>
          {preview && (
            <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-sm">
              {num(preview.recipients, locale)} {t("c.recipients")} · {num(preview.parts, locale)} part · {t("c.cost")}: <b className="strong">{money(preview.cost, locale)}</b> ({t("s.wallet")}: {money(preview.balance, locale)})
            </p>
          )}
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button
              disabled={message.length < 5}
              onClick={async () => {
                setError(null);
                try {
                  setPreview(await api(`/shops/${shop.id}/campaigns/preview`, { method: "POST", json: body }));
                } catch (e) {
                  setError(e);
                }
              }}
            >
              {t("c.cost")}
            </Button>
            <Button
              variant="primary"
              disabled={!preview || preview.recipients === 0}
              onClick={async () => {
                try {
                  await api(`/shops/${shop.id}/campaigns`, { method: "POST", json: body });
                  setSent(true);
                } catch (e) {
                  setError(e);
                }
              }}
            >
              {t("c.campaignSend")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
