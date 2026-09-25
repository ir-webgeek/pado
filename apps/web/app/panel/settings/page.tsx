"use client";

import { Check, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea, Toggle } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, latinDigits, money } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

interface Settings {
  loyalty: { enabled: boolean; tomanPerPoint: number; pointValue: number; expiryDays: number };
  vipRule: { minOrders: number; minSpend: number; withinDays: number };
  atRiskDays: number;
  booking: { slotStepMin: number; minNoticeMin: number; maxAdvanceDays: number; cancelWindowMin: number; autoConfirm: boolean; reminderOffsetsMin: number[] };
  agent: { enabled: boolean; tone: string; rules: string; neverOfferDiscount: boolean; knowledge: string };
  cardToCard: { cardNumber: string; holder: string; bank: string };
}
interface ShopResp {
  shop: { id: string; name: string; kind: string; brandColor: string; timezone: string; telegramChatId: string | null; igUsername: string | null; instagramConnected: boolean; walletBalance: number; settings: Settings };
}

type Tab = "general" | "agent" | "booking" | "loyalty" | "payments" | "integrations" | "wallet";

export default function SettingsPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<ShopResp>(`/shops/${shop.id}`);
  const [tab, setTab] = useState<Tab>("general");
  if (!data) return <Spinner />;
  const tabs: { value: Tab; label: string }[] = [
    { value: "general", label: t("s.general") },
    { value: "agent", label: t("s.agent") },
    ...(shop.kind !== "retail" ? [{ value: "booking" as Tab, label: t("s.booking") }] : []),
    { value: "loyalty", label: t("s.loyalty") },
    { value: "payments", label: t("s.payments") },
    { value: "integrations", label: t("s.integrations") },
    { value: "wallet", label: t("p.wallet") },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("p.settings")} />
      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} items={tabs} />
      </div>
      {tab === "wallet" ? <WalletCard /> : <SettingsForm key={tab} tab={tab} data={data} onSaved={() => mutate()} />}
    </div>
  );
}

