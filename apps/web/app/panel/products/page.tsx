"use client";

import { ImageOff, Package, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { UploadButton } from "@/components/upload";
import { api, useApi } from "@/lib/api";
import { latinDigits, money, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import type { Product } from "@/lib/types";

interface VariantDraft {
  id?: string;
  attr: string; // "size: 38, color: cream"
  price: string;
  usd: string; // USD price, e.g. "45.00"
  stock: string;
  sku: string;
}

const emptyVariant = (): VariantDraft => ({ attr: "", price: "", usd: "", stock: "0", sku: "" });

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(/[,،]/)) {
    const [k, ...rest] = part.split(/[:：]/);
    const key = k?.trim();
    const v = rest.join(":").trim();
    if (key && v) out[key] = v;
    else if (key) out.option = key;
  }
  return out;
}
const attrsToText = (a: Record<string, string>) =>
  Object.entries(a)
    .map(([k, v]) => (k === "option" ? v : `${k}: ${v}`))
    .join(", ");

export default function ProductsPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const { data, mutate } = useApi<{ items: Product[] }>(`/shops/${shop.id}/products?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`);

  return (
    <div>
      <PageHeader
        title={t("p.products")}
        subtitle={data ? `${num(data.items.length, locale)}` : undefined}
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t("pr.new")}
          </Button>
        }
      />
      <div className="relative mb-4 sm:w-72">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 muted" />
        <Input className="ps-9" placeholder={t("a.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <Card>
          <Empty icon={<Package className="size-6" />} title={t("pr.empty")}>
            <Button variant="primary" className="mt-3" onClick={() => setEditing("new")}>{t("pr.new")}</Button>
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {data.items.map((p) => {
            const available = p.variants.reduce((a, v) => a + v.stock - v.reserved, 0);
            const low = p.variants.some((v) => v.stock - v.reserved <= v.lowStockThreshold);
            const prices = p.variants.map((v) => v.price);
            return (
              <button key={p.id} onClick={() => setEditing(p)} className="card overflow-hidden p-0 text-start transition hover:border-gold/40">
                <div className="aspect-square bg-[var(--surface-sunken)]">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0]} alt={p.title} className="size-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex size-full items-center justify-center muted">
                      <ImageOff className="size-6" />
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 p-3">
                  <p className="truncate text-sm font-semibold strong">{p.title}</p>
                  <p className="num text-xs muted">{money(Math.min(...prices), locale)}</p>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={available <= 0 ? "danger" : low ? "warning" : "success"}>
                      {num(available, locale)} {t("pr.available")}
                    </Badge>
                    {p.status !== "active" && <Badge>{t(`pr.status.${p.status}` as DictKey)}</Badge>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {editing && (
        <ProductEditor
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
        />
      )}
    </div>
  );
}

function ProductEditor({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [title, setTitle] = useState(product?.title ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [status, setStatus] = useState<Product["status"]>(product?.status ?? "active");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [seoTitle, setSeoTitle] = useState(product?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(product?.seoDescription ?? "");
  const { data: categories } = useApi<{ id: string; name: string }[]>(`/shops/${shop.id}/categories`);
  const { data: shopInfo } = useApi<{ shop: { settings: { pricing: { usdEnabled: boolean; usdRate: number } } } }>(`/shops/${shop.id}`);
  const usd = shopInfo?.shop.settings.pricing;
  const [variants, setVariants] = useState<VariantDraft[]>(
    product?.variants.map((v) => ({
      id: v.id,
      attr: attrsToText(v.attributes),
      price: String(v.price),
      usd: v.priceUsdCents ? (v.priceUsdCents / 100).toFixed(2) : "",
      stock: String(v.stock),
      sku: v.sku ?? "",
    })) ?? [emptyVariant()],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const setV = (i: number, patch: Partial<VariantDraft>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        title,
        description,
        status,
        images,
        categoryId: categoryId || null,
        seoTitle: seoTitle || undefined,
        seoDescription: seoDescription || undefined,
        variants: variants.map((v) => ({
          ...(v.id ? { id: v.id } : {}),
          attributes: parseAttrs(v.attr),
          price: Number(latinDigits(v.price) || 0),
          priceUsdCents: v.usd ? Math.round(Number(latinDigits(v.usd)) * 100) : null,
          stock: Number(latinDigits(v.stock) || 0),
          sku: v.sku || undefined,
          lowStockThreshold: 3,
        })),
      };
      if (product) await api(`/shops/${shop.id}/products/${product.id}`, { method: "PUT", json: body });
      else await api(`/shops/${shop.id}/products`, { method: "POST", json: body });
      onSaved();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={product ? product.title : t("pr.new")} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("pr.title")} className="sm:col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("pr.statusLabel")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as Product["status"])}>
              {(["active", "draft", "archived"] as const).map((s) => (
                <option key={s} value={s}>{t(`pr.status.${s}`)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("pr.desc")}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div>
          <p className="label">{t("pr.images")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {images.map((src, i) => (
              <span key={src} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="size-20 rounded-xl object-cover" />
                <button onClick={() => setImages((im) => im.filter((_, j) => j !== i))} className="absolute -end-1.5 -top-1.5 hidden rounded-full bg-danger p-1 text-white group-hover:block">
                  <Trash2 className="size-3" />
                </button>
                {i === 0 && <span className="absolute bottom-1 start-1 rounded bg-black/60 px-1 text-[9px] text-white">★</span>}
              </span>
            ))}
            <UploadButton label={t("au.upload")} onUploaded={(url) => setImages((im) => [...im, url])} />
          </div>
          <Input dir="ltr" className="mt-2 text-xs" placeholder="https://... (Enter)" onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.startsWith("http")) {
              e.preventDefault();
              const v = e.currentTarget.value.trim();
              setImages((im) => [...im, v]);
              e.currentTarget.value = "";
            }
          }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("sf.category")}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">—</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("pr.seoTitle")}>
            <Input value={seoTitle} maxLength={120} onChange={(e) => setSeoTitle(e.target.value)} />
          </Field>
          <Field label={t("pr.seoDesc")}>
            <Input value={seoDescription} maxLength={300} onChange={(e) => setSeoDescription(e.target.value)} />
          </Field>
        </div>
        <div>
          <p className="label">{t("pr.variants")}</p>
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 rounded-xl bg-[var(--surface-sunken)] p-2">
                <Input className={usd?.usdEnabled ? "col-span-12 sm:col-span-3" : "col-span-12 sm:col-span-4"} placeholder={t("pr.attr")} value={v.attr} onChange={(e) => setV(i, { attr: e.target.value })} />
                {usd?.usdEnabled && (
                  <Input className="col-span-4 sm:col-span-1" dir="ltr" inputMode="decimal" placeholder="$" title={t("pc.usdPrice")} value={v.usd} onChange={(e) => setV(i, { usd: e.target.value })} />
                )}
                <Input className={usd?.usdEnabled ? "col-span-4 sm:col-span-3" : "col-span-5 sm:col-span-3"} inputMode="numeric" placeholder={t("pr.price")} disabled={Boolean(usd?.usdEnabled && v.usd)} value={v.price} onChange={(e) => setV(i, { price: e.target.value })} />
                <Input className="col-span-3 sm:col-span-2" inputMode="numeric" placeholder={t("pr.stock")} value={v.stock} onChange={(e) => setV(i, { stock: e.target.value })} />
                <Input className="col-span-3 sm:col-span-2" dir="ltr" placeholder={t("pr.sku")} value={v.sku} onChange={(e) => setV(i, { sku: e.target.value })} />
                <button className="col-span-1 flex items-center justify-center muted hover:text-danger disabled:opacity-30" disabled={variants.length === 1} onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setVariants((vs) => [...vs, emptyVariant()])}>
            <Plus className="size-4" /> {t("pr.addVariant")}
          </Button>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("a.cancel")}</Button>
          <Button variant="primary" loading={saving} onClick={save} disabled={!title || variants.some((v) => !v.price && !v.usd)}>
            {t("a.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
