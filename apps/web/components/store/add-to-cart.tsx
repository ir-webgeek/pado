"use client";

import clsx from "clsx";
import { useState } from "react";
import { Button } from "@/components/ui";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { useCart } from "./cart";

export interface PublicVariant {
  id: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  available: number;
}

export function VariantPicker({ title, image, variants }: { title: string; image?: string; variants: PublicVariant[] }) {
  const { t, locale } = useI18n();
  const { add } = useCart();
  const firstAvailable = variants.find((v) => v.available > 0) ?? variants[0];
  const [selected, setSelected] = useState(firstAvailable?.id);
  const v = variants.find((x) => x.id === selected);
  const label = (x: PublicVariant) => Object.values(x.attributes).join(" / ");
  return (
    <div className="space-y-5">
      <p className="num text-2xl font-bold strong">
        {v && money(v.price, locale)}
        {v?.compareAtPrice && v.compareAtPrice > v.price && <span className="ms-2 text-base font-normal line-through muted">{money(v.compareAtPrice, locale, false)}</span>}
      </p>
      {variants.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {variants.map((x) => (
            <button
              key={x.id}
              disabled={x.available <= 0}
              onClick={() => setSelected(x.id)}
              className={clsx(
                "min-w-12 rounded-xl border px-3 py-2 text-sm transition disabled:line-through disabled:opacity-40",
                selected === x.id ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] strong",
              )}
            >
              {label(x) || "—"}
            </button>
          ))}
        </div>
      )}
      <Button
        variant="primary"
        size="lg"
        className="w-full sm:w-auto"
        disabled={!v || v.available <= 0}
        onClick={() => v && add({ variantId: v.id, title, label: label(v), price: v.price, image, max: v.available })}
      >
        {v && v.available > 0 ? t("sf.addToCart") : t("sf.outOfStock")}
      </Button>
    </div>
  );
}
