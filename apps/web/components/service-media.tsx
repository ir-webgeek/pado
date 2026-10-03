"use client";

import { MoveHorizontal } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/locale-client";
import type { BeforeAfter } from "@/lib/types";

/** Drag (or use arrow keys on) the handle to reveal more of the "before" or "after" photo. */
export function BeforeAfterSlider({ pair }: { pair: BeforeAfter }) {
  const { t } = useI18n();
  const [pos, setPos] = useState(50);
  return (
    <figure className="mx-auto w-full max-w-[17rem] space-y-1.5">
      <div className="relative aspect-[4/5] w-full select-none overflow-hidden rounded-2xl bg-[var(--surface-sunken)]" dir="ltr">
        <img src={pair.after} alt={t("sv.after")} className="absolute inset-0 size-full object-cover" draggable={false} />
        <img
          src={pair.before}
          alt={t("sv.before")}
          className="absolute inset-0 size-full object-cover"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
          draggable={false}
        />
        <span className="absolute start-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">{t("sv.before")}</span>
        <span className="absolute end-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">{t("sv.after")}</span>
        <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }}>
          <span className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg">
            <MoveHorizontal className="size-4" />
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label={`${t("sv.before")} / ${t("sv.after")}`}
          className="absolute inset-0 size-full cursor-ew-resize opacity-0"
        />
      </div>
      {pair.caption && <figcaption className="text-center text-xs muted">{pair.caption}</figcaption>}
    </figure>
  );
}

export function ServiceShowcase({ service }: { service: { name: string; description: string; banner: string | null; gallery: string[]; beforeAfter: BeforeAfter[] } }) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState<string | null>(null);
  const hasMedia = service.banner || service.gallery.length || service.beforeAfter.length;
  if (!hasMedia && !service.description) return null;
  return (
    <section className="card overflow-hidden p-0 animate-rise">
      {service.banner && <img src={service.banner} alt={service.name} className="aspect-[21/9] w-full object-cover" />}
      <div className="space-y-4 p-4">
        {service.description && <p className="whitespace-pre-line text-sm leading-7">{service.description}</p>}
        {service.beforeAfter.length > 0 && (
          <div>
            <p className="label">{t("sv.beforeAfter")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {service.beforeAfter.map((p, i) => (
                <BeforeAfterSlider key={i} pair={p} />
              ))}
            </div>
          </div>
        )}
        {service.gallery.length > 0 && (
          <div>
            <p className="label">{t("sv.gallery")}</p>
            <div className="scroll-thin -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
              {service.gallery.map((src) => (
                <button key={src} type="button" onClick={() => setZoom(src)} className="shrink-0 snap-start">
                  <img src={src} alt="" className="size-28 rounded-xl object-cover transition hover:opacity-90" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {zoom && (
        <button type="button" onClick={() => setZoom(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" aria-label="close">
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </button>
      )}
    </section>
  );
}
