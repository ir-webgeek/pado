"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowLeft, Bot, Building2, CalendarCheck2, Coins, MessagesSquare, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLAN_IDS } from "@shopino/shared";
import { Logo } from "@/components/logo";
import { LangToggle, ThemeToggle } from "@/components/prefs";
import { Badge, Button, Card, Input, Modal, Select, Spinner, Tabs, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, money, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";

type Tab = "overview" | "shops" | "bookings" | "dms" | "fees";

/** Platform super admin: clients (shops), their reservations, and how automated DMs are being handled. */
export default function AdminPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: me, error } = useApi<{ user: { isSuperAdmin: boolean } }>("/auth/me", { revalidateOnFocus: false });
  const [tab, setTab] = useState<Tab>("overview");
  const [shopFilter, setShopFilter] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (error || (me && !me.user.isSuperAdmin)) router.replace("/panel");
  }, [me, error, router]);
  if (!me?.user.isSuperAdmin) return <Spinner className="mx-auto mt-20" />;

  return (
    <div className="night-sky min-h-dvh">
      <header className="glass sticky top-0 z-30 !rounded-none !border-x-0 !border-t-0">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Logo label={t("brand.name")} />
            <Badge tone="gold">{t("p.admin")}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <LangToggle />
            <ThemeToggle />
            <Link href="/panel" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm muted">
              <ArrowLeft className="size-4 rtl:rotate-180" /> {t("p.dashboard")}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: "overview", label: t("ad.overview") },
              { value: "shops", label: t("ad.shops") },
              { value: "bookings", label: t("ad.bookings") },
              { value: "dms", label: t("ad.dms") },
              { value: "fees", label: t("ad.fees") },
            ]}
          />
          {shopFilter && (
            <button onClick={() => setShopFilter(null)} className="rounded-full border border-gold/50 px-3 py-1 text-xs text-[var(--accent)]">
              {shopFilter.name} ✕
            </button>
          )}
        </div>
        {tab === "overview" && <Overview />}
        {tab === "shops" && <Shops onPick={(s, next) => (setShopFilter(s), setTab(next))} />}
        {tab === "bookings" && <Bookings shopId={shopFilter?.id} />}
        {tab === "dms" && <Dms shopId={shopFilter?.id} />}
        {tab === "fees" && <Fees />}
      </main>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, warn }: { icon: typeof Bot; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-2 text-xs muted">
        <Icon className={clsx("size-4", warn ? "text-warning" : "text-[var(--accent)]")} /> {label}
      </div>
      <p className="num mt-2 text-2xl font-bold strong">{value}</p>
      {sub && <p className="mt-1 text-xs muted">{sub}</p>}
    </Card>
  );
}

