"use client";

import { PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { zonedIsoDate, zonedToUtc } from "@shopino/shared";
import { StatTile } from "@/components/charts";
import { DatePicker } from "@/components/date-picker";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Tabs } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { date as fmtDate, latinDigits, money, num } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

interface StockRow {
  variantId: string;
  productId: string;
  title: string;
  sku: string | null;
  variantLabel: string;
  price: number;
  costPrice: number | null;
  stock: number;
  reserved: number;
  value: number | null;
  stockPoolId: string | null;
}
interface Valuation {
  items: StockRow[];
  totalValue: number;
  retailValue: number;
  missingCost: number;
  truncated: boolean;
}
interface ReceiptRow {
  id: string;
  code: string;
  supplier: string;
  receivedAt: string;
  total: number;
  lines: number;
}

const digits = (s: string) => Number(latinDigits(s).replace(/\D/g, "") || 0);

export default function InventoryPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const [tab, setTab] = useState<"stock" | "receipts" | "pools">("stock");
  const [creating, setCreating] = useState(false);
  const { data: valuation, mutate: reloadStock } = useApi<Valuation>(`/shops/${shop.id}/inventory/valuation`);
  const { data: receipts, mutate: reloadReceipts } = useApi<ReceiptRow[]>(tab === "receipts" ? `/shops/${shop.id}/inventory/receipts` : null);
  return (
    <div>
      <PageHeader
        title={t("p.inventory")}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PackagePlus className="size-4" /> {t("wh.newReceipt")}
          </Button>
        }
      />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "stock", label: t("wh.stock") },
            { value: "receipts", label: t("wh.receipts") },
            { value: "pools", label: t("pool.tab") },
          ]}
        />
      </div>
      {tab === "stock" ? <StockTab data={valuation} onChanged={reloadStock} /> : tab === "pools" ? <PoolsTab variants={valuation?.items ?? []} onChanged={reloadStock} /> : <ReceiptsTab rows={receipts} />}
      {creating && valuation && (
        <ReceiptModal
          variants={valuation.items}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reloadStock();
            reloadReceipts();
          }}
        />
      )}
    </div>
  );
}

