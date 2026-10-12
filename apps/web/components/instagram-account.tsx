"use client";

import clsx from "clsx";
import { AlertTriangle, AtSign, BadgeCheck, CalendarClock, Clock, KeyRound, MessageCircle, MessagesSquare, RefreshCw, Radio, Sparkles, Unplug, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorNote, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { date, dateTime, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

interface TokenState {
  expiresAt: string | null;
  daysLeft: number | null;
  refreshedAt: string | null;
  refreshableAt: string | null;
  health: "ok" | "expiring" | "expired" | "unknown";
}
export interface AccountStatus {
  connected: boolean;
  oauthAvailable: boolean;
  plan: { id: string; expiresAt: string | null; daysLeft: number | null; automations: boolean; agent: boolean };
  scopes: string[];
  messagingWindowHours: number;
  account: null | {
    igUserId: string;
    username: string | null;
    profile: { name: string | null; accountType: string | null; pictureUrl: string | null; followers: number | null; follows: number | null; mediaCount: number | null; fetchedAt: string } | null;
    connectedAt: string | null;
    token: TokenState;
    webhook: { subscribedAt: string | null; fields: string[]; lastEventAt: string | null };
    lastError: { message: string; at: string | null } | null;
    activity7d: { dms: number; lastDmAt: string | null; comments: number; lastCommentAt: string | null; automations: number; aiReplies: number };
  };
}

const healthTone = { ok: "success", expiring: "warning", expired: "danger", unknown: "neutral" } as const;

/** Connected Instagram account: who it is, how long access lasts, whether events arrive, and what happened this week. */
export function InstagramAccount({ returnTo = "instagram" }: { returnTo?: "instagram" | "settings" | "onboarding" }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<AccountStatus>(`/shops/${shop.id}/instagram/account`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ig = q.get("ig");
    if (ig) setResult(ig === "error" ? `error.${q.get("reason") ?? "exchange"}` : ig);
  }, []);
  if (!data) return <Spinner />;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const connect = () =>
    run("connect", async () => {
      const r = await api<{ url: string }>(`/shops/${shop.id}/instagram/oauth/start`, { method: "POST", json: { returnTo } });
      window.location.href = r.url;
    });
  const post = (path: string) => api(`/shops/${shop.id}/instagram/${path}`, { method: "POST" });
  const a = data.account;
  const resultBanner = result && (
    <p className={result === "connected" ? "rounded-xl bg-success/10 px-3 py-2 text-sm text-success" : "rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger"}>
      {t(`ig.result.${result}` as DictKey)}
    </p>
  );

  if (!a) {
    return (
      <Card className="space-y-4 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#515bd4] text-white">
          <AtSign className="size-7" />
        </span>
        <div>
          <h2 className="text-lg font-bold strong">{t("iga.connectTitle")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm muted">{t("ig.why")}</p>
        </div>
        {resultBanner}
        <ul className="mx-auto max-w-md space-y-1.5 text-start text-sm">
          {(["iga.need.1", "iga.need.2", "iga.need.3"] as const).map((k) => (
            <li key={k} className="flex gap-2">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" /> {t(k)}
            </li>
          ))}
        </ul>
        {!data.oauthAvailable && <p className="text-xs text-warning">{t("ig.notConfigured")}</p>}
        <ErrorNote error={error} />
        <Button variant="primary" size="lg" loading={busy === "connect"} disabled={!data.oauthAvailable} onClick={connect}>
          {t("ig.connectBtn")}
        </Button>
      </Card>
    );
  }

  const p = a.profile;
  const tk = a.token;
  const eventAgeH = a.webhook.lastEventAt ? (Date.now() - Date.parse(a.webhook.lastEventAt)) / 3_600_000 : null;
  const canRefresh = !tk.refreshableAt || Date.parse(tk.refreshableAt) <= Date.now();
  return (
    <div className="space-y-4">
      {resultBanner}
      <Card className="flex flex-wrap items-center gap-4">
        {p?.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.pictureUrl} alt="" className="size-16 rounded-full object-cover ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-elev)]" />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#515bd4] text-white">
            <AtSign className="size-7" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <a href={`https://instagram.com/${a.username}`} target="_blank" rel="noreferrer" className="text-lg font-bold strong" dir="ltr">
              @{a.username}
            </a>
            {p?.accountType && <Badge tone="neutral">{p.accountType}</Badge>}
          </p>
          {p?.name && <p className="text-sm muted">{p.name}</p>}
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {[
              ["iga.followers", p?.followers],
              ["iga.following", p?.follows],
              ["iga.posts", p?.mediaCount],
            ].map(([k, v]) => (
              <span key={k as string}>
                <b className="num strong">{v == null ? "-" : num(v as number, locale)}</b> <span className="muted">{t(k as DictKey)}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy === "check"} onClick={() => run("check", () => post("account/check"))}>
            <RefreshCw className="size-4" /> {t("iga.check")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`${t("ig.disconnect")}?`)) void run("disconnect", () => post("disconnect"));
            }}
          >
            <Unplug className="size-4" /> {t("ig.disconnect")}
          </Button>
        </div>
      </Card>

      {a.lastError && (
        <Card className="flex items-start gap-3 border-danger/40 bg-danger/5">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold strong">{t("iga.lastError")}</p>
            <p className="mt-1 break-words muted" dir="ltr">{a.lastError.message}</p>
            {a.lastError.at && <p className="mt-1 text-xs muted">{dateTime(a.lastError.at, locale)}</p>}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold strong">
            <KeyRound className="size-4 text-[var(--accent)]" /> {t("iga.token")}
          </h3>
          <div className="flex items-baseline justify-between gap-2">
            <span className={clsx("num text-3xl font-bold", tk.health === "expired" ? "text-danger" : tk.health === "expiring" ? "text-warning" : "strong")}>
              {tk.daysLeft == null ? "-" : num(Math.max(0, tk.daysLeft), locale)}
            </span>
            <Badge tone={healthTone[tk.health]}>{t(`iga.health.${tk.health}` as DictKey)}</Badge>
          </div>
          <p className="text-xs muted">{t("iga.daysLeft")}</p>
          {tk.expiresAt && <TokenBar daysLeft={tk.daysLeft ?? 0} />}
          <dl className="space-y-1 text-xs">
            <Row label={t("iga.expiresAt")} value={tk.expiresAt ? dateTime(tk.expiresAt, locale) : "-"} />
            <Row label={t("iga.refreshedAt")} value={tk.refreshedAt ? dateTime(tk.refreshedAt, locale) : a.connectedAt ? `${t("iga.connectedAt")} ${date(a.connectedAt, locale)}` : "-"} />
          </dl>
          <p className="text-xs muted">{t("iga.autoRefresh")}</p>
          <Button size="sm" className="w-full" loading={busy === "refresh"} disabled={!canRefresh} onClick={() => run("refresh", () => post("account/refresh-token"))}>
            <RefreshCw className="size-4" /> {canRefresh ? t("iga.refreshNow") : `${t("iga.refreshAfter")} ${dateTime(tk.refreshableAt!, locale)}`}
          </Button>
        </Card>

        <Card className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold strong">
            <Radio className="size-4 text-[var(--accent)]" /> {t("iga.webhook")}
          </h3>
          <div className="flex items-center gap-2">
            <span className={clsx("size-2.5 rounded-full", eventAgeH === null ? "bg-[var(--border-strong)]" : eventAgeH < 48 ? "animate-pulse bg-success" : "bg-warning")} />
            <span className="text-sm strong">
              {a.webhook.lastEventAt ? `${t("iga.lastEvent")} ${dateTime(a.webhook.lastEventAt, locale)}` : t("iga.noEvents")}
            </span>
          </div>
          <dl className="space-y-1 text-xs">
            <Row label={t("iga.subscribedAt")} value={a.webhook.subscribedAt ? dateTime(a.webhook.subscribedAt, locale) : "-"} />
            <Row label={t("iga.fields")} value={<span dir="ltr">{a.webhook.fields.join(", ")}</span>} />
          </dl>
          <p className="text-xs muted">{t("iga.webhookHint")}</p>
          <Button size="sm" className="w-full" loading={busy === "resub"} onClick={() => run("resub", () => post("account/resubscribe"))}>
            <Radio className="size-4" /> {t("iga.resubscribe")}
          </Button>
        </Card>

        <Card className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold strong">
            <CalendarClock className="size-4 text-[var(--accent)]" /> {t("iga.plan")}
          </h3>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold uppercase strong">{data.plan.id}</span>
            {data.plan.daysLeft != null && (
              <Badge tone={data.plan.daysLeft < 0 ? "danger" : data.plan.daysLeft <= 7 ? "warning" : "success"}>
                {data.plan.daysLeft < 0 ? t("iga.planExpired") : `${num(data.plan.daysLeft, locale)} ${t("iga.days")}`}
              </Badge>
            )}
          </div>
          <dl className="space-y-1 text-xs">
            <Row label={t("iga.planUntil")} value={data.plan.expiresAt ? date(data.plan.expiresAt, locale) : t("iga.noExpiry")} />
            <Row label={t("iga.automations")} value={data.plan.automations ? "✓" : "-"} />
            <Row label={t("iga.agent")} value={data.plan.agent ? "✓" : "-"} />
          </dl>
          <p className="flex gap-1.5 text-xs muted">
            <Clock className="mt-0.5 size-3.5 shrink-0" /> {t("iga.window").replace("{h}", num(data.messagingWindowHours, locale))}
          </p>
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-semibold strong">{t("iga.week")}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: MessagesSquare, label: "iga.dms", v: a.activity7d.dms, sub: a.activity7d.lastDmAt },
            { icon: MessageCircle, label: "iga.comments", v: a.activity7d.comments, sub: a.activity7d.lastCommentAt },
            { icon: Zap, label: "iga.autoReplies", v: a.activity7d.automations },
            { icon: Sparkles, label: "iga.aiReplies", v: a.activity7d.aiReplies },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-[var(--surface-sunken)] p-3">
              <p className="flex items-center gap-1.5 text-xs muted">
                <s.icon className="size-3.5" /> {t(s.label as DictKey)}
              </p>
              <p className="num mt-1 text-xl font-bold strong">{num(s.v, locale)}</p>
              {s.sub && <p className="mt-0.5 text-[11px] muted">{dateTime(s.sub, locale)}</p>}
            </div>
          ))}
        </div>
      </Card>
      <ErrorNote error={error} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd className="strong">{value}</dd>
    </div>
  );
}

/** 60-day token lifetime as a bar: how much of it is left. */
function TokenBar({ daysLeft }: { daysLeft: number }) {
  const pct = Math.max(0, Math.min(100, (daysLeft / 60) * 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]" role="progressbar" aria-valuemin={0} aria-valuemax={60} aria-valuenow={Math.max(0, daysLeft)}>
      <div className={clsx("h-full rounded-full transition-[width] duration-700", daysLeft <= 10 ? "bg-warning" : "bg-[var(--accent)]")} style={{ width: `${pct}%` }} />
    </div>
  );
}
