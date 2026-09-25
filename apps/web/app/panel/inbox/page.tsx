"use client";

import clsx from "clsx";
import { Bot, FlaskConical, MessageCircle, RotateCcw, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, Spinner, Tabs, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { relative, time } from "@/lib/format";
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
  unread: number;
  lastMessageAt: string;
  lastText: string | null;
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
  const [filter, setFilter] = useState<"all" | "needs_human" | "unread" | "playground">("all");
  const [active, setActive] = useState<string | null>(null);
  const { data: convs, mutate } = useApi<Conversation[]>(filter === "playground" ? null : `/shops/${shop.id}/conversations?filter=${filter}`, { refreshInterval: 10_000 });

  return (
    <div>
      <PageHeader title={t("p.inbox")} />
      <div className="mb-4">
        <Tabs
          value={filter}
          onChange={(v) => (setFilter(v), setActive(null))}
          items={[
            { value: "all", label: t("in.all") },
            { value: "needs_human", label: t("in.needsHuman") },
            { value: "unread", label: t("in.unread") },
            { value: "playground", label: <span className="inline-flex items-center gap-1"><FlaskConical className="size-3.5" /> {t("in.playground")}</span> },
          ]}
        />
      </div>
      {filter === "playground" ? (
        <Playground />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">
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
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-[10px] muted">{relative(c.lastMessageAt, locale)}</span>
                        {c.needsHuman ? <span className="size-2 rounded-full bg-warning" /> : c.unread > 0 ? <span className="size-2 rounded-full bg-info" /> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {active ? <Thread id={active} onBack={() => setActive(null)} onChange={() => mutate()} /> : (
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

function Thread({ id, onBack, onChange }: { id: string; onBack: () => void; onChange: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<{ conversation: Conversation; messages: Message[] }>(`/shops/${shop.id}/conversations/${id}/messages`, { refreshInterval: 5000 });
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
  const setMode = async (mode: "agent" | "human") => {
    await api(`/shops/${shop.id}/conversations/${id}`, { method: "PATCH", json: { mode, needsHuman: false } });
    mutate();
    onChange();
  };

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
      <div className="scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {data.messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
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
      const r = await api<{ reply: string | null; handoff: string | null }>(`/shops/${shop.id}/agent/playground`, { method: "POST", json: { text, reset } });
      setMsgs((m) => [
        ...m,
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