function SettingsForm({ tab, data, onSaved }: { tab: Tab; data: ShopResp; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const s = data.shop.settings;
  const [general, setGeneral] = useState({ name: data.shop.name, kind: data.shop.kind, brandColor: data.shop.brandColor, timezone: data.shop.timezone });
  const [agent, setAgent] = useState(s.agent);
  const [booking, setBooking] = useState(s.booking);
  const [loyalty, setLoyalty] = useState(s.loyalty);
  const [vip, setVip] = useState({ ...s.vipRule, atRiskDays: s.atRiskDays });
  const [card, setCard] = useState(s.cardToCard);
  const [telegram, setTelegram] = useState(data.shop.telegramChatId ?? "");
  const [ig, setIg] = useState({ igUserId: "", accessToken: "", username: data.shop.igUsername ?? "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(id);
  }, [saved]);
  const n = (v: string) => Number(latinDigits(v) || 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (tab === "integrations" && ig.igUserId && ig.accessToken) {
        await api(`/shops/${shop.id}/instagram/connect`, { method: "POST", json: ig });
      }
      const body =
        tab === "general"
          ? general
          : tab === "agent"
            ? { agent }
            : tab === "booking"
              ? { booking }
              : tab === "loyalty"
                ? { loyalty, vipRule: { minOrders: vip.minOrders, minSpend: vip.minSpend, withinDays: vip.withinDays }, atRiskDays: vip.atRiskDays }
                : tab === "payments"
                  ? { cardToCard: card }
                  : { telegramChatId: telegram };
      await api(`/shops/${shop.id}/settings`, { method: "PATCH", json: body });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      {tab === "general" && (
        <>
          <Field label={t("onb.name")}>
            <Input value={general.name} onChange={(e) => setGeneral({ ...general, name: e.target.value })} />
          </Field>
          <Field label={t("onb.kind")}>
            <Select value={general.kind} onChange={(e) => setGeneral({ ...general, kind: e.target.value })}>
              {(["retail", "services", "hybrid"] as const).map((k) => (
                <option key={k} value={k}>{t(`onb.kind.${k}`)}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("s.brandColor")}>
              <Input type="color" className="h-11 !p-1" value={general.brandColor} onChange={(e) => setGeneral({ ...general, brandColor: e.target.value })} />
            </Field>
            <Field label="Timezone">
              <Input dir="ltr" value={general.timezone} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })} />
            </Field>
          </div>
        </>
      )}
      {tab === "agent" && (
        <>
          <Toggle checked={agent.enabled} onChange={(v) => setAgent({ ...agent, enabled: v })} label={t("s.agentEnabled")} />
          <Toggle checked={agent.neverOfferDiscount} onChange={(v) => setAgent({ ...agent, neverOfferDiscount: v })} label={t("s.neverDiscount")} />
          <Field label={t("s.tone")}>
            <Input value={agent.tone} onChange={(e) => setAgent({ ...agent, tone: e.target.value })} />
          </Field>
          <Field label={t("s.rules")}>
            <Textarea value={agent.rules} onChange={(e) => setAgent({ ...agent, rules: e.target.value })} />
          </Field>
          <Field label={t("s.knowledge")}>
            <Textarea className="min-h-40" value={agent.knowledge} onChange={(e) => setAgent({ ...agent, knowledge: e.target.value })} />
          </Field>
        </>
      )}
      {tab === "booking" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("s.slotStep")}>
              <Input inputMode="numeric" value={booking.slotStepMin} onChange={(e) => setBooking({ ...booking, slotStepMin: n(e.target.value) })} />
            </Field>
            <Field label={t("s.minNotice")}>
              <Input inputMode="numeric" value={booking.minNoticeMin} onChange={(e) => setBooking({ ...booking, minNoticeMin: n(e.target.value) })} />
            </Field>
            <Field label={t("s.maxAdvance")}>
              <Input inputMode="numeric" value={booking.maxAdvanceDays} onChange={(e) => setBooking({ ...booking, maxAdvanceDays: n(e.target.value) })} />
            </Field>
            <Field label={t("s.cancelWindow")}>
              <Input inputMode="numeric" value={booking.cancelWindowMin} onChange={(e) => setBooking({ ...booking, cancelWindowMin: n(e.target.value) })} />
            </Field>
          </div>
          <Field label="Reminders (min before, comma separated)">
            <Input
              dir="ltr"
              value={booking.reminderOffsetsMin.join(", ")}
              onChange={(e) => setBooking({ ...booking, reminderOffsetsMin: e.target.value.split(",").map((x) => n(x.trim())).filter((x) => x >= 5).slice(0, 4) })}
            />
          </Field>
          <Toggle checked={booking.autoConfirm} onChange={(v) => setBooking({ ...booking, autoConfirm: v })} label={t("s.autoConfirm")} />
        </>
      )}
      {tab === "loyalty" && (
        <>
          <Toggle checked={loyalty.enabled} onChange={(v) => setLoyalty({ ...loyalty, enabled: v })} label={t("s.loyaltyEnabled")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("s.tomanPerPoint")}>
              <Input inputMode="numeric" value={loyalty.tomanPerPoint} onChange={(e) => setLoyalty({ ...loyalty, tomanPerPoint: n(e.target.value) })} />
            </Field>
            <Field label={t("s.pointValue")}>
              <Input inputMode="numeric" value={loyalty.pointValue} onChange={(e) => setLoyalty({ ...loyalty, pointValue: n(e.target.value) })} />
            </Field>
          </div>
          <p className="pt-2 text-sm font-semibold strong">{t("c.vipRule")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={t("c.orders")}>
              <Input inputMode="numeric" value={vip.minOrders} onChange={(e) => setVip({ ...vip, minOrders: n(e.target.value) })} />
            </Field>
            <Field label={t("c.spent")}>
              <Input inputMode="numeric" value={vip.minSpend} onChange={(e) => setVip({ ...vip, minSpend: n(e.target.value) })} />
            </Field>
            <Field label="Days">
              <Input inputMode="numeric" value={vip.withinDays} onChange={(e) => setVip({ ...vip, withinDays: n(e.target.value) })} />
            </Field>
            <Field label={t("seg.at_risk")}>
              <Input inputMode="numeric" value={vip.atRiskDays} onChange={(e) => setVip({ ...vip, atRiskDays: n(e.target.value) })} />
            </Field>
          </div>
        </>
      )}
      {tab === "payments" && (
        <>
          <Field label={t("s.card")}>
            <Input dir="ltr" inputMode="numeric" value={card.cardNumber} onChange={(e) => setCard({ ...card, cardNumber: latinDigits(e.target.value).replace(/\D/g, "") })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("s.cardHolder")}>
              <Input value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value })} />
            </Field>
            <Field label={t("s.bank")}>
              <Input value={card.bank} onChange={(e) => setCard({ ...card, bank: e.target.value })} />
            </Field>
          </div>
        </>
      )}
      {tab === "integrations" && (
        <>
          <Field label={t("s.telegram")}>
            <Input dir="ltr" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
          </Field>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <p className="mb-3 text-sm font-semibold strong">
              {t("s.igConnect")} {data.shop.instagramConnected && <span className="text-success">✓ {data.shop.igUsername}</span>}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("s.igId")}>
                <Input dir="ltr" value={ig.igUserId} onChange={(e) => setIg({ ...ig, igUserId: e.target.value })} />
              </Field>
              <Field label="Username">
                <Input dir="ltr" value={ig.username} onChange={(e) => setIg({ ...ig, username: e.target.value })} />
              </Field>
            </div>
            <Field label={t("s.igToken")} className="mt-3">
              <Input dir="ltr" type="password" value={ig.accessToken} onChange={(e) => setIg({ ...ig, accessToken: e.target.value })} />
            </Field>
          </div>
        </>
      )}
      <ErrorNote error={error} />
      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="size-4" /> {t("s.saved")}
          </span>
        )}
        <Button variant="primary" loading={busy} onClick={save}>
          {t("a.save")}
        </Button>
      </div>
    </Card>
  );
}

