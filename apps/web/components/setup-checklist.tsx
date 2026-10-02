"use client";

import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import { num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

interface Setup {
  steps: { key: string; done: boolean; href: string }[];
  done: number;
  total: number;
}

/** First-run checklist on the dashboard; disappears once everything is done or the owner hides it. */
export function SetupChecklist() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data } = useApi<Setup>(`/shops/${shop.id}/setup`);
  const storageKey = `setup-hidden:${shop.id}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(storageKey) === "1");
    } catch {
      setHidden(false);
    }
  }, [storageKey]);
  if (!data || hidden || data.done === data.total) return null;
  const Chevron = locale === "fa" ? ChevronLeft : ChevronRight;
  const next = data.steps.find((s) => !s.done);
  return (
    <section className="card relative p-4 sm:p-5" aria-labelledby="setup-title">
      <button
        type="button"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(storageKey, "1");
          } catch {}
        }}
        className="absolute end-3 top-3 rounded-full p-1.5 muted hover:bg-[var(--surface-sunken)]"
        aria-label={t("setup.hide")}
      >
        <X className="size-4" />
      </button>
      <h2 id="setup-title" className="font-semibold strong">{t("setup.title")}</h2>
      <p className="mt-0.5 text-xs muted">
        {num(data.done, locale)} / {num(data.total, locale)} {t("setup.progress")}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--border-strong)]" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}>
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-700" style={{ width: `${(data.done / data.total) * 100}%` }} />
      </div>
      <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {data.steps.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              target={s.href.startsWith("/panel") ? undefined : "_blank"}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                s.done ? "muted" : "hover:bg-[var(--surface-sunken)]",
                s === next && "border border-gold/40 bg-gold/5",
              )}
            >
              <span className={clsx("flex size-5 shrink-0 items-center justify-center rounded-full border", s.done ? "border-transparent bg-success text-white" : "border-[var(--border-strong)]")}>
                {s.done && <Check className="size-3" />}
              </span>
              <span className={clsx("flex-1", s.done ? "line-through decoration-[var(--border-strong)]" : "strong")}>{t(`setup.${s.key}` as DictKey)}</span>
              {!s.done && <Chevron className="size-4 muted" />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
