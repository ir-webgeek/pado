"use client";

import { CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useState } from "react";
import { Button, ErrorNote, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { latinDigits } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { shopAccent } from "@/lib/brand";

interface PublicForm {
  form: { id: string; title: string; description: string; fields: { key: string; label: string; type: string; required: boolean; options?: string[] }[] };
  shop: { name: string; slug: string; brandColor: string };
}

export default function PublicFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <FormView id={id} />
    </Suspense>
  );
}

function FormView({ id }: { id: string }) {
  const { t } = useI18n();
  const c = useSearchParams().get("c");
  const { data, error } = useApi<PublicForm>(`/public/forms/${id}`);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  if (error) return <p className="p-10 text-center muted">{t("common.error")}</p>;
  if (!data) return <Spinner className="mx-auto mt-20" />;
  const brand = shopAccent(data.shop?.brandColor);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setErrors({});
    const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "string" ? latinDigits(v) : v]));
    try {
      const r = await api<{ message: string }>(`/public/forms/${id}${c ? `?c=${encodeURIComponent(c)}` : ""}`, { method: "POST", json: body });
      setDone(r.message || t("fm.thanks"));
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === "validation_error" && e2.details && typeof e2.details === "object") {
        setErrors(e2.details as Record<string, string>);
      }
      setErr(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-theme="day" className="min-h-dvh bg-[var(--bg)] px-4 py-10 text-[var(--text-body)]" style={{ "--accent": brand } as React.CSSProperties}>
      <div className="mx-auto max-w-lg">
        <p className="mb-2 text-center text-sm muted">{data.shop?.name}</p>
        <div className="card p-6">
          {done ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto size-12 text-success" />
              <p className="mt-4 font-semibold strong">{done}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h1 className="text-xl font-bold strong">{data.form.title}</h1>
                {data.form.description && <p className="mt-1 text-sm muted">{data.form.description}</p>}
              </div>
              {data.form.fields.map((f) => {
                const v = values[f.key];
                const set = (x: string | boolean) => setValues((s) => ({ ...s, [f.key]: x }));
                const label = `${f.label}${f.required ? " *" : ""}`;
                const hint = errors[f.key];
                if (f.type === "checkbox")
                  return (
                    <label key={f.key} className="flex items-center gap-2 text-sm strong">
                      <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(e.target.checked)} className="accent-[var(--accent)]" /> {label}
                      {hint && <span className="text-xs text-danger">{hint}</span>}
                    </label>
                  );
                return (
                  <Field key={f.key} label={label} hint={hint}>
                    {f.type === "textarea" ? (
                      <Textarea value={String(v ?? "")} onChange={(e) => set(e.target.value)} required={f.required} />
                    ) : f.type === "select" ? (
                      <Select value={String(v ?? "")} onChange={(e) => set(e.target.value)} required={f.required}>
                        <option value="">—</option>
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        type={f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
                        inputMode={f.type === "phone" ? "tel" : f.type === "number" ? "decimal" : undefined}
                        dir={f.type === "phone" || f.type === "email" ? "ltr" : undefined}
                        value={String(v ?? "")}
                        onChange={(e) => set(e.target.value)}
                        required={f.required}
                      />
                    )}
                  </Field>
                );
              })}
              <ErrorNote error={err} />
              <Button variant="primary" size="lg" className="w-full" loading={busy}>
                {t("fm.submit")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