function Overview() {
  const { t, locale } = useI18n();
  const { data } = useApi<{
    shops: { total: number; suspended: number; fresh: number; byPlan: Record<string, number> };
    payments30d: { volume: number; platformFees: number; count: number };
    bookings30d: { total: number; online: number; offline: number; noShow: number };
    ai7d: { runs: number; cost: number; handoffs: number; errors: number; avgMs: number };
    automations7d: { hits: number; failed: number };
    conversations: { needsHuman: number; total: number };
  }>("/admin/overview", { refreshInterval: 30_000 });
  if (!data) return <Spinner />;
  const n = (v: number) => num(v, locale);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Building2} label={t("ad.shops")} value={n(data.shops.total)} sub={`+${n(data.shops.fresh)} · ${n(data.shops.suspended)} ${t("ad.suspend")}`} />
        <Stat icon={Coins} label={t("ad.volume")} value={money(data.payments30d.volume, locale, false)} sub={`${t("ad.fees")}: ${money(data.payments30d.platformFees, locale)}`} />
        <Stat icon={CalendarCheck2} label={t("ad.bookings")} value={n(data.bookings30d.total)} sub={`${t("ap.online")} ${n(data.bookings30d.online)} · ${t("ap.offline")} ${n(data.bookings30d.offline)} · ${t("st.no_show")} ${n(data.bookings30d.noShow)}`} />
        <Stat icon={AlertTriangle} label={t("ad.needsHuman")} value={n(data.conversations.needsHuman)} sub={`/ ${n(data.conversations.total)}`} warn={data.conversations.needsHuman > 0} />
        <Stat icon={Bot} label={t("ad.aiRuns")} value={n(data.ai7d.runs)} sub={`${t("ad.handoffs")} ${n(data.ai7d.handoffs)} · ${t("ad.errors")} ${n(data.ai7d.errors)} · ${n(data.ai7d.avgMs)}ms`} warn={data.ai7d.errors > 0} />
        <Stat icon={Coins} label={t("ad.aiCost")} value={money(data.ai7d.cost, locale, false)} />
        <Stat icon={Zap} label={t("ad.ruleHits")} value={n(data.automations7d.hits)} sub={`${t("ad.errors")} ${n(data.automations7d.failed)}`} warn={data.automations7d.failed > 0} />
        <Card className="!p-4">
          <p className="text-xs muted">{t("ad.plan")}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(data.shops.byPlan).map(([p, c]) => (
              <Badge key={p} tone="gold">{p}: {n(c)}</Badge>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

interface ShopRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  plan: string;
  walletBalance: number;
  suspendedAt: string | null;
  instagram: string | null;
  ownerPhone: string;
  bookings30d: number;
  orders30d: number;
  aiRuns7d: number;
}

function Shops({ onPick }: { onPick: (s: { id: string; name: string }, tab: Tab) => void }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const { data, mutate } = useApi<ShopRow[]>(`/admin/shops?limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const [wallet, setWallet] = useState<ShopRow | null>(null);
  const patch = async (id: string, body: object) => {
    await api(`/admin/shops/${id}`, { method: "PATCH", json: body });
    mutate();
  };
  return (
    <Card className="space-y-3 !p-0">
      <div className="p-3">
        <Input placeholder={t("a.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-xs muted">
              <tr>
                {["ad.shops", "ad.plan", "p.wallet", "ad.bookings", "p.orders", "ad.aiRuns", ""].map((k) => (
                  <th key={k} className="p-3 text-start font-medium">{k ? t(k as DictKey) : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {data.map((s) => (
                <tr key={s.id} className={clsx(s.suspendedAt && "opacity-50")}>
                  <td className="p-3">
                    <p className="font-medium strong">{s.name}</p>
                    <p className="num text-xs muted" dir="ltr">/{s.slug} · {s.ownerPhone} {s.instagram ? `· @${s.instagram}` : ""}</p>
                  </td>
                  <td className="p-3">
                    <Select className="!w-28 !py-1 text-xs" value={s.plan} onChange={(e) => patch(s.id, { plan: e.target.value })}>
                      {PLAN_IDS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="p-3">
                    <button className="num text-xs strong underline decoration-dotted" onClick={() => setWallet(s)}>{money(s.walletBalance, locale)}</button>
                  </td>
                  <td className="p-3">
                    <button className="num text-[var(--accent)]" onClick={() => onPick(s, "bookings")}>{num(s.bookings30d, locale)}</button>
                  </td>
                  <td className="num p-3">{num(s.orders30d, locale)}</td>
                  <td className="p-3">
                    <button className="num text-[var(--accent)]" onClick={() => onPick(s, "dms")}>{num(s.aiRuns7d, locale)}</button>
                  </td>
                  <td className="p-3 text-end">
                    <Button size="sm" variant={s.suspendedAt ? "secondary" : "danger"} onClick={() => patch(s.id, { suspended: !s.suspendedAt })}>
                      {s.suspendedAt ? t("ad.unsuspend") : t("ad.suspend")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {wallet && <WalletAdjust shop={wallet} onClose={() => setWallet(null)} onDone={() => (setWallet(null), mutate())} />}
    </Card>
  );
}

function WalletAdjust({ shop, onClose, onDone }: { shop: ShopRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("100000");
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={onClose} title={`${shop.name} · ${t("p.wallet")}`}>
      <div className="space-y-3">
        <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="primary" className="w-full" onClick={async () => (await api(`/admin/shops/${shop.id}/wallet`, { method: "POST", json: { amount: Number(amount), note: note || "admin" } }), onDone())}>
          {t("a.save")}
        </Button>
      </div>
    </Modal>
  );
}

function Bookings({ shopId }: { shopId?: string }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState("");
  const { data } = useApi<{ id: string; code: string; status: string; channel: string; startsAt: string; price: number; paymentStatus: string; refundStatus: string | null; shopName: string; serviceName: string; staffName: string; customerName: string | null; customerPhone: string | null }[]>(
    `/admin/appointments?limit=200${shopId ? `&shopId=${shopId}` : ""}${status ? `&status=${status}` : ""}`,
  );
  return (
    <Card className="!p-0">
      <div className="p-3">
        <Select className="!w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("o.all")}</option>
          {["pending", "confirmed", "checked_in", "completed", "cancelled", "no_show"].map((s) => (
            <option key={s} value={s}>{t(`st.${s}` as DictKey)}</option>
          ))}
        </Select>
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <tbody className="divide-y divide-[var(--border)]">
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="p-3">
                    <p className="font-medium strong">{a.shopName}</p>
                    <p className="text-xs muted">{a.serviceName} · {a.staffName}</p>
                  </td>
                  <td className="p-3">
                    <p className="strong">{a.customerName}</p>
                    <p className="num text-xs muted" dir="ltr">{a.customerPhone}</p>
                  </td>
                  <td className="num p-3 text-xs">{dateTime(a.startsAt, locale)}</td>
                  <td className="p-3">
                    <Badge tone={["pos", "phone"].includes(a.channel) ? "neutral" : "info"}>{["pos", "phone"].includes(a.channel) ? t("ap.offline") : t("ap.online")}</Badge>
                  </td>
                  <td className="p-3">
                    <Badge tone={statusTone(a.status)}>{t(`st.${a.status}` as DictKey)}</Badge>
                    {a.refundStatus && <Badge tone="warning" className="ms-1">{t("ap.refund")}</Badge>}
                  </td>
                  <td className="num p-3 text-end">{money(a.price, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

interface ConvRow {
  id: string;
  channel: string;
  username: string | null;
  mode: string;
  needsHuman: boolean;
  lastMessageAt: string;
  shopName: string;
  lastText: string | null;
  aiRuns: number;
  ruleHits: number;
}

function Dms({ shopId }: { shopId?: string }) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<"all" | "needs_human" | "agent" | "human">("all");
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useApi<ConvRow[]>(`/admin/conversations?filter=${filter}${shopId ? `&shopId=${shopId}` : ""}`, { refreshInterval: 15_000 });
  return (
    <div className="grid gap-4 lg:grid-cols-[26rem_minmax(0,1fr)]">
      <Card className="space-y-2 !p-2">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: t("o.all") },
            { value: "needs_human", label: t("ad.needsHuman") },
            { value: "agent", label: t("in.agentOn") },
            { value: "human", label: t("in.humanOn") },
          ]}
        />
        {!data ? (
          <Spinner />
        ) : (
          data.map((c) => (
            <button key={c.id} onClick={() => setOpen(c.id)} className={clsx("block w-full rounded-xl px-3 py-2 text-start", open === c.id ? "bg-gold/10" : "hover:bg-[var(--surface-sunken)]")}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium strong">{c.shopName} · {c.username ?? c.channel}</span>
                {c.needsHuman && <AlertTriangle className="size-4 text-warning" />}
              </span>
              <span className="block truncate text-xs muted">{c.lastText}</span>
              <span className="mt-1 flex gap-1.5 text-[10px]">
                <Badge tone={c.mode === "agent" ? "gold" : "info"}>{c.mode}</Badge>
                <Badge><Bot className="size-3" /> {num(c.aiRuns, locale)}</Badge>
                <Badge><Zap className="size-3" /> {num(c.ruleHits, locale)}</Badge>
              </span>
            </button>
          ))
        )}
      </Card>
      {open ? <ConversationDetail id={open} /> : <Card><p className="py-16 text-center muted"><MessagesSquare className="mx-auto mb-2 size-6" />{t("in.pick")}</p></Card>}
    </div>
  );
}

function ConversationDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const { data } = useApi<{
    conversation: { username: string | null; mode: string };
    messages: { id: string; direction: string; sender: string; text: string; createdAt: string }[];
    agentRuns: { id: string; createdAt: string; tools: { name: string; ok: boolean }[]; handoff: string | null; error: string | null; cost: number; durationMs: number; inputTokens: number; outputTokens: number }[];
    automationEvents: { id: string; createdAt: string; ruleName: string | null; trigger: string; ok: boolean; error: string | null }[];
  }>(`/admin/conversations/${id}`);
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="max-h-[75dvh] space-y-2 overflow-y-auto">
        {data.messages.map((m) => (
          <div key={m.id} className={clsx("flex max-w-[85%] flex-col", m.direction === "out" ? "ms-auto items-end" : "items-start")}>
            <div className={clsx("whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm", m.direction === "in" ? "bg-[var(--surface-sunken)] strong" : m.sender === "agent" ? "bg-[var(--accent)] text-[var(--accent-ink)]" : m.sender === "system" ? "bg-info/15 strong" : "bg-success/15 strong")}>{m.text}</div>
            <span className="text-[10px] muted">{m.sender} · {dateTime(m.createdAt, locale)}</span>
          </div>
        ))}
      </Card>
      <div className="space-y-3">
        <Card className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold strong"><Bot className="size-4" /> {t("ad.aiRuns")}</p>
          {data.agentRuns.length === 0 && <p className="text-xs muted">—</p>}
          {data.agentRuns.map((r) => (
            <div key={r.id} className="rounded-xl bg-[var(--surface-sunken)] p-2 text-xs">
              <p className="muted">{dateTime(r.createdAt, locale)} · {num(r.durationMs, locale)}ms · {money(r.cost, locale)}</p>
              <p className="mt-1 flex flex-wrap gap-1">
                {r.tools.map((tl, i) => (
                  <Badge key={i} tone={tl.ok ? "success" : "danger"}>{tl.name}</Badge>
                ))}
              </p>
              {r.handoff && <p className="mt-1 text-warning">⚑ {r.handoff}</p>}
              {r.error && <p className="mt-1 text-danger">{r.error}</p>}
            </div>
          ))}
        </Card>
        <Card className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold strong"><Zap className="size-4" /> {t("p.automations")}</p>
          {data.automationEvents.length === 0 && <p className="text-xs muted">—</p>}
          {data.automationEvents.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="strong">{e.ruleName ?? e.trigger}</span>
              <Badge tone={e.ok ? "success" : "danger"}>{e.ok ? "ok" : e.error?.slice(0, 30)}</Badge>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Fees() {
  const { t, locale } = useI18n();
  const { data } = useApi<{ shopId: string; shopName: string; volume: number; fees: number; n: number }[]>("/admin/fees");
  if (!data) return <Spinner />;
  return (
    <Card className="!p-0">
      <table className="w-full text-sm">
        <thead className="text-xs muted">
          <tr>
            <th className="p-3 text-start">{t("ad.shops")}</th>
            <th className="p-3 text-start">{t("ad.volume")}</th>
            <th className="p-3 text-start">{t("ad.fees")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {data.map((f) => (
            <tr key={f.shopId}>
              <td className="p-3 strong">{f.shopName}</td>
              <td className="num p-3">{money(Number(f.volume), locale)}</td>
              <td className="num p-3 text-[var(--accent)]">{money(Number(f.fees), locale)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={3} className="p-8 text-center muted">—</td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
