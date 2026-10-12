"use client";

import clsx from "clsx";
import { Bot, CheckCircle2, CircleDot, FlaskConical, Flag, Hand, Link2, MessageCircle, RotateCcw, Send, ShoppingBag, CalendarCheck, User, UserCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, Spinner, Tabs, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, money, num, relative, time } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

interface Conversation {
  id: string;
  channel: string;
  username: string | null;
  customerName: string | null;
  segment: string | null;
  mode: "agent" | "human";
  needsHuman: boolean;
  status: Status;
  assigneeId: string | null;
  assigneeName?: string | null;
  unread: number;
  lastMessageAt: string;
  lastText: string | null;
}
type Status = "open" | "needs_human" | "in_progress" | "resolved";
type Filter = "all" | "needs_human" | "mine" | "in_progress" | "open" | "resolved" | "unread";
interface Summary {
  counts: { open: number; needsHuman: number; inProgress: number; resolved: number; mine: number; unread: number; oldestWaiting: string | null };
  team: { userId: string; name: string | null; role: string }[];
  me: string;
}
interface ConvEvent {
  id: string;
  type: "handoff" | "assigned" | "human_reply" | "status" | "reopened" | "order" | "booking" | "mode";
  data: Record<string, unknown> | null;
  createdAt: string;
  actorName: string | null;
  actorId: string | null;
}
const STATUS_KEY: Record<Status, DictKey> = { open: "in.open", needs_human: "in.needsHuman", in_progress: "in.inProgress", resolved: "in.resolved" };
const STATUS_TONE = { open: "neutral", needs_human: "warning", in_progress: "info", resolved: "success" } as const;

interface SiteActivity {
  visits: number;
  lastAt: string | null;
  lastPath: string | null;
  orders: { id: string; code: string; total: number; status: string; paymentStatus: string }[];
  bookings: { id: string; code: string; status: string; startsAt: string }[];
}
interface Message {
  id: string;
  direction: "in" | "out";
  sender: "customer" | "agent" | "human" | "system";
  text: string;
  createdAt: string;
}