function WalletCard() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data } = useApi<{ balance: number; transactions: { id: string; kind: string; amount: number; createdAt: string }[] }>(`/shops/${shop.id}/wallet`);
  const [amount, setAmount] = useState("500000");
  const [error, setError] = useState<unknown>(null);
  if (!data) return <Spinner />;
  const topup = async () => {
    try {
      const r = await api<{ kind: string; url?: string }>(`/shops/${shop.id}/wallet/topup`, { method: "POST", json: { amount: Number(latinDigits(amount)) } });
      if (r.url) window.location.href = r.url;
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gold/15 text-[var(--accent)]">
          <Wallet className="size-6" />
        </span>
        <div className="flex-1">
          <p className="text-sm muted">{t("s.wallet")}</p>
          <p className="num text-2xl font-bold strong">{money(data.balance, locale)}</p>
        </div>
        <div className="flex gap-2">
          <Input className="!w-36" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button variant="primary" onClick={topup}>{t("s.topup")}</Button>
        </div>
      </Card>
      <ErrorNote error={error} />
      <Card className="!p-0">
        <ul className="divide-y divide-[var(--border)]">
          {data.transactions.map((tx) => (
            <li key={tx.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="strong">{tx.kind}</span>
              <span className="text-xs muted">{dateTime(tx.createdAt, locale)}</span>
              <span className={`num ${tx.amount < 0 ? "text-danger" : "text-success"}`} dir="ltr">
                {tx.amount > 0 ? "+" : ""}
                {money(tx.amount, locale, false)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
