"use client";

import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { formatTomanShort } from "@shopino/shared";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";

export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="card p-4">
      <p className="text-xs muted">{label}</p>
      <p className={clsx("mt-1.5 text-xl font-bold", tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "strong")}>{value}</p>
      {sub && <div className="mt-1 text-xs muted">{sub}</div>}
    </div>
  );
}

/** Rounded "nice" axis maximum and ticks (0, step, 2*step, ...). */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return { top: 1, ticks: [0] };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

export interface ColumnGroup {
  key: string;
  /** full label, shown in the tooltip and the table */
  label: string;
  /** short axis label; defaults to `label` */
  tick?: string;
  values: number[];
}

/**
 * Grouped columns for a few same-unit series (e.g. income vs expenses per period). One axis, hairline
 * grid, <=24px columns with a 2px gap, legend above, tooltip per group and a table toggle.
 */
export function GroupedColumns({ groups, series, height = 200 }: { groups: ColumnGroup[]; series: { name: string; color: string }[]; height?: number }) {
  const { t, locale } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const { top, ticks } = niceTicks(Math.max(0, ...groups.flatMap((g) => g.values)));
  const labelEvery = Math.max(1, Math.ceil(groups.length / 10));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 strong">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </div>
        <button type="button" onClick={() => setTable((v) => !v)} className="text-xs muted underline-offset-2 hover:underline">
          {t("rp.table")}
        </button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs muted">
              <th className="py-1 text-start font-normal" />
              {series.map((s) => (
                <th key={s.name} className="py-1 text-end font-normal">{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-[var(--border)]">
                <td className="py-1.5">{g.label}</td>
                {g.values.map((v, i) => (
                  <td key={i} className="py-1.5 text-end">{money(v, locale, false)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex gap-2">
          <div className="relative w-12 shrink-0" style={{ height }}>
            {ticks.map((tk) => (
              <span key={tk} className="num absolute end-0 text-[10px] muted" style={{ bottom: `${(tk / top) * 100}%`, transform: "translateY(50%)" }}>
                {formatTomanShort(tk, locale)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height }}>
              {ticks.map((tk) => (
                <div key={tk} className="absolute inset-x-0 h-px" style={{ bottom: `${(tk / top) * 100}%`, background: tk === 0 ? "var(--chart-axis)" : "var(--chart-grid)" }} />
              ))}
              <div className="absolute inset-0 flex items-end">
                {groups.map((g, gi) => (
                  <div
                    key={g.key}
                    className={clsx("relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-md", hover === gi && "bg-[var(--surface-sunken)]")}
                    onMouseEnter={() => setHover(gi)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {g.values.map((v, si) => (
                      <div
                        key={si}
                        className="w-full max-w-6 rounded-t"
                        style={{ height: v > 0 ? `max(2px, ${(v / top) * 100}%)` : 0, background: series[si]!.color }}
                      />
                    ))}
                    {hover === gi && (
                      <div
                        className={clsx(
                          "pointer-events-none absolute bottom-full z-10 mb-1 min-w-36 rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] p-2 text-xs shadow-xl",
                          gi > groups.length / 2 ? "end-0" : "start-0",
                        )}
                      >
                        <p className="mb-1 font-semibold strong">{g.label}</p>
                        {g.values.map((v, si) => (
                          <p key={si} className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 muted">
                              <span className="size-2 rounded-sm" style={{ background: series[si]!.color }} /> {series[si]!.name}
                            </span>
                            <span className="num strong">{money(v, locale, false)}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-1.5 flex">
              {groups.map((g, gi) => (
                <span key={g.key} className="num flex-1 truncate text-center text-[10px] muted">
                  {gi % labelEvery === 0 ? (g.tick ?? g.label) : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars for one measure; value at the bar tip, label above. */
export function RankBars({ items, format, color = "var(--series-1)" }: { items: { key: string; label: ReactNode; value: number; note?: ReactNode }[]; format: (v: number) => string; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate strong">{i.label}</span>
            {i.note && <span className="shrink-0 text-xs muted">{i.note}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2.5 flex-1">
              <div className="h-full rounded-e" style={{ width: `${Math.max(1, (i.value / max) * 100)}%`, background: color }} />
            </div>
            <span className="num min-w-20 shrink-0 whitespace-nowrap text-end text-xs strong">{format(i.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
