"use client";

import { Check, X } from "lucide-react";
import { isValidSheba, normalizeSheba } from "@shopino/shared";
import { Field, Input } from "@/components/ui";
import { useI18n } from "@/lib/locale-client";

/** SHEBA (Iranian IBAN) with a live checksum check, so a mistyped digit is caught before money is routed to it. */
export function ShebaInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const norm = normalizeSheba(value);
  const state = !value ? null : isValidSheba(value) ? "ok" : norm.length >= 26 ? "bad" : null;
  return (
    <Field label={t("sheba.label")} hint={state === "bad" ? t("sheba.bad") : t("sheba.hint")}>
      <div className="relative">
        <Input dir="ltr" value={value} maxLength={34} placeholder="IR00 0000 0000 0000 0000 0000 00" aria-invalid={state === "bad"} onChange={(e) => onChange(e.target.value)} />
        {state && (
          <span className={`absolute end-3 top-1/2 -translate-y-1/2 ${state === "ok" ? "text-success" : "text-danger"}`}>
            {state === "ok" ? <Check className="size-4" /> : <X className="size-4" />}
          </span>
        )}
      </div>
    </Field>
  );
}

export const shebaPayload = (v: string) => (v.trim() ? normalizeSheba(v) : undefined);
