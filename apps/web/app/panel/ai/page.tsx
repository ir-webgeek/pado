"use client";

import { BookOpen, Brain, Database, LayoutTemplate, Plus, RefreshCw, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import { SalesPersonaEditor, type Persona } from "@/components/sales-persona";

interface Entry {
  id: string;
  title: string;
  content: string;
  source: string;
  active: boolean;
}
interface Landing {
  headline: string;
  subheadline: string;
  highlights: { title: string; text: string }[];
  faq: { q: string; a: string }[];
  featuredCategorySlugs: string[];
}
interface ShopResp {
  shop: { landing: Landing | null; settings: { agent: { enabled: boolean; consultOnWeb: boolean; learnedStyle: string; tone: string }; sales: Persona } };
  plan: { features: string[] };
}

export default function AiPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const { data: shopData, mutate: reloadShop } = useApi<ShopResp>(`/shops/${shop.id}`);
  const hasAi = shopData?.plan.features.includes("agent");
  const agent = shopData?.shop.settings.agent;

  const patchAgent = async (patch: Partial<{ enabled: boolean; consultOnWeb: boolean; learnedStyle: string }>) => {
    await api(`/shops/${shop.id}/settings`, { method: "PATCH", json: { agent: patch } });
    reloadShop();
  };

  if (!shopData) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("p.ai")}
        subtitle={!hasAi ? t("ai.needsPlan") : undefined}
        actions={
          <Link href="/panel/inbox">
            <Button>
              <Sparkles className="size-4" /> {t("in.playground")}
            </Button>
          </Link>
        }
      />
      <Card className="grid gap-2 sm:grid-cols-2">
        <Toggle checked={Boolean(agent?.enabled)} onChange={(v) => patchAgent({ enabled: v })} label={t("s.agentEnabled")} />
        <Toggle checked={Boolean(agent?.consultOnWeb)} onChange={(v) => patchAgent({ consultOnWeb: v })} label={t("ai.consult")} />
      </Card>
      <SalesPersonaEditor key={shopData.shop.settings.sales.trainedAt ?? "p"} persona={shopData.shop.settings.sales} tone={agent?.tone ?? ""} onSaved={reloadShop} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Knowledge />
        <div className="space-y-4">
          <RagSettings />
          <Learn style={agent?.learnedStyle ?? ""} onSaved={reloadShop} save={(s) => patchAgent({ learnedStyle: s })} />
        </div>
      </div>
      <LandingEditor landing={shopData.shop.landing} onSaved={reloadShop} />
    </div>
  );
}

function Knowledge() {
  const { t } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<Entry[]>(`/shops/${shop.id}/knowledge`);
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [bulk, setBulk] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ title: string; content: string }[] | null>(null);
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold strong">
            <BookOpen className="size-4 text-[var(--accent)]" /> {t("ai.knowledge")}
          </h2>
          <p className="text-xs muted">{t("ai.knowledgeHint")}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setBulk(true)}>{t("a.add")} +</Button>
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
      <form
        className="relative"
        onSubmit={async (e) => {
          e.preventDefault();
          if (q) setHits(await api(`/shops/${shop.id}/knowledge/search?q=${encodeURIComponent(q)}`));
        }}
      >
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 muted" />
        <Input className="ps-9" placeholder={t("a.search")} value={q} onChange={(e) => (setQ(e.target.value), setHits(null))} />
      </form>
      {hits && (
        <div className="space-y-1 rounded-xl bg-gold/10 p-2 text-sm">
          {hits.length ? hits.map((h, i) => <p key={i}><b className="strong">{h.title}</b> · <span className="muted">{h.content.slice(0, 120)}</span></p>) : <p className="muted">—</p>}
        </div>
      )}
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <Empty icon={<BookOpen className="size-6" />} title="—" />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {data.map((e) => (
            <li key={e.id}>
              <button onClick={() => setEditing(e)} className="flex w-full items-start gap-3 py-2.5 text-start">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium strong">{e.title}</span>
                  <span className="block truncate text-xs muted">{e.content}</span>
                </span>
                <Badge tone={e.source === "dm_history" ? "gold" : "neutral"}>{e.source}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <EntryEditor entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), mutate())} />}
      {bulk && <BulkAdd onClose={() => setBulk(false)} onSaved={() => (setBulk(false), mutate())} />}
    </Card>
  );
}

