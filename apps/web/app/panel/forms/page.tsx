"use client";

import { ArrowDown, ArrowUp, ClipboardList, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

type FieldType = "text" | "textarea" | "phone" | "email" | "number" | "select" | "date" | "checkbox";
interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}
interface Form {
  id: string;
  title: string;
  description: string;
  fields: FormField[];
  successMessage: string;
  active: boolean;
  submissions: number;
}
const TYPES: FieldType[] = ["text", "textarea", "phone", "email", "number", "select", "date", "checkbox"];

export default function FormsPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<Form[]>(`/shops/${shop.id}/forms`);
  const [editing, setEditing] = useState<Form | "new" | null>(null);
  const [viewing, setViewing] = useState<Form | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const link = (id: string) => `${window.location.origin}/f/${id}`;

  return (
    <div>
      <PageHeader
        title={t("p.forms")}
        subtitle={t("au.free")}
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t("fm.new")}
          </Button>
        }
      />
      {!data ? (
        <Spinner />
      ) : data.filter((f) => f.active).length === 0 ? (
        <Card>
          <Empty icon={<ClipboardList className="size-6" />} title={t("fm.new")} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data
            .filter((f) => f.active)
            .map((f) => (
              <Card key={f.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold strong">{f.title}</p>
                    <p className="text-xs muted">
                      {num(f.fields.length, locale)} {t("fm.fields")} · {num(f.submissions, locale)} {t("fm.submissions")}
                    </p>
                  </div>
                  <ClipboardList className="size-5 text-[var(--accent)]" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {f.fields.slice(0, 5).map((x) => (
                    <Badge key={x.key}>{x.label}</Badge>
                  ))}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setEditing(f)}>{t("a.edit")}</Button>
                  <Button size="sm" onClick={() => setViewing(f)}>{t("fm.submissions")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => (navigator.clipboard.writeText(link(f.id)), setCopied(f.id))}>
                    <Copy className="size-3.5" /> {copied === f.id ? t("a.copied") : t("fm.link")}
                  </Button>
                </div>
              </Card>
            ))}
        </div>
      )}
      {editing && <FormEditor form={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), mutate())} />}
      {viewing && <Submissions form={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function FormEditor({ form, onClose, onSaved }: { form: Form | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [title, setTitle] = useState(form?.title ?? "");
  const [description, setDescription] = useState(form?.description ?? "");
  const [successMessage, setSuccess] = useState(form?.successMessage ?? "");
  const [fields, setFields] = useState<FormField[]>(form?.fields ?? [
    { key: "name", label: "نام", type: "text", required: true },
    { key: "phone", label: "موبایل", type: "phone", required: true },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const upd = (i: number, patch: Partial<FormField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) =>
    setFields((fs) => {
      const next = [...fs];
      const [x] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(fs.length - 1, i + d)), 0, x!);
      return next;
    });
  const nextKey = () => {
    let n = fields.length + 1;
    while (fields.some((f) => f.key === `field_${n}`)) n++;
    return `field_${n}`;
  };

  async function save() {
    setBusy(true);
    setError(null);
    const body = { title, description, successMessage, active: true, fields: fields.map((f) => (f.type === "select" ? f : { ...f, options: undefined })) };
    try {
      if (form) await api(`/shops/${shop.id}/forms/${form.id}`, { method: "PUT", json: body });
      else await api(`/shops/${shop.id}/forms`, { method: "POST", json: body });
      onSaved();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={form?.title ?? t("fm.new")} wide>
      <div className="space-y-4">
        <Field label={t("fm.title")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("pr.desc")}>
          <Textarea className="min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div>
          <p className="label">{t("fm.fields")}</p>
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-xl bg-[var(--surface-sunken)] p-2">
                <Input className="col-span-12 sm:col-span-4" placeholder={t("fm.label")} value={f.label} onChange={(e) => upd(i, { label: e.target.value })} />
                <Select className="col-span-6 sm:col-span-3" value={f.type} onChange={(e) => upd(i, { type: e.target.value as FieldType })}>
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>{t(`fm.t.${ty}` as DictKey)}</option>
                  ))}
                </Select>
                <Input className="col-span-6 sm:col-span-2" dir="ltr" value={f.key} onChange={(e) => upd(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
                <label className="col-span-6 flex items-center gap-1.5 text-xs sm:col-span-1">
                  <input type="checkbox" checked={f.required} onChange={(e) => upd(i, { required: e.target.checked })} /> {t("fm.required")}
                </label>
                <span className="col-span-6 flex justify-end gap-0.5 sm:col-span-2">
                  <button className="p-1 muted" onClick={() => move(i, -1)}><ArrowUp className="size-4" /></button>
                  <button className="p-1 muted" onClick={() => move(i, 1)}><ArrowDown className="size-4" /></button>
                  <button className="p-1 muted hover:text-danger" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                </span>
                {f.type === "select" && (
                  <Input className="col-span-12" placeholder={t("fm.options")} value={(f.options ?? []).join("، ")} onChange={(e) => upd(i, { options: e.target.value.split(/[,،]/).map((o) => o.trim()).filter(Boolean) })} />
                )}
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFields((fs) => [...fs, { key: nextKey(), label: "", type: "text", required: false }])}>
            <Plus className="size-4" /> {t("fm.addField")}
          </Button>
        </div>
        <Field label={t("fm.success")}>
          <Input value={successMessage} onChange={(e) => setSuccess(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-between gap-2">
          {form ? (
            <Button variant="danger" onClick={async () => (await api(`/shops/${shop.id}/forms/${form.id}`, { method: "DELETE" }), onSaved())}>
              <Trash2 className="size-4" />
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>{t("a.cancel")}</Button>
            <Button variant="primary" loading={busy} disabled={!title || fields.some((f) => !f.label || !f.key)} onClick={save}>
              {t("a.save")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Submissions({ form, onClose }: { form: Form; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data } = useApi<{ id: string; data: Record<string, string | boolean>; createdAt: string; conversationId: string | null }[]>(`/shops/${shop.id}/forms/${form.id}/submissions`);
  const csv = () => {
    const head = ["date", ...form.fields.map((f) => f.label)];
    const rows = (data ?? []).map((s) => [s.createdAt, ...form.fields.map((f) => String(s.data[f.key] ?? ""))]);
    const text = [head, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
    a.download = `${form.title}.csv`;
    a.click();
  };
  return (
    <Modal open onClose={onClose} title={`${form.title} · ${t("fm.submissions")}`} wide>
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <Empty title={t("me.empty")} />
      ) : (
        <div className="space-y-3">
          <Button size="sm" onClick={csv}>CSV</Button>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs muted">
                  <th className="p-2 text-start">{t("ap.time")}</th>
                  {form.fields.map((f) => (
                    <th key={f.key} className="p-2 text-start">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap p-2 text-xs muted">{dateTime(s.createdAt, locale)}</td>
                    {form.fields.map((f) => (
                      <td key={f.key} className="p-2 strong">{typeof s.data[f.key] === "boolean" ? (s.data[f.key] ? "✓" : "—") : String(s.data[f.key] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs muted">{num(data.length, locale)} {t("fm.submissions")}</p>
        </div>
      )}
    </Modal>
  );
}
