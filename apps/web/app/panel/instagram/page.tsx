"use client";

import clsx from "clsx";
import { Download, ExternalLink, Images, Plus, ScanText, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { latinDigits, money, num } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import { InstagramAccount } from "@/components/instagram-account";
import { Thumb } from "@/components/thumb";

interface Extracted {
  isProduct: boolean;
  confidence: number;
  title: string;
  description: string;
  price: number | null;
  variants: { attributes: Record<string, string>; price: number | null }[];
  category: string | null;
  source?: "rules" | "ai";
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

/** Instagram: the connected account (default) and turning posts into products. */
export default function InstagramPage() {
  const { t } = useI18n();
  const [section, setSection] = useState<"account" | "posts">("account");
  return (
    <div>
      <PageHeader title={t("iga.title")} subtitle={t("iga.sub")} />
      <div className="mb-4">
        <Tabs
          value={section}
          onChange={setSection}
          items={[
            { value: "account", label: t("iga.tabAccount") },
            { value: "posts", label: t("iga.tabPosts") },
          ]}
        />
      </div>
      {section === "account" ? <InstagramAccount /> : <InstagramImport />}
    </div>
  );
}

type View = "products" | "others" | "imported" | "ignored";
interface Counts {
  products: number;
  others: number;
  imported: number;
  ignored: number;
  aiScanned: number;
  aiAvailable: boolean;
}

function InstagramImport() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [view, setView] = useState<View>("products");
  const { data, mutate } = useApi<Media[]>(`/shops/${shop.id}/instagram/media?view=${view}`);
  const { data: counts, mutate: reloadCounts } = useApi<Counts>(`/shops/${shop.id}/instagram/media/counts`, { refreshInterval: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState<Media | null>(null);
  const [manual, setManual] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<"draft" | "active">("draft");
  const [bulkStock, setBulkStock] = useState(1);

  const refresh = () => Promise.all([mutate(), reloadCounts()]);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const switchView = (v: View) => (setView(v), setPicked(new Set()));
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ready = (data ?? []).filter((m) => m.extracted?.price && m.extracted.title);
  const importPicked = () =>
    run("bulk", async () => {
      const r = await api<{ imported: unknown[]; skipped: { reason: string }[] }>(`/shops/${shop.id}/instagram/import-bulk`, {
        method: "POST",
        json: { ids: [...picked], status: bulkStatus, stock: bulkStock },
      });
      setPicked(new Set());
      setNotice(t("ig.bulkDone").replace("{n}", num(r.imported.length, locale)).replace("{s}", num(r.skipped.length, locale)));
    });

  return (
    <div className={clsx(picked.size > 0 && "pb-24")}>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Button onClick={() => setManual(true)}>
          <Plus className="size-4" /> {t("ig.manual")}
        </Button>
        <Button loading={busy === "sync"} onClick={() => run("sync", () => api(`/shops/${shop.id}/instagram/sync`, { method: "POST" }))}>
          <Download className="size-4" /> {t("ig.sync")}
        </Button>
        <Button
          loading={busy === "scan"}
          onClick={() =>
            run("scan", async () => {
              const r = await api<{ scanned: number }>(`/shops/${shop.id}/instagram/scan`, { method: "POST", json: {} });
              setNotice(t("ig.scanned").replace("{n}", num(r.scanned, locale)));
            })
          }
        >
          <ScanText className="size-4" /> {t("ig.scan")}
        </Button>
        {counts?.aiAvailable && (
          <Button
            variant="primary"
            loading={busy === "analyze"}
            onClick={() =>
              run("analyze", async () => {
                const r = await api<{ queued: number }>(`/shops/${shop.id}/instagram/analyze`, { method: "POST", json: {} });
                setNotice(t("ig.aiQueued").replace("{n}", num(r.queued, locale)));
              })
            }
          >
            <Wand2 className="size-4" /> {t("ig.analyze")}
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs muted">{counts?.aiAvailable ? t("ig.scanHintAi") : t("ig.scanHint")}</p>
      <div className="mb-4">
        <Tabs
          value={view}
          onChange={switchView}
          items={[
            { value: "products", label: t("ig.viewProducts"), count: counts?.products },
            { value: "others", label: t("ig.viewOthers"), count: counts?.others },
            { value: "imported", label: t("ig.imported"), count: counts?.imported },
            { value: "ignored", label: t("ig.ignore"), count: counts?.ignored },
          ]}
        />
      </div>
      <ErrorNote error={error} />
      {notice && <p className="mb-3 rounded-xl bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}
      {view === "products" && ready.length > 1 && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <button className="text-[var(--accent)]" onClick={() => setPicked(picked.size === ready.length ? new Set() : new Set(ready.map((m) => m.id)))}>
            {picked.size === ready.length ? t("ig.unselectAll") : t("ig.selectReady").replace("{n}", num(ready.length, locale))}
          </button>
        </div>
      )}
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <Card>
          <Empty icon={<Images className="size-6" />} title={t(view === "products" ? "ig.emptyProducts" : "me.empty")} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {data.map((m) => {
            const img = m.mediaType === "VIDEO" ? m.thumbnailUrl : m.mediaUrl;
            const x = m.extracted;
            const canPick = view === "products" && Boolean(x?.price && x.title);
            return (
              <Card key={m.id} className={clsx("relative flex flex-col gap-2 overflow-hidden !p-0", picked.has(m.id) && "ring-2 ring-[var(--accent)]")}>
                {canPick && (
                  <label className="absolute start-2 top-2 z-10 flex size-7 cursor-pointer items-center justify-center rounded-lg bg-black/50 backdrop-blur">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={picked.has(m.id)} onChange={() => toggle(m.id)} aria-label={t("ig.pick")} />
                  </label>
                )}
                {img ? <Thumb src={img} className="aspect-square w-full object-cover" loading="lazy" /> : <div className="aspect-square bg-[var(--surface-sunken)]" />}
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  {x && m.status !== "new" ? (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={x.source === "ai" ? "info" : "neutral"}>{x.source === "ai" ? t("ig.byAi") : t("ig.byRules")}</Badge>
                        <span className="num text-[11px] muted">
                          {t("ig.confidence")} {num(Math.round(x.confidence * 100), locale)}٪
                        </span>
                      </div>
                      <p className="truncate text-sm font-semibold strong">{x.title || t("ig.noTitle")}</p>
                      <p className="num text-xs">{x.price ? money(x.price, locale) : <span className="text-warning">{t("ig.noPrice")}</span>}</p>
                      {(x.variants.length > 0 || x.category) && (
                        <p className="truncate text-[11px] muted">
                          {x.category}
                          {x.category && x.variants.length > 0 && " · "}
                          {x.variants.length > 0 && t("ig.variants").replace("{n}", num(x.variants.length, locale))}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="line-clamp-3 text-xs muted">{m.caption || "-"}</p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {m.status !== "imported" && (
                      <Button size="sm" variant={view === "products" ? "primary" : "secondary"} onClick={() => setImporting(m)}>
                        {t(view === "products" ? "ig.import" : "ig.makeProduct")}
                      </Button>
                    )}
                    {m.status !== "ignored" && m.status !== "imported" && (
                      <Button size="sm" variant="ghost" aria-label={t("ig.ignore")} onClick={() => run(m.id, () => api(`/shops/${shop.id}/instagram/media/${m.id}/ignore`, { method: "POST" }))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                    {m.productId && (
                      <a href={`/panel/products?edit=${m.productId}`} className="inline-flex items-center gap-1 p-1.5 text-xs text-[var(--accent)]">
                        {t("ig.openProduct")}
                      </a>
                    )}
                    {m.permalink && (
                      <a href={m.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center p-1.5 muted" aria-label="Instagram">
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

      {picked.size > 0 && (
        <div className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-3 shadow-2xl lg:bottom-6">
          <span className="text-sm font-semibold strong">{t("ig.pickedN").replace("{n}", num(picked.size, locale))}</span>
          <span className="ms-auto flex flex-wrap items-center gap-2">
            <Select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as "draft" | "active")} className="!w-auto !py-1.5 text-sm" aria-label={t("pr.statusLabel")}>
              <option value="draft">{t("pr.status.draft")}</option>
              <option value="active">{t("pr.status.active")}</option>
            </Select>
            <label className="flex items-center gap-1 text-xs muted">
              {t("ig.stockEach")}
              <Input type="number" min={0} max={10000} value={bulkStock} onChange={(e) => setBulkStock(Math.max(0, Number(e.target.value) || 0))} className="!w-20 !py-1.5 text-sm" />
            </label>
            <Button variant="primary" loading={busy === "bulk"} onClick={importPicked}>
              {t("ig.importPicked")}
            </Button>
          </span>
        </div>
      )}
      {importing && <ImportModal media={importing} onClose={() => setImporting(null)} onDone={() => (setImporting(null), refresh())} />}
      {manual && <ManualModal onClose={() => setManual(false)} onDone={() => (setManual(false), refresh())} />}
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
            <Thumb key={u} src={u} className="size-24 shrink-0 rounded-xl object-cover" />
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