function EntryEditor({ entry, onClose, onSaved }: { entry: Entry | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [title, setTitle] = useState(entry?.title ?? "");
  const [content, setContent] = useState(entry?.content ?? "");
  const [active, setActive] = useState(entry?.active ?? true);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    try {
      const body = { title, content, active, source: entry?.source ?? "manual" };
      if (entry) await api(`/shops/${shop.id}/knowledge/${entry.id}`, { method: "PUT", json: body });
      else await api(`/shops/${shop.id}/knowledge`, { method: "POST", json: body });
      onSaved();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open onClose={onClose} title={entry?.title ?? t("ai.knowledge")}>
      <div className="space-y-3">
        <Field label={t("fm.title")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("pr.desc")}>
          <Textarea className="min-h-40" value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
        <Toggle checked={active} onChange={setActive} label={t("a.active")} />
        <ErrorNote error={error} />
        <div className="flex justify-between">
          {entry ? (
            <Button variant="danger" onClick={async () => (await api(`/shops/${shop.id}/knowledge/${entry.id}`, { method: "DELETE" }), onSaved())}>
              <Trash2 className="size-4" />
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" disabled={!title || !content} onClick={save}>{t("a.save")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function BulkAdd({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [text, setText] = useState("");
  return (
    <Modal open onClose={onClose} title={t("ai.knowledge")}>
      <div className="space-y-3">
        <Field label={t("ai.bulk")}>
          <Textarea className="min-h-60" value={text} onChange={(e) => setText(e.target.value)} placeholder={"هزینه ارسال چقدره؟\nتهران ۹۰ هزار، شهرستان ۱۲۰ هزار تومان.\n\nمرجوعی دارید؟\nتا ۷ روز امکان تعویض هست."} />
        </Field>
        <Button variant="primary" className="w-full" disabled={text.length < 3} onClick={async () => (await api(`/shops/${shop.id}/knowledge/bulk`, { method: "POST", json: { text } }), onSaved())}>
          {t("a.save")}
        </Button>
      </div>
    </Modal>
  );
}

function Learn({ style, save, onSaved }: { style: string; save: (s: string) => Promise<void>; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [result, setResult] = useState<{ conversations: number; faqs: number } | null>(null);
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold strong">
        <Brain className="size-4 text-[var(--accent)]" /> {t("ai.learn")}
      </h2>
      <p className="text-xs muted">{t("ai.learnHint")}</p>
      <Button
        variant="primary"
        className="w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setResult(await api(`/shops/${shop.id}/knowledge/learn`, { method: "POST" }));
            onSaved();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Wand2 className="size-4" /> {t("ai.learn")}
      </Button>
      {result && <p className="text-xs text-success">✓ {result.conversations} / {result.faqs}</p>}
      <ErrorNote error={error} />
      <Field label={t("ai.learned")}>
        <Textarea className="min-h-40 text-xs" value={draft ?? style} onChange={(e) => setDraft(e.target.value)} />
      </Field>
      {draft !== null && draft !== style && (
        <Button size="sm" onClick={async () => (await save(draft), setDraft(null))}>{t("a.save")}</Button>
      )}
    </Card>
  );
}

function LandingEditor({ landing, onSaved }: { landing: Landing | null; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [l, setL] = useState<Landing>(landing ?? { headline: "", subheadline: "", highlights: [], faq: [], featuredCategorySlugs: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold strong">
          <LayoutTemplate className="size-4 text-[var(--accent)]" /> {t("ai.landing")}
        </h2>
        <div className="flex items-center gap-3">
          <a href={`/s/${shop.slug}`} target="_blank" className="whitespace-nowrap text-xs text-[var(--accent)]">{t("p.viewStore")}</a>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setL(await api<Landing>(`/shops/${shop.id}/landing/generate`, { method: "POST" }));
                onSaved();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Wand2 className="size-4" /> {t("ai.generate")}
          </Button>
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("ai.headline")}>
          <Input maxLength={80} value={l.headline} onChange={(e) => setL({ ...l, headline: e.target.value })} />
        </Field>
        <Field label={t("ai.subheadline")}>
          <Input maxLength={200} value={l.subheadline} onChange={(e) => setL({ ...l, subheadline: e.target.value })} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {l.highlights.map((h, i) => (
          <div key={i} className="space-y-1 rounded-xl bg-[var(--surface-sunken)] p-2">
            <Input value={h.title} onChange={(e) => setL({ ...l, highlights: l.highlights.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <Input value={h.text} onChange={(e) => setL({ ...l, highlights: l.highlights.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
          </div>
        ))}
      </div>
      {l.highlights.length < 4 && (
        <Button size="sm" variant="ghost" onClick={() => setL({ ...l, highlights: [...l.highlights, { title: "", text: "" }] })}>
          <Plus className="size-4" />
        </Button>
      )}
      <div className="space-y-2">
        <p className="label">{t("sf.faq")}</p>
        {l.faq.map((f, i) => (
          <div key={i} className="grid gap-1 rounded-xl bg-[var(--surface-sunken)] p-2 sm:grid-cols-2">
            <Input value={f.q} onChange={(e) => setL({ ...l, faq: l.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
            <Input value={f.a} onChange={(e) => setL({ ...l, faq: l.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
          </div>
        ))}
        {l.faq.length < 6 && (
          <Button size="sm" variant="ghost" onClick={() => setL({ ...l, faq: [...l.faq, { q: "", a: "" }] })}>
            <Plus className="size-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-success">✓ {t("s.saved")}</span>}
        <Button
          variant="primary"
          disabled={!l.headline}
          onClick={async () => {
            try {
              await api(`/shops/${shop.id}/landing`, {
                method: "PUT",
                json: { ...l, highlights: l.highlights.filter((h) => h.title && h.text), faq: l.faq.filter((f) => f.q && f.a) },
              });
              setSaved(true);
              onSaved();
            } catch (e) {
              setError(e);
            }
          }}
        >
          {t("a.save")}
        </Button>
      </div>
    </Card>
  );
}

const RAG_SOURCES = ["manual", "faq", "dm_history", "products", "comments"] as const;
type RagSource = (typeof RAG_SOURCES)[number];
interface Rag {
  enabled: boolean;
  topK: number;
  sources: Record<RagSource, boolean>;
  autoLearn: boolean;
  instructions: string;
  minRelevance: "any" | "balanced" | "high";
  preferManual: boolean;
  strict: boolean;
  snippetChars: number;
  lastRun: { at: string; products: number; comments: number; dms: number; error?: string } | null;
}

/** Retrieval settings: which sources the assistant may use, how much, and automatic rebuilding. */
function RagSettings() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data, mutate } = useApi<{ bySource: Record<string, number>; comments: number; rag: Rag }>(`/shops/${shop.id}/knowledge/stats`);
  const [draft, setDraft] = useState<Rag | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!data) return <Spinner />;
  const rag = draft ?? data.rag;
  const set = (patch: Partial<Rag>) => setDraft({ ...rag, ...patch });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { lastRun: _l, ...body } = rag;
      await api(`/shops/${shop.id}/settings`, { method: "PATCH", json: { rag: body } });
      setDraft(null);
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const rebuild = async () => {
    setError(null);
    try {
      await api(`/shops/${shop.id}/knowledge/autosetup`, { method: "POST" });
      setQueued(true);
      setTimeout(() => void mutate(), 4000);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Card className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold strong">
        <Database className="size-4 text-[var(--accent)]" /> {t("rag.title")}
      </h3>
      <p className="text-xs muted">{t("rag.sub")}</p>
      <Toggle checked={rag.enabled} onChange={(v) => set({ enabled: v })} label={t("rag.enabled")} />
      <div className="space-y-1.5">
        <span className="label">{t("rag.sources")}</span>
        {RAG_SOURCES.map((src) => (
          <label key={src} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={rag.sources[src]} disabled={!rag.enabled} onChange={(e) => set({ sources: { ...rag.sources, [src]: e.target.checked } })} />
              {t(`rag.src.${src}` as DictKey)}
            </span>
            <span className="num text-xs muted">{num(data.bySource[src] ?? 0, locale)}</span>
          </label>
        ))}
      </div>
      <Field label={t("rag.topK")}>
        <Input type="number" min={1} max={8} value={rag.topK} onChange={(e) => set({ topK: Math.min(8, Math.max(1, Number(e.target.value) || 1)) })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("rag.minRelevance")} hint={t("rag.minRelevanceHint")}>
          <Select value={rag.minRelevance} disabled={!rag.enabled} onChange={(e) => set({ minRelevance: e.target.value as Rag["minRelevance"] })}>
            {(["any", "balanced", "high"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`rag.rel.${v}` as DictKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("rag.snippetChars")} hint={t("rag.snippetCharsHint")}>
          <Input type="number" min={150} max={2000} step={50} disabled={!rag.enabled} value={rag.snippetChars} onChange={(e) => set({ snippetChars: Math.min(2000, Math.max(150, Number(e.target.value) || 600)) })} />
        </Field>
      </div>
      <Toggle checked={rag.preferManual} onChange={(v) => set({ preferManual: v })} label={t("rag.preferManual")} />
      <Toggle checked={rag.strict} onChange={(v) => set({ strict: v })} label={t("rag.strict")} />
      <Field label={t("rag.instructions")}>
        <Textarea rows={3} maxLength={2000} placeholder={t("rag.instructionsPh")} value={rag.instructions} onChange={(e) => set({ instructions: e.target.value })} />
      </Field>
      <Toggle checked={rag.autoLearn} onChange={(v) => set({ autoLearn: v })} label={t("rag.autoLearn")} />
      <div className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-xs muted">
        {data.rag.lastRun ? (
          <>
            {t("rag.lastRun")} {dateTime(data.rag.lastRun.at, locale)}: {t("rag.src.products")} {num(data.rag.lastRun.products, locale)} · {t("rag.src.comments")}{" "}
            {num(data.rag.lastRun.comments, locale)} · {t("rag.src.dm_history")} {num(data.rag.lastRun.dms, locale)}
            {data.rag.lastRun.error && <span className="mt-1 block text-warning" dir="ltr">{data.rag.lastRun.error}</span>}
          </>
        ) : (
          t("rag.never")
        )}
        <span className="mt-1 block">{t("rag.commentsStored")}: {num(data.comments, locale)}</span>
      </div>
      <ErrorNote error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={rebuild} disabled={queued}>
          <RefreshCw className="size-4" /> {queued ? t("rag.queued") : t("rag.rebuild")}
        </Button>
        <Button variant="primary" loading={busy} disabled={!draft} onClick={save}>
          {t("a.save")}
        </Button>
      </div>
    </Card>
  );
}
