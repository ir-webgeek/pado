import { CalendarClock, LayoutGrid, MessageCircle, Package, ShoppingBag, Users } from "lucide-react";
import { LogoMark } from "@/components/logo";
import type { DictKey } from "@/lib/i18n";

/** A static, faithful miniature of the real panel for the hero. */
export function PanelPreview({ t, locale }: { t: (k: DictKey) => string; locale: "fa" | "en" }) {
  const n = (v: number) => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(v);
  const bars = [32, 44, 38, 60, 52, 88, 100];
  const appts = [
    { time: "10:00", who: locale === "fa" ? "الهام · کوتاهی" : "Elham · Haircut", c: "#3ddbc4", col: 0, h: 2 },
    { time: "11:00", who: locale === "fa" ? "سارا · رنگ مو" : "Sara · Color", c: "#b3a8f0", col: 1, h: 3 },
    { time: "12:30", who: locale === "fa" ? "نگار · مانیکور" : "Negar · Manicure", c: "#f4b88a", col: 2, h: 1 },
    { time: "13:00", who: locale === "fa" ? "کارگاه میکاپ ۶/۸" : "Makeup class 6/8", c: "#52b4fd", col: 0, h: 2 },
  ];
  return (
    <div className="glass relative mx-auto max-w-5xl overflow-hidden rounded-[1.75rem] p-2 sm:p-3">
      <div className="flex gap-3">
        <aside className="hidden w-48 shrink-0 flex-col gap-1 rounded-2xl bg-[var(--surface-sunken)] p-3 text-xs md:flex">
          <div className="mb-3 flex items-center gap-2 strong">
            <LogoMark size={22} />
            <span className="font-bold">{t("brand.name")}</span>
          </div>
          {[
            [LayoutGrid, "p.dashboard", true],
            [ShoppingBag, "p.orders"],
            [Package, "p.products"],
            [CalendarClock, "p.appointments"],
            [Users, "p.customers"],
            [MessageCircle, "p.inbox"],
          ].map(([Icon, k, active]) => {
            const I = Icon as typeof LayoutGrid;
            return (
              <div key={k as string} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${active ? "bg-gold/15 text-[var(--accent)]" : "muted"}`}>
                <I className="size-3.5" /> {t(k as DictKey)}
              </div>
            );
          })}
        </aside>
        <div className="min-w-0 flex-1 space-y-3 p-1">
          <div className="rounded-2xl border border-[var(--border)] bg-gradient-to-l from-gold/10 to-transparent p-4">
            <p className="text-xs muted">{t("d.hello")} 🌙</p>
            <p className="mt-1 font-semibold strong">{t("d.clear")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {[
                [n(3), t("d.readyToShip")],
                [n(2), t("d.unanswered")],
                [n(4), t("d.pendingAppts")],
                [n(1), t("d.receipts")],
              ].map(([a, b]) => (
                <div key={b} className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
                  <b className="strong">{a}</b> <span className="muted">{b}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-5">
            <div className="rounded-2xl border border-[var(--border)] p-4 lg:col-span-2">
              <div className="flex items-baseline justify-between">
                <p className="text-xs muted">{t("d.week")}</p>
                <span className="text-xs text-success">+۲۴٪</span>
              </div>
              <p className="num mt-1 text-lg font-bold strong">{n(68_800_000)}</p>
              <div className="mt-3 flex h-24 items-end gap-1.5">
                {bars.map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-slate-brand/60 to-sky-brand" style={{ height: `${h}%`, opacity: 0.55 + i * 0.06 }} />
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] p-4 lg:col-span-3">
              <p className="mb-2 text-xs muted">{t("d.today")}</p>
              <div className="relative grid h-40 grid-cols-3 gap-2">
                {[0, 1, 2].map((c) => (
                  <div key={c} className="rounded-xl bg-[var(--surface-sunken)]" />
                ))}
                {appts.map((a) => (
                  <div
                    key={a.who}
                    className="absolute rounded-lg px-2 py-1 text-[10px] font-medium text-ink-900 shadow"
                    style={{
                      background: a.c,
                      insetInlineStart: `calc(${a.col} * 33.33% + ${a.col * 2}px)`,
                      width: "calc(33.33% - 6px)",
                      top: `${(Number(a.time.slice(0, 2)) - 10) * 25 + (a.time.endsWith("30") ? 12 : 0) + 4}%`,
                      height: `${a.h * 22}%`,
                    }}
                  >
                    {a.time} · {a.who}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