function StockTab({ data, onChanged }: { data: Valuation | undefined; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<StockRow | null>(null);
  if (!data) return <Spinner />;
  const rows = q ? data.items.filter((r) => `${r.title} ${r.variantLabel} ${r.sku ?? ""}`.toLowerCase().includes(q.toLowerCase())) : data.items;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label={t("wh.value")} value={money(data.totalValue, locale)} />
        <StatTile label={t("wh.retailValue")} value={money(data.retailValue, locale)} />
        {data.missingCost > 0 && <StatTile label={t("wh.missingCost")} value={num(data.missingCost, locale)} tone="bad" />}
      </div>
      <Card className="!p-0">
        <div className="border-b border-[var(--border)] p-3">
          <Input placeholder={t("wh.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          {data.truncated && <p className="mt-2 text-xs text-warning">{t("wh.truncated").replace("{n}", num(data.items.length, locale))}</p>}
        </div>
        {rows.length === 0 ? (
          <Empty title={t("rp.noData")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-xs muted">
                  <th className="px-3 py-2 text-start font-normal">{t("inv.item")}</th>
                  <th className="px-3 py-2 text-end font-normal">{t("wh.stockQty")}</th>
                  <th className="px-3 py-2 text-end font-normal">{t("wh.avgCost")}</th>
                  <th className="px-3 py-2 text-end font-normal">{t("sv.price")}</th>
                  <th className="px-3 py-2 text-end font-normal">{t("wh.value")}</th>
                </tr>
              </thead>
              <tbody className="num">
                {rows.map((r) => (
                  <tr key={r.variantId} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">
                      <span className="strong">{r.title}</span>
                      {r.variantLabel && <span className="muted"> · {r.variantLabel}</span>}
                      {r.stockPoolId && (
                        <Badge tone="info" className="ms-1.5">
                          {t("pool.tab")}
                        </Badge>
                      )}
                      {r.sku && <span className="block text-[11px] muted" dir="ltr">{r.sku}</span>}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {num(r.stock, locale)}
                      {r.reserved > 0 && <span className="block text-[11px] muted">{t("wh.reserved")} {num(r.reserved, locale)}</span>}
                    </td>
                    <td className="px-3 py-2 text-end">
                      <button type="button" onClick={() => setEditing(r)} className="inline-flex items-center gap-1 hover:underline" aria-label={t("wh.editCost")}>
                        {r.costPrice === null ? <Badge tone="warning">{t("wh.noCost")}</Badge> : money(r.costPrice, locale, false)}
                        <Pencil className="size-3 muted" />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-end muted">{money(r.price, locale, false)}</td>
                    <td className="px-3 py-2 text-end strong">{r.value === null ? "—" : money(r.value, locale, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <CostModal row={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), onChanged())} />}
    </div>
  );
}

function CostModal({ row, onClose, onSaved }: { row: StockRow; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [cost, setCost] = useState(row.costPrice === null ? "" : String(row.costPrice));
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    try {
      await api(`/shops/${shop.id}/inventory/variants/${row.variantId}/cost`, { method: "PATCH", json: { costPrice: cost.trim() ? digits(cost) : null } });
      onSaved();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open onClose={onClose} title={t("wh.editCost")}>
      <div className="space-y-3">
        <p className="text-sm strong">
          {row.title} {row.variantLabel && <span className="muted">· {row.variantLabel}</span>}
        </p>
        <Field label={t("wh.avgCost")} hint={cost ? money(digits(cost), locale) : undefined}>
          <Input inputMode="numeric" autoFocus value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("a.cancel")}</Button>
          <Button variant="primary" onClick={save}>{t("a.save")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReceiptsTab({ rows }: { rows: ReceiptRow[] | undefined }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  if (!rows) return <Spinner />;
  if (rows.length === 0) return <Card><Empty icon={<PackagePlus className="size-6" />} title={t("rp.noData")} /></Card>;
  return (
    <Card className="!p-0">
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start text-sm hover:bg-[var(--surface-sunken)]">
              <span>
                <span className="num strong" dir="ltr">{r.code}</span>
                {r.supplier && <span className="muted"> · {r.supplier}</span>}
                <span className="block text-xs muted">
                  {fmtDate(r.receivedAt, locale)} · {num(r.lines, locale)} {t("wh.lines")}
                </span>
              </span>
              <span className="num strong">{money(r.total, locale)}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && <ReceiptDetail id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function ReceiptDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data } = useApi<ReceiptRow & { note: string | null; items: { id: string; title: string; variantLabel: string; quantity: number; unitCost: number }[] }>(
    `/shops/${shop.id}/inventory/receipts/${id}`,
  );
  return (
    <Modal open onClose={onClose} title={data?.code ?? "…"} wide>
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-3 text-sm">
          <p className="muted">
            {fmtDate(data.receivedAt, locale)}
            {data.supplier && ` · ${t("wh.supplier")}: ${data.supplier}`}
          </p>
          <ul className="divide-y divide-[var(--border)]">
            {data.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-2">
                <span className="strong">
                  {i.title} {i.variantLabel && <span className="muted">· {i.variantLabel}</span>}
                </span>
                <span className="num muted">
                  {num(i.quantity, locale)} × {money(i.unitCost, locale, false)}
                </span>
              </li>
            ))}
          </ul>
          {data.note && <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2">{data.note}</p>}
          <p className="flex justify-between border-t border-[var(--border)] pt-2 font-semibold strong">
            <span>{t("wh.total")}</span>
            <span className="num">{money(data.total, locale)}</span>
          </p>
        </div>
      )}
    </Modal>
  );
}

interface Line {
  variantId: string;
  quantity: string;
  unitCost: string;
}

function ReceiptModal({ variants, onClose, onSaved }: { variants: StockRow[]; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(() => zonedIsoDate(new Date(), "Asia/Tehran"));
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const taken = new Set(lines.map((l) => l.variantId));
  const matches = q.trim()
    ? variants.filter((v) => !taken.has(v.variantId) && `${v.title} ${v.variantLabel} ${v.sku ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : [];
  const byId = new Map(variants.map((v) => [v.variantId, v]));
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + digits(l.quantity) * digits(l.unitCost), 0);
  const valid = lines.length > 0 && lines.every((l) => digits(l.quantity) > 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/inventory/receipts`, {
        method: "POST",
        json: {
          supplier,
          note: note || undefined,
          receivedAt: zonedToUtc(day, 12 * 60, "Asia/Tehran").toISOString(),
          items: lines.map((l) => ({ variantId: l.variantId, quantity: digits(l.quantity), unitCost: digits(l.unitCost) })),
        },
      });
      onSaved();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("wh.newReceipt")} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("wh.supplier")}>
            <Input value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label={t("exp.date")}>
            <DatePicker value={day} onChange={setDay} />
          </Field>
        </div>
        <div className="relative">
          <Field label={t("wh.addLine")}>
            <Input placeholder={t("wh.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          {matches.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-1 shadow-xl">
              {matches.map((v) => (
                <li key={v.variantId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-[var(--surface-sunken)]"
                    onClick={() => {
                      setLines((ls) => [...ls, { variantId: v.variantId, quantity: "1", unitCost: v.costPrice === null ? "" : String(v.costPrice) }]);
                      setQ("");
                    }}
                  >
                    <span>
                      <span className="strong">{v.title}</span>
                      {v.variantLabel && <span className="muted"> · {v.variantLabel}</span>}
                    </span>
                    <span className="flex items-center gap-1 text-xs muted">
                      {t("wh.stockQty")} {num(v.stock, locale)} <Plus className="size-3.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length > 0 && (
          <ul className="space-y-2">
            {lines.map((l, i) => {
              const v = byId.get(l.variantId)!;
              return (
                <li key={l.variantId} className="flex flex-wrap items-end gap-2 rounded-xl bg-[var(--surface-sunken)] p-2.5">
                  <span className="min-w-40 flex-1 text-sm">
                    <span className="strong">{v.title}</span>
                    {v.variantLabel && <span className="muted"> · {v.variantLabel}</span>}
                  </span>
                  <Field label={t("inv.qty")} className="w-24">
                    <Input inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  </Field>
                  <Field label={t("wh.unitCost")} className="w-40">
                    <Input inputMode="numeric" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                  </Field>
                  <button type="button" aria-label={t("sv.remove")} className="mb-2 rounded-full p-1.5 muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Field label={t("ap.note")}>
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">
            {t("wh.total")}: <span className="num font-bold strong">{money(total, locale)}</span>
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose}>{t("a.cancel")}</Button>
            <Button variant="primary" loading={busy} disabled={!valid} onClick={save}>
              {t("a.save")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface Pool {
  id: string;
  name: string;
  stock: number;
  reserved: number;
  members: { variantId: string; productId: string; title: string; variantLabel: string; sku: string | null }[];
}

/** Shared stock: several products (or variants) that sell the same physical item, so selling one lowers all. */
function PoolsTab({ variants, onChanged }: { variants: StockRow[]; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<Pool[]>(`/shops/${shop.id}/inventory/pools`);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<Pool | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = () => (mutate(), onChanged());
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e);
    }
  };
  if (!data) return <Spinner />;
  const free = variants.filter((v) => !v.stockPoolId);
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm muted">{t("pool.sub")}</p>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <PackagePlus className="size-4" /> {t("pool.new")}
        </Button>
      </Card>
      <ErrorNote error={error} />
      {data.length === 0 ? (
        <Card>
          <Empty title={t("pool.empty")} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((p) => (
            <Card key={p.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold strong">{p.name}</p>
                  <p className="text-xs muted">{t("pool.members").replace("{n}", num(p.members.length, locale))}</p>
                </div>
                <div className="text-end">
                  <p className="num text-2xl font-bold strong">{num(p.stock - p.reserved, locale)}</p>
                  <p className="text-[11px] muted">
                    {t("pool.available")} · {num(p.stock, locale)} {t("pool.total")}
                  </p>
                </div>
              </div>
              <ul className="divide-y divide-[var(--border)] rounded-xl bg-[var(--surface-sunken)] text-sm">
                {p.members.map((m) => (
                  <li key={m.variantId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 truncate strong">
                      {m.title} {m.variantLabel && <span className="muted">· {m.variantLabel}</span>}
                    </span>
                    <button
                      type="button"
                      className="text-xs muted hover:text-danger"
                      onClick={() => run(() => api(`/shops/${shop.id}/inventory/pools/${p.id}/variants/${m.variantId}`, { method: "DELETE" }))}
                    >
                      {t("pool.detach")}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between gap-2">
                <Button size="sm" onClick={() => setAdding(p)}>
                  {t("pool.add")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => confirm(t("pool.deleteConfirm")) && run(() => api(`/shops/${shop.id}/inventory/pools/${p.id}`, { method: "DELETE" }))}>
                  {t("pool.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {creating && <PoolModal variants={free} onClose={() => setCreating(false)} onSaved={() => (setCreating(false), reload())} />}
      {adding && (
        <VariantPick
          title={`${t("pool.add")} · ${adding.name}`}
          variants={free}
          onClose={() => setAdding(null)}
          onPick={(id) =>
            run(async () => {
              await api(`/shops/${shop.id}/inventory/pools/${adding.id}/variants`, { method: "POST", json: { variantId: id } });
              setAdding(null);
            })
          }
        />
      )}
    </div>
  );
}

function VariantPick({ title, variants, onPick, onClose }: { title: string; variants: StockRow[]; onPick: (id: string) => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const rows = variants.filter((v) => `${v.title} ${v.variantLabel} ${v.sku ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <Modal open onClose={onClose} title={title}>
      <Input placeholder={t("wh.search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="mt-3 max-h-80 divide-y divide-[var(--border)] overflow-y-auto">
        {rows.map((v) => (
          <li key={v.variantId}>
            <button type="button" className="flex w-full items-center justify-between gap-2 px-2 py-2 text-start text-sm hover:bg-[var(--surface-sunken)]" onClick={() => onPick(v.variantId)}>
              <span className="truncate strong">
                {v.title} {v.variantLabel && <span className="muted">· {v.variantLabel}</span>}
              </span>
              <span className="num text-xs muted">{num(v.stock, locale)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function PoolModal({ variants, onClose, onSaved }: { variants: StockRow[]; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<StockRow[]>([]);
  const [stock, setStock] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const rows = variants.filter((v) => !picked.includes(v) && `${v.title} ${v.variantLabel} ${v.sku ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/inventory/pools`, {
        method: "POST",
        json: { name: name || picked[0]!.title, variantIds: picked.map((p) => p.variantId), ...(stock ? { stock: digits(stock) } : {}) },
      });
      onSaved();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t("pool.new")}>
      <div className="space-y-3">
        <Field label={t("pool.name")}>
          <Input value={name} maxLength={120} placeholder={picked[0]?.title ?? ""} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <span className="label">{t("pool.pick")}</span>
          {picked.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <li key={p.variantId}>
                  <button type="button" className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs strong" onClick={() => setPicked(picked.filter((x) => x !== p))}>
                    {p.title} {p.variantLabel && `· ${p.variantLabel}`} ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Input placeholder={t("wh.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 max-h-56 divide-y divide-[var(--border)] overflow-y-auto">
            {rows.map((v) => (
              <li key={v.variantId}>
                <button type="button" className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-start text-sm hover:bg-[var(--surface-sunken)]" onClick={() => setPicked([...picked, v])}>
                  <span className="truncate">
                    {v.title} {v.variantLabel && <span className="muted">· {v.variantLabel}</span>}
                  </span>
                  <span className="num text-xs muted">{num(v.stock, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <Field label={t("pool.stock")} hint={t("pool.stockHint")}>
          <Input inputMode="numeric" value={stock} placeholder={picked[0] ? String(picked[0].stock) : ""} onChange={(e) => setStock(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <Button variant="primary" className="w-full" loading={busy} disabled={picked.length < 2} onClick={save}>
          {t("pool.create")}
        </Button>
      </div>
    </Modal>
  );
}