export default function InboxPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [filter, setFilter] = useState<Filter | "playground">("all");
  const [active, setActive] = useState<string | null>(null);
  const { data: convs, mutate } = useApi<Conversation[]>(filter === "playground" ? null : `/shops/${shop.id}/conversations?filter=${filter}`, { refreshInterval: 10_000 });
  const { data: summary, mutate: reloadSummary } = useApi<Summary>(`/shops/${shop.id}/conversations/summary`, { refreshInterval: 15_000 });
  const counts = summary?.counts;

  return (
    <div>
      <PageHeader
        title={t("p.inbox")}
        subtitle={counts?.oldestWaiting ? <span className="text-warning">{t("in.waitingSince").replace("{t}", relative(counts.oldestWaiting, locale))}</span> : undefined}
      />
      <div className="mb-4">
        <Tabs
          value={filter}
          onChange={(v) => (setFilter(v), setActive(null))}
          items={[
            { value: "all", label: t("in.all") },
            { value: "needs_human", label: <span className="inline-flex items-center gap-1"><Flag className="size-3.5 text-warning" /> {t("in.needsHuman")}</span>, count: counts?.needsHuman },
            { value: "mine", label: t("in.mine"), count: counts?.mine },
            { value: "in_progress", label: t("in.inProgress"), count: counts?.inProgress },
            { value: "open", label: t("in.open"), count: counts?.open },
            { value: "resolved", label: t("in.resolved") },
            { value: "unread", label: t("in.unread"), count: counts?.unread },
            { value: "playground", label: <span className="inline-flex items-center gap-1"><FlaskConical className="size-3.5" /> {t("in.playground")}</span> },
          ]}
        />
      </div>
      {filter === "playground" ? (
        <Playground />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <Card className={clsx("!p-2", active && "hidden lg:block")}>
            {!convs ? (
              <Spinner />
            ) : convs.length === 0 ? (
              <Empty icon={<MessageCircle className="size-6" />} title={t("in.empty")} />
            ) : (
              <ul className="space-y-1">
                {convs.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setActive(c.id)}
                      className={clsx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-start", active === c.id ? "bg-gold/10" : "hover:bg-[var(--surface-sunken)]")}
                    >
                      <Avatar name={c.customerName ?? c.username} size={38} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium strong">{c.customerName ?? (c.username ? `@${c.username}` : c.channel)}</span>
                          {c.segment && <Badge tone={statusTone(c.segment)}>{t(`seg.${c.segment}` as DictKey)}</Badge>}
                        </span>
                        <span className="block truncate text-xs muted">{c.lastText}</span>
                        {(c.status !== "open" || c.assigneeName) && (
                          <span className="mt-1 flex items-center gap-1.5 text-[10px]">
                            {c.status !== "open" && <Badge tone={STATUS_TONE[c.status]}>{t(STATUS_KEY[c.status])}</Badge>}
                            {c.assigneeName && (
                              <span className="inline-flex items-center gap-0.5 muted">
                                <UserCheck className="size-3" /> {c.assigneeName}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-[10px] muted">{relative(c.lastMessageAt, locale)}</span>
                        {c.status === "needs_human" || c.needsHuman ? <span className="size-2 rounded-full bg-warning" /> : c.unread > 0 ? <span className="size-2 rounded-full bg-info" /> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {active ? <Thread id={active} team={summary?.team ?? []} me={summary?.me} onBack={() => setActive(null)} onChange={() => (mutate(), reloadSummary())} /> : (
            <Card className="hidden lg:block">
              <Empty icon={<MessageCircle className="size-6" />} title={t("in.pick")} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Bubble({ m }: { m: Pick<Message, "direction" | "sender" | "text" | "createdAt"> }) {
  const { locale } = useI18n();
  const out = m.direction === "out";
  return (
    <div className={clsx("flex max-w-[80%] flex-col gap-0.5", out ? "self-end items-end" : "self-start items-start")}>
      <div className={clsx("whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-7", out ? (m.sender === "agent" ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-info/20 strong") : "bg-[var(--surface-sunken)] strong")}>
        {m.text}
      </div>
      <span className="flex items-center gap-1 text-[10px] muted">
        {m.sender === "agent" && <Bot className="size-3" />}
        {m.sender === "human" && <User className="size-3" />}
        {time(m.createdAt, locale)}
      </span>
    </div>
  );
}

function EventRow({ e, team }: { e: ConvEvent; team: Summary["team"] }) {
  const { t, locale } = useI18n();
  const d = e.data ?? {};
  let icon = <CircleDot className="size-3.5" />;
  let text: string = t(`cev.${e.type}` as DictKey);
  if (e.type === "handoff") {
    icon = <Flag className="size-3.5 text-warning" />;
    if (d.reason) text += `: ${String(d.reason)}`;
  } else if (e.type === "assigned") {
    icon = <UserCheck className="size-3.5 text-info" />;
    const who = team.find((m) => m.userId === d.assigneeId)?.name;
    text = d.assigneeId ? `${t("cev.assigned")}${who ? `: ${who}` : ""}` : t("cev.unassigned");
  } else if (e.type === "human_reply") {
    icon = <Hand className="size-3.5 text-info" />;
  } else if (e.type === "status") {
    icon = d.status === "resolved" ? <CheckCircle2 className="size-3.5 text-success" /> : <CircleDot className="size-3.5" />;
    text += `: ${t(STATUS_KEY[d.status as Status] ?? "in.open")}`;
  } else if (e.type === "order" || e.type === "booking") {
    icon = e.type === "order" ? <ShoppingBag className="size-3.5 text-[var(--accent)]" /> : <CalendarCheck className="size-3.5 text-[var(--accent)]" />;
    text += ` ${String(d.code ?? "")} ${t(d.step === "paid" ? "cev.paid" : "cev.created")}`;
    if (typeof d.total === "number") text += ` · ${money(d.total, locale, false)}`;
    if (typeof d.startsAt === "string") text += ` · ${dateTime(d.startsAt, locale)}`;
  } else if (e.type === "mode") {
    text += `: ${t(d.mode === "agent" ? "in.agentOn" : "in.humanOn")}`;
  }
  return (
    <div className="flex items-center justify-center gap-1.5 self-center rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-[11px] muted">
      {icon}
      <span>{text}</span>
      {e.actorName && !(e.type === "assigned" && d.assigneeId === e.actorId) && <span>· {e.actorName}</span>}
      <span className="num">· {time(e.createdAt, locale)}</span>
    </div>
  );
}

function Thread({ id, team, me, onBack, onChange }: { id: string; team: Summary["team"]; me?: string; onBack: () => void; onChange: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<{ conversation: Conversation; events: ConvEvent[]; messages: Message[]; site: SiteActivity }>(`/shops/${shop.id}/conversations/${id}/messages`, { refreshInterval: 5000 });
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [data?.messages.length]);
  if (!data) return <Spinner />;
  const conv = data.conversation;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      await api(`/shops/${shop.id}/conversations/${id}/reply`, { method: "POST", json: { text } });
      setText("");
      mutate();
      onChange();
    } catch (err) {
      setError(err);
    }
  };
  const update = async (body: { mode?: "agent" | "human"; status?: Status; assigneeId?: string | null }) => {
    setError(null);
    try {
      await api(`/shops/${shop.id}/conversations/${id}`, { method: "PATCH", json: body });
      mutate();
      onChange();
    } catch (err) {
      setError(err);
    }
  };
  const setMode = (mode: "agent" | "human") => update(mode === "agent" ? { mode, ...(conv.status === "needs_human" ? { status: "open" as const } : {}) } : { mode });
  // messages and progress events in one time line
  const timeline = [
    ...data.messages.map((m) => ({ at: m.createdAt, kind: "m" as const, m })),
    ...(data.events ?? []).map((e) => ({ at: e.createdAt, kind: "e" as const, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <Card className="flex h-[70dvh] flex-col !p-0">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <button className="text-sm muted lg:hidden" onClick={onBack}>←</button>
        <span className="font-semibold strong">{conv.username ? `@${conv.username}` : conv.channel}</span>
        <div className="flex gap-1 rounded-full bg-[var(--surface-sunken)] p-1 text-xs">
          <button onClick={() => setMode("agent")} className={clsx("flex items-center gap-1 rounded-full px-2.5 py-1", conv.mode === "agent" && "bg-[var(--accent)] text-[var(--accent-ink)]")}>
            <Bot className="size-3.5" /> {t("in.agentOn")}
          </button>
          <button onClick={() => setMode("human")} className={clsx("flex items-center gap-1 rounded-full px-2.5 py-1", conv.mode === "human" && "bg-info/30 strong")}>
            <User className="size-3.5" /> {t("in.humanOn")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2 text-xs">
        <Badge tone={STATUS_TONE[conv.status]}>{t(STATUS_KEY[conv.status])}</Badge>
        <label className="flex items-center gap-1 muted">
          <UserCheck className="size-3.5" />
          <select
            aria-label={t("in.assignee")}
            value={conv.assigneeId ?? ""}
            onChange={(e) => update({ assigneeId: e.target.value || null })}
            className="rounded-lg bg-transparent py-0.5 text-xs strong focus:outline-none"
          >
            <option value="">{t("in.unassigned")}</option>
            {team.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.userId.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <span className="ms-auto flex flex-wrap gap-1.5">
          {me && conv.assigneeId !== me && conv.status !== "resolved" && (
            <Button size="sm" variant="ghost" onClick={() => update({ assigneeId: me })}>
              <Hand className="size-3.5" /> {t("in.takeIt")}
            </Button>
          )}
          {conv.status !== "needs_human" && conv.status !== "resolved" && (
            <Button size="sm" variant="ghost" onClick={() => update({ status: "needs_human" })}>
              <Flag className="size-3.5" /> {t("in.flag")}
            </Button>
          )}
          {conv.status === "resolved" ? (
            <Button size="sm" variant="ghost" onClick={() => update({ status: "open" })}>
              <RotateCcw className="size-3.5" /> {t("in.reopen")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => update({ status: "resolved" })}>
              <CheckCircle2 className="size-3.5" /> {t("in.resolve")}
            </Button>
          )}
        </span>
      </div>
      {(data.site.visits > 0 || data.site.orders.length > 0 || data.site.bookings.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2 text-xs">
          <Link2 className="size-3.5 text-[var(--accent)]" />
          <span className="strong">{t("in.site")}</span>
          <span className="muted">
            {num(data.site.visits, locale)} {t("in.visits")}
            {data.site.lastAt && ` · ${relative(data.site.lastAt, locale)}`}
            {data.site.lastPath && (
              <>
                {" · "}
                <bdi dir="ltr">{data.site.lastPath}</bdi>
              </>
            )}
          </span>
          {data.site.orders.map((o) => (
            <a key={o.id} href={`/panel/orders/${o.id}`}>
              <Badge tone={statusTone(o.paymentStatus)}>
                {o.code} · {money(o.total, locale, false)}
              </Badge>
            </a>
          ))}
          {data.site.bookings.map((b) => (
            <Badge key={b.id} tone={statusTone(b.status)}>
              {b.code}
            </Badge>
          ))}
        </div>
      )}
      <div className="scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {timeline.map((x) => (x.kind === "m" ? <Bubble key={x.m.id} m={x.m} /> : <EventRow key={x.e.id} e={x.e} team={team} />))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-[var(--border)] p-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("in.reply")} />
        <Button variant="primary" className="!px-3">
          <Send className="size-4 rtl:-scale-x-100" />
        </Button>
      </form>
      {error ? <div className="px-3 pb-3"><ErrorNote error={error} /></div> : null}
    </Card>
  );
}

function Playground() {
  const { t } = useI18n();
  const { shop } = useShop();
  const [msgs, setMsgs] = useState<{ direction: "in" | "out"; sender: "customer" | "agent" | "system"; text: string; createdAt: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs.length]);

  const send = async (e: React.FormEvent, reset = false) => {
    e.preventDefault();
    if (!text.trim()) return;
    const now = new Date().toISOString();
    setMsgs((m) => [...(reset ? [] : m), { direction: "in", sender: "customer", text, createdAt: now }]);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ reply: string | null; handoff: string | null; automation?: { name: string } }>(`/shops/${shop.id}/agent/playground`, { method: "POST", json: { text, reset } });
      setMsgs((m) => [
        ...m,
        ...(r.automation ? [{ direction: "out" as const, sender: "system" as const, text: `⚡ ${r.automation.name}`, createdAt: new Date().toISOString() }] : []),
        ...(r.reply ? [{ direction: "out" as const, sender: "agent" as const, text: r.reply, createdAt: new Date().toISOString() }] : []),
        ...(r.handoff ? [{ direction: "out" as const, sender: "system" as const, text: `⚑ handoff: ${r.handoff}`, createdAt: new Date().toISOString() }] : []),
      ]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto flex h-[70dvh] max-w-2xl flex-col !p-0">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <p className="text-sm muted">{t("in.playgroundHint")}</p>
        {/* the next message after clearing is sent with reset: true */}
        <Button size="sm" variant="ghost" onClick={() => setMsgs([])}>
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      <div className="scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {msgs.map((m, i) => (
          <Bubble key={i} m={m} />
        ))}
        {busy && <Spinner className="self-end" />}
        <div ref={end} />
      </div>
      {error ? <div className="px-3"><ErrorNote error={error} /></div> : null}
      <form onSubmit={(e) => send(e, msgs.length === 0)} className="flex gap-2 border-t border-[var(--border)] p-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("in.reply")} disabled={busy} />
        <Button variant="primary" className="!px-3" disabled={busy}>
          <Send className="size-4 rtl:-scale-x-100" />
        </Button>
      </form>
    </Card>
  );
}
