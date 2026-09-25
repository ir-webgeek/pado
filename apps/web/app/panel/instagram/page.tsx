"use client";

import clsx from "clsx";
import { Download, ExternalLink, Images, Plus, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { latinDigits, money, num } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

interface Extracted {
  isProduct: boolean;
  confidence: number;
  title: string;
  description: string;
  price: number | null;
  variants: { attributes: Record<string, string>; price: number | null }[];
  category: string | null;
}
interface Media {
  id: string;
  mediaType: string;
  caption: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  childUrls: string[];
  status: "new" | "analyzed" | "imported" | "ignored";
  extracted: Extracted | null;
  productId: string | null;
}

export default function InstagramImportPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [tab, setTab] = useState<"new" | "analyzed" | "imported" | "ignored">("analyzed");
  const { data, mutate } = useApi<Media[]>(`/shops/${shop.id}/instagram/media?status=${tab}`, { refreshInterval: tab === "new" ? 5000 : 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [importing, setImporting] = useState<Media | null>(null);
  const [manual, setManual] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t("p.instagram")}
        actions={
          <>
            <Button onClick={() => setManual(true)}>
              <Plus className="size-4" /> {t("ig.manual")}
            </Button>
            <Button loading={busy === "sync"} onClick={() => run("sync", () => api(`/shops/${shop.id}/instagram/sync`, { method: "POST" }).then(() => setTab("new")))}>
              <Download className="size-4" /> {t("ig.sync")}
            </Button>
            <Button variant="primary" loading={busy === "analyze"} onClick={() => run("analyze", () => api(`/shops/${shop.id}/instagram/analyze`, { method: "POST", json: {} }).then(() => setTab("new")))}>
              <Wand2 className="size-4" /> {t("ig.analyze")}
            </Button>
          </>
        }
      />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "analyzed", label: t("ig.product") },
            { value: "new", label: "new" },
            { value: "imported", label: t("ig.imported") },
            { value: "ignored", label: t("ig.ignore") },
          ]}
        />
      </div>
      <ErrorNote error={error} />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <Card>
          <Empty icon={<Images className="size-6" />} title={t("me.empty")} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {data.map((m) => {
            const img = m.mediaType === "VIDEO" ? m.thumbnailUrl : m.mediaUrl;
            const x = m.extracted;
            return (
              <Card key={m.id} className="flex flex-col gap-2 !p-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {img ? <img src={img} alt="" className="aspect-square w-full object-cover" loading="lazy" /> : <div className="aspect-square bg-[var(--surface-sunken)]" />}
                <div className="flex flex-1 flex-col gap-2 p-3">
                  {x ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={x.isProduct ? "success" : "neutral"}>{x.isProduct ? t("ig.product") : t("ig.notProduct")}</Badge>
                        <span className="num text-[11px] muted">
                          {t("ig.confidence")} {num(Math.round(x.confidence * 100), locale)}٪
                        </span>
                      </div>
                      <p className="truncate text-sm font-semibold strong">{x.title || "—"}</p>
                      {x.price && <p className="num text-xs muted">{money(x.price, locale)}</p>}
                    </>
                  ) : (
                    <p className="line-clamp-3 text-xs muted">{m.caption || "—"}</p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-1.5">
                    {m.status !== "imported" && (
                      <Button size="sm" variant="primary" onClick={() => setImporting(m)}>
                        {t("ig.import")}
                      </Button>
                    )}
                    {m.status !== "ignored" && m.status !== "imported" && (
                      <Button size="sm" variant="ghost" onClick={() => run(m.id, () => api(`/shops/${shop.id}/instagram/media/${m.id}/ignore`, { method: "POST" }))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                    {m.permalink && (
                      <a href={m.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center p-1.5 muted">
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {importing && <ImportModal media={importing} onClose={() => setImporting(null)} onDone={() => (setImporting(null), mutate())} />}
      {manual && <ManualModal onClose={() => setManual(false)} onDone={() => (setManual(false), setTab("new"), mutate())} />}
    </div>
  );
}

function ImportModal({ media, onClose, onDone }: { media: Media; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const x = media.extracted;
  const [title, setTitle] = useState(x?.title ?? "");
  const [description, setDescription] = useState(x?.description ?? media.caption);
  const [price, setPrice] = useState(String(x?.price ?? ""));
  const [category, setCategory] = useState(x?.category ?? "");
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [variants, setVariants] = useState(
    (x?.variants ?? []).map((v) => ({ attr: Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(", "), price: String(v.price ?? ""), stock: "1" })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const images = [media.mediaType === "VIDEO" ? media.thumbnailUrl : media.mediaUrl, ...media.childUrls].filter(Boolean) as string[];

  const toAttrs = (s: string) =>
    Object.fromEntries(
      s
        .split(/[,،]/)
        .map((p) => p.split(":").map((z) => z.trim()))
        .filter((p) => p[0])
        .map((p) => (p[1] ? [p[0], p[1]] : ["option", p[0]])),
    ) as Record<string, string>;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/instagram/media/${media.id}/import`, {
        method: "POST",
        json: {
          title,
          description,
          price: Number(latinDigits(price) || 0),
          categoryName: category || undefined,
          status,
          variants: variants.map((v) => ({ attributes: toAttrs(v.attr), price: Number(latinDigits(v.price) || latinDigits(price) || 0), stock: Number(latinDigits(v.stock) || 0) })),
        },
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("ig.import")} wide>
      <div className="space-y-4">
        <div className="flex gap-2 overflow-x-auto">
          {images.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt="" className="size-24 shrink-0 rounded-xl object-cover" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("pr.title")} className="sm:col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("pr.price")}>
            <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label={t("pr.desc")}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("sf.category")}>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label={t("pr.statusLabel")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as "draft")}>
              <option value="draft">{t("pr.status.draft")}</option>
              <option value="active">{t("pr.status.active")}</option>
            </Select>
          </Field>
        </div>
        <div>
          <p className="label">{t("pr.variants")}</p>
          {variants.map((v, i) => (
            <div key={i} className="mb-2 grid grid-cols-12 gap-2">
              <Input className="col-span-6" value={v.attr} placeholder={t("pr.attr")} onChange={(e) => setVariants((vs) => vs.map((z, j) => (j === i ? { ...z, attr: e.target.value } : z)))} />
              <Input className="col-span-3" value={v.price} placeholder={t("pr.price")} onChange={(e) => setVariants((vs) => vs.map((z, j) => (j === i ? { ...z, price: e.target.value } : z)))} />
              <Input className="col-span-2" value={v.stock} placeholder={t("pr.stock")} onChange={(e) => setVariants((vs) => vs.map((z, j) => (j === i ? { ...z, stock: e.target.value } : z)))} />
              <button className="col-span-1 muted hover:text-danger" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setVariants((vs) => [...vs, { attr: "", price: "", stock: "1" }])}>
            <Plus className="size-4" /> {t("pr.addVariant")}
          </Button>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("a.cancel")}</Button>
          <Button variant="primary" loading={busy} disabled={!title || !price} onClick={submit}>
            {t("ig.import")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ManualModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [caption, setCaption] = useState("");
  const [urls, setUrls] = useState("");
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title={t("ig.manual")}>
      <div className={clsx("space-y-3")}>
        <Field label={t("ig.caption")}>
          <Textarea className="min-h-32" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Field label={t("ig.imageUrls")}>
          <Textarea dir="ltr" className="min-h-20 text-xs" value={urls} onChange={(e) => setUrls(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={!urls.trim()}
          onClick={async () => {
            try {
              await api(`/shops/${shop.id}/instagram/media/manual`, { method: "POST", json: { caption, imageUrls: urls.split("\n").map((u) => u.trim()).filter(Boolean) } });
              onDone();
            } catch (e) {
              setError(e);
            }
          }}
        >
          {t("a.save")}
        </Button>
      </div>
    </Modal>
  );
}
