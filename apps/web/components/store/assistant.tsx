"use client";

import clsx from "clsx";
import { AtSign, ChevronUp, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { captureDmRef } from "@/components/dm-ref";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";

interface Msg {
  from: "me" | "ai";
  text: string;
  /** earlier message from the Instagram DM this chat continues */
  via?: "instagram" | "web";
  at?: string;
}
interface History {
  username: string | null;
  customerName: string | null;
  messages: Msg[];
}

const RECENT = 6;

function sessionId(slug: string) {
  const key = `assistant:${slug}`;
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return crypto.randomUUID().replace(/-/g, "");
  }
}

/** Link-aware rendering: URLs in AI replies become tappable. */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} className="break-all underline" target="_blank" rel="noreferrer">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Floating shopping / booking consultant on every customer page. Context comes from the page (product,
 * service, order, booking). A visitor who arrived from an Instagram DM link (uid) sees that conversation
 * and continues it here.
 */
export function Assistant({
  slug,
  serviceId,
  mode = "shop",
  page,
  raised,
}: {
  slug: string;
  serviceId?: string;
  mode?: "shop" | "booking";
  page?: "order" | "booking" | "form" | "landing";
  /** lift the launcher above a sticky bottom bar */
  raised?: boolean;
}) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const productSlug = pathname.match(/\/p\/([^/?#]+)/)?.[1];
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<string | undefined>();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs.length, busy, open]);

  // visitor came from a DM link: load that conversation and invite them to continue it
  useEffect(() => {
    const r = captureDmRef();
    if (!r) return;
    setRef(r);
    api<History>(`/public/shops/${slug}/assistant/history?ref=${encodeURIComponent(r)}`)
      .then((h) => {
        if (!h.messages.length) return;
        setHistory(h);
        try {
          if (!sessionStorage.getItem(`dm-teaser:${slug}`)) setTeaser(true);
        } catch {
          setTeaser(true);
        }
      })
      .catch(() => {});
  }, [slug]);

  const openChat = () => {
    setOpen(true);
    setTeaser(false);
    try {
      sessionStorage.setItem(`dm-teaser:${slug}`, "1");
    } catch {}
  };

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { from: "me", text: q }]);
    setText("");
    setBusy(true);
    try {
      const where = page ?? (/^\/s\/[^/]+\/?$/.test(pathname) ? "landing" : undefined);
      const context = productSlug ? { productSlug: decodeURIComponent(productSlug) } : serviceId ? { serviceId } : where ? { page: where } : undefined;
      const r = await api<{ reply: string | null }>(`/public/shops/${slug}/assistant`, { method: "POST", json: { sessionId: sessionId(slug), text: q, ref, context } });
      setMsgs((m) => [...m, { from: "ai", text: r.reply ?? "…" }]);
    } catch (err) {
      setMsgs((m) => [...m, { from: "ai", text: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "booking" ? t("chat.titleBooking") : t("chat.title");
  const past = history?.messages ?? [];
  const hidden = showAll ? 0 : Math.max(0, past.length - RECENT);
  const lastDm = [...past].reverse().find((m) => m.via === "instagram");
  const who = history?.customerName ?? (history?.username ? `@${history.username}` : null);

  return (
    <>
      {!open && (
        <div className={clsx("fixed end-5 z-40 flex flex-col items-end gap-2 transition-[bottom]", raised ? "bottom-24" : "bottom-5")}>
          {teaser && lastDm && (
            <button
              onClick={openChat}
              className="animate-rise max-w-[17rem] rounded-2xl rounded-ee-md border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 text-start text-xs shadow-xl"
            >
              <span className="mb-1 flex items-center gap-1.5 font-semibold strong">
                <AtSign className="size-3.5 text-[#dd2a7b]" /> {who ? withName(t("chat.welcomeBackName"), who) : t("chat.welcomeBack")}
              </span>
              <span className="line-clamp-2 muted">«{lastDm.text}»</span>
              <span className="mt-1 block font-medium text-[var(--accent)]">{t("chat.continue")}</span>
            </button>
          )}
          <button
            onClick={openChat}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-medium text-[var(--accent-ink)] shadow-xl transition hover:scale-105"
          >
            <Sparkles className="size-4" /> {title}
            {history && <span className="size-2 rounded-full bg-[#dd2a7b] ring-2 ring-[var(--accent)]" aria-hidden />}
          </button>
        </div>
      )}
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-50 flex h-[75dvh] flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-elev)] shadow-2xl sm:inset-x-auto sm:end-5 sm:w-96">
          <div className="flex items-center justify-between bg-[var(--accent)] px-4 py-3 text-[var(--accent-ink)]">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="size-4" /> {title}
            </span>
            <button onClick={() => setOpen(false)} aria-label="close">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
            {past.length > 0 && (
              <div className="mb-1 flex items-center gap-2 rounded-2xl bg-gradient-to-l from-[#f58529]/10 via-[#dd2a7b]/10 to-[#515bd4]/10 px-3 py-2 text-xs">
                <AtSign className="size-4 shrink-0 text-[#dd2a7b]" />
                <span className="strong">{who ? withName(t("chat.fromDmName"), who) : t("chat.fromDm")}</span>
              </div>
            )}
            {hidden > 0 && (
              <button onClick={() => setShowAll(true)} className="mx-auto flex items-center gap-1 rounded-full bg-[var(--surface-sunken)] px-3 py-1 text-[11px] muted">
                <ChevronUp className="size-3.5" /> {t("chat.showEarlier").replace("{n}", String(hidden))}
              </button>
            )}
            {past.slice(hidden).map((m, i, arr) => {
              const day = m.at ? date(m.at, locale) : "";
              const prevDay = i > 0 && arr[i - 1]!.at ? date(arr[i - 1]!.at!, locale) : null;
              return (
                <div key={`h${i}`} className="contents">
                  {day && day !== prevDay && <p className="my-1 self-center text-[10px] muted">{day}</p>}
                  <Bubble m={m} />
                </div>
              );
            })}
            {past.length > 0 && <p className="my-1 self-center rounded-full bg-[var(--surface-sunken)] px-3 py-1 text-[10px] muted">{t("chat.nowOnSite")}</p>}
            {past.length === 0 && <div className="max-w-[85%] self-start rounded-2xl bg-[var(--surface-sunken)] px-3 py-2 text-sm strong">{t("chat.hello")}</div>}
            {msgs.map((m, i) => (
              <Bubble key={i} m={m} />
            ))}
            {busy && <div className="self-start rounded-2xl bg-[var(--surface-sunken)] px-3 py-2 text-xs muted">…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-[var(--border)] p-2">
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("chat.placeholder")} />
            <button className="rounded-full bg-[var(--accent)] px-3 text-[var(--accent-ink)]" disabled={busy} aria-label="send">
              <Send className="size-4 rtl:-scale-x-100" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/** "{name}" placeholder filled with an isolated run, so "@user" stays readable inside Persian text. */
function withName(template: string, name: string) {
  const [before, after] = template.split("{name}");
  return (
    <>
      {before}
      <bdi>{name}</bdi>
      {after}
    </>
  );
}

function Bubble({ m }: { m: Msg }) {
  const ig = m.via === "instagram";
  return (
    <div
      className={clsx(
        "relative max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-7",
        m.from === "me" ? "self-end bg-[var(--accent)] text-[var(--accent-ink)]" : "self-start bg-[var(--surface-sunken)] strong",
        ig && "opacity-90",
      )}
    >
      {ig && <AtSign className={clsx("absolute -top-1.5 size-3.5 rounded-full bg-[var(--bg-elev)] p-0.5 text-[#dd2a7b]", m.from === "me" ? "-start-1.5" : "-end-1.5")} aria-label="Instagram" />}
      <Linkify text={m.text} />
    </div>
  );
}
