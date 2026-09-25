"use client";

import clsx from "clsx";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/locale-client";

interface Msg {
  from: "me" | "ai";
  text: string;
}

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

/** Floating shopping / booking consultant. Context comes from the page (product) or an explicit service. */
export function Assistant({ slug, serviceId, mode = "shop" }: { slug: string; serviceId?: string; mode?: "shop" | "booking" }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const productSlug = pathname.match(/\/p\/([^/?#]+)/)?.[1];
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs.length, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { from: "me", text: q }]);
    setText("");
    setBusy(true);
    try {
      const r = await api<{ reply: string | null }>(`/public/shops/${slug}/assistant`, {
        method: "POST",
        json: { sessionId: sessionId(slug), text: q, context: productSlug ? { productSlug: decodeURIComponent(productSlug) } : serviceId ? { serviceId } : undefined },
      });
      setMsgs((m) => [...m, { from: "ai", text: r.reply ?? "…" }]);
    } catch (err) {
      setMsgs((m) => [...m, { from: "ai", text: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 end-5 z-40 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-medium text-[var(--accent-ink)] shadow-xl transition hover:scale-105"
        >
          <Sparkles className="size-4" /> {mode === "booking" ? t("chat.titleBooking") : t("chat.title")}
        </button>
      )}
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-50 flex h-[70dvh] flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-elev)] shadow-2xl sm:inset-x-auto sm:end-5 sm:w-96">
          <div className="flex items-center justify-between bg-[var(--accent)] px-4 py-3 text-[var(--accent-ink)]">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="size-4" /> {mode === "booking" ? t("chat.titleBooking") : t("chat.title")}
            </span>
            <button onClick={() => setOpen(false)} aria-label="close">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
            <div className="max-w-[85%] self-start rounded-2xl bg-[var(--surface-sunken)] px-3 py-2 text-sm strong">{t("chat.hello")}</div>
            {msgs.map((m, i) => (
              <div
                key={i}
                className={clsx(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-7",
                  m.from === "me" ? "self-end bg-[var(--accent)] text-[var(--accent-ink)]" : "self-start bg-[var(--surface-sunken)] strong",
                )}
              >
                <Linkify text={m.text} />
              </div>
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
