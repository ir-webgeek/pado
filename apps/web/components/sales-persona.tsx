"use client";

import clsx from "clsx";
import { Eye, GraduationCap, Plus, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { DatePicker } from "@/components/date-picker";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Spinner, Textarea, Toggle } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

const TONES = ["friendly", "formal", "energetic", "luxury", "custom"] as const;
const STYLES = ["consultative", "soft", "direct"] as const;

export interface Persona {
  assistantName: string;
  tonePreset: (typeof TONES)[number];
  style: (typeof STYLES)[number];
  emoji: "none" | "few" | "many";
  length: "short" | "medium" | "detailed";
  address: "auto" | "formal" | "informal";
  register: "colloquial" | "written";
  language: "auto" | "fa" | "en";
  priceInChat: "show" | "link";
  askPhone: boolean;
  bannedWords: string[];
  promo: string;
  promoUntil: string;
  handoffKeywords: string[];
  upsell: boolean;
  followUp: boolean;
  scarcity: boolean;
  greeting: string;
  signOff: string;
  phrases: string[];
  objections: { objection: string; answer: string }[];
  examples: { customer: string; reply: string }[];
  trainedAt: string | null;
}
interface Proposal
  extends Omit<
    Persona,
    "assistantName" | "style" | "upsell" | "followUp" | "scarcity" | "trainedAt" | "address" | "register" | "language" | "priceInChat" | "askPhone" | "bannedWords" | "promo" | "promoUntil" | "handoffKeywords"
  > {
  toneDescription?: string;
  stats: { pairs: number; avgReplyLength: number; emojiShare: number };
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: (v: T) => string }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-[var(--surface-sunken)] p-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={clsx("rounded-full px-3 py-1.5 text-xs transition", value === o ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]" : "muted hover:text-[var(--text)]")}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

/** How the assistant sells: persona, tone, sales style and the shop's own voice, trainable from past chats. */
export function SalesPersonaEditor({ persona, tone, onSaved }: { persona: Persona; tone: string; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [p, setP] = useState<Persona>(persona);
  const [toneText, setToneText] = useState(tone);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [proposal, setProposal] = useState<{ source: "ai" | "history"; proposal: Proposal } | null>(null);
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<Persona>) => (setP({ ...p, ...patch }), setDirty(true), setSaved(false));

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const { trainedAt: _t, ...sales } = p;
      await api(`/shops/${shop.id}/settings`, { method: "PATCH", json: { sales: { ...sales, trainedAt: p.trainedAt }, agent: { tone: toneText } } });
      setDirty(false);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const train = async () => {
    setBusy("train");
    setError(null);
    try {
      setProposal(await api(`/shops/${shop.id}/agent/train-persona`, { method: "POST", json: { useAi: true } }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const apply = () => {
    if (!proposal) return;
    const x = proposal.proposal;
    set({
      tonePreset: x.tonePreset,
      emoji: x.emoji,
      length: x.length,
      greeting: x.greeting || p.greeting,
      signOff: x.signOff || p.signOff,
      phrases: x.phrases.length ? x.phrases : p.phrases,
      objections: x.objections.length ? x.objections : p.objections,
      examples: x.examples.length ? x.examples : p.examples,
      trainedAt: new Date().toISOString(),
    });
    if (x.toneDescription) setToneText(x.toneDescription);
    setProposal(null);
  };

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold strong">
            <UserRound className="size-4 text-[var(--accent)]" /> {t("sp.title")}
          </h3>
          <p className="mt-1 text-xs muted">{t("sp.sub")}</p>
          {p.trainedAt && <p className="mt-1 text-[11px] muted">{t("sp.trainedAt")} {dateTime(p.trainedAt, locale)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPreview(true)}>
            <Eye className="size-4" /> {t("sp.preview")}
          </Button>
          <Button size="sm" variant="primary" loading={busy === "train"} onClick={train}>
            <GraduationCap className="size-4" /> {t("sp.train")}
          </Button>
        </div>
      </div>

      {proposal && (
        <div className="space-y-3 rounded-2xl border border-gold/40 bg-gold/5 p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold strong">
            {t("sp.proposal")} <Badge tone="neutral">{t(proposal.source === "ai" ? "sp.src.ai" : "sp.src.history")}</Badge>
            <span className="text-xs font-normal muted">
              {num(proposal.proposal.stats.pairs, locale)} {t("sp.pairs")}
            </span>
          </p>
          {proposal.proposal.stats.pairs === 0 ? (
            <p className="text-sm muted">{t("sp.noHistory")}</p>
          ) : (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <Row k={t("sp.tone")} v={t(`sp.tone.${proposal.proposal.tonePreset}` as DictKey)} />
              <Row k={t("sp.emoji")} v={t(`sp.emoji.${proposal.proposal.emoji}` as DictKey)} />
              <Row k={t("sp.length")} v={t(`sp.length.${proposal.proposal.length}` as DictKey)} />
              <Row k={t("sp.greeting")} v={proposal.proposal.greeting || "-"} />
              <Row k={t("sp.signOff")} v={proposal.proposal.signOff || "-"} />
              <Row k={t("sp.phrases")} v={proposal.proposal.phrases.join("، ") || "-"} />
              <Row k={t("sp.objections")} v={num(proposal.proposal.objections.length, locale)} />
              <Row k={t("sp.examples")} v={num(proposal.proposal.examples.length, locale)} />
              {proposal.proposal.toneDescription && <Row k={t("sp.toneText")} v={proposal.proposal.toneDescription} />}
            </dl>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
              {t("a.cancel")}
            </Button>
            <Button size="sm" variant="primary" disabled={proposal.proposal.stats.pairs === 0} onClick={apply}>
              {t("sp.apply")}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("sp.name")} hint={t("sp.nameHint")}>
          <Input value={p.assistantName} maxLength={60} onChange={(e) => set({ assistantName: e.target.value })} />
        </Field>
        <div>
          <span className="label">{t("sp.tone")}</span>
          <Segmented value={p.tonePreset} options={TONES} onChange={(v) => set({ tonePreset: v })} label={(v) => t(`sp.tone.${v}` as DictKey)} />
        </div>
      </div>
      <Field label={t("sp.toneText")} hint={p.tonePreset === "custom" ? t("sp.toneCustomHint") : t("sp.toneExtraHint")}>
        <Textarea rows={2} maxLength={400} value={toneText} onChange={(e) => (setToneText(e.target.value), setDirty(true))} />
      </Field>

      <div>
        <span className="label">{t("sp.style")}</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {STYLES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={p.style === s}
              onClick={() => set({ style: s })}
              className={clsx("rounded-2xl border p-3 text-start transition", p.style === s ? "border-gold/60 bg-gold/10" : "border-[var(--border)] hover:bg-[var(--surface-sunken)]")}
            >
              <p className="text-sm font-semibold strong">{t(`sp.style.${s}` as DictKey)}</p>
              <p className="mt-1 text-[11px] muted">{t(`sp.style.${s}.s` as DictKey)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <div>
          <span className="label">{t("sp.emoji")}</span>
          <Segmented value={p.emoji} options={["none", "few", "many"] as const} onChange={(v) => set({ emoji: v })} label={(v) => t(`sp.emoji.${v}` as DictKey)} />
        </div>
        <div>
          <span className="label">{t("sp.length")}</span>
          <Segmented value={p.length} options={["short", "medium", "detailed"] as const} onChange={(v) => set({ length: v })} label={(v) => t(`sp.length.${v}` as DictKey)} />
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-[var(--border)] p-4">
        <p className="text-sm font-semibold strong">{t("sp.controls")}</p>
        <div className="flex flex-wrap gap-6">
          <div>
            <span className="label">{t("sp.language")}</span>
            <Segmented value={p.language} options={["auto", "fa", "en"] as const} onChange={(v) => set({ language: v })} label={(v) => t(`sp.language.${v}` as DictKey)} />
          </div>
          {p.language !== "en" && (
            <>
              <div>
                <span className="label">{t("sp.address")}</span>
                <Segmented value={p.address} options={["auto", "formal", "informal"] as const} onChange={(v) => set({ address: v })} label={(v) => t(`sp.address.${v}` as DictKey)} />
              </div>
              <div>
                <span className="label">{t("sp.register")}</span>
                <Segmented value={p.register} options={["colloquial", "written"] as const} onChange={(v) => set({ register: v })} label={(v) => t(`sp.register.${v}` as DictKey)} />
              </div>
            </>
          )}
          <div>
            <span className="label">{t("sp.priceInChat")}</span>
            <Segmented value={p.priceInChat} options={["show", "link"] as const} onChange={(v) => set({ priceInChat: v })} label={(v) => t(`sp.priceInChat.${v}` as DictKey)} />
          </div>
        </div>
        <Toggle checked={p.askPhone} onChange={(v) => set({ askPhone: v })} label={t("sp.askPhone")} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("sp.bannedWords")} hint={t("sp.listHint")}>
            <ListInput value={p.bannedWords} max={30} onChange={(bannedWords) => set({ bannedWords })} placeholder="ارزون، تخفیف ویژه" />
          </Field>
          <Field label={t("sp.handoffKeywords")} hint={t("sp.handoffKeywordsHint")}>
            <ListInput value={p.handoffKeywords} max={30} onChange={(handoffKeywords) => set({ handoffKeywords })} placeholder="مرجوعی، شکایت، عمده" />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <Field label={t("sp.promo")} hint={t("sp.promoHint")}>
            <Input value={p.promo} maxLength={300} placeholder="۲۰٪ تخفیف همه کت‌ها تا آخر هفته" onChange={(e) => set({ promo: e.target.value })} />
          </Field>
          <div>
            <span className="label">{t("sp.promoUntil")}</span>
            <div className="flex items-center gap-1">
              <DatePicker value={p.promoUntil} onChange={(promoUntil) => set({ promoUntil })} className="flex-1" />
              {p.promoUntil && (
                <button type="button" onClick={() => set({ promoUntil: "" })} className="rounded-full p-1.5 muted hover:text-danger" aria-label={t("sp.noEnd")}>
                  <X className="size-4" />
                </button>
              )}
            </div>
            {!p.promoUntil && <span className="mt-1 block text-xs muted">{t("sp.noEnd")}</span>}
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Toggle checked={p.upsell} onChange={(v) => set({ upsell: v })} label={t("sp.upsell")} />
        <Toggle checked={p.followUp} onChange={(v) => set({ followUp: v })} label={t("sp.followUp")} />
        <Toggle checked={p.scarcity} onChange={(v) => set({ scarcity: v })} label={t("sp.scarcity")} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("sp.greeting")}>
          <Input value={p.greeting} maxLength={200} placeholder="سلام عزیزم 🌸" onChange={(e) => set({ greeting: e.target.value })} />
        </Field>
        <Field label={t("sp.signOff")}>
          <Input value={p.signOff} maxLength={200} placeholder="ممنون از انتخابت 💛" onChange={(e) => set({ signOff: e.target.value })} />
        </Field>
      </div>
      <Field label={t("sp.phrases")} hint={t("sp.phrasesHint")}>
        <ListInput value={p.phrases} max={12} onChange={(phrases) => set({ phrases })} />
      </Field>

      <PairList
        title={t("sp.objections")}
        hint={t("sp.objectionsHint")}
        items={p.objections.map((o) => ({ a: o.objection, b: o.answer }))}
        labels={[t("sp.objection"), t("sp.answer")]}
        max={10}
        onChange={(items) => set({ objections: items.map((x) => ({ objection: x.a, answer: x.b })) })}
      />
      <PairList
        title={t("sp.examples")}
        hint={t("sp.examplesHint")}
        items={p.examples.map((e) => ({ a: e.customer, b: e.reply }))}
        labels={[t("sp.customer"), t("sp.reply")]}
        max={8}
        onChange={(items) => set({ examples: items.map((x) => ({ customer: x.a, reply: x.b })) })}
      />

      <ErrorNote error={error} />
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-success">✓ {t("s.saved")}</span>}
        <Button variant="primary" loading={busy === "save"} disabled={!dirty} onClick={save}>
          {t("a.save")}
        </Button>
      </div>
      {preview && <PromptPreview onClose={() => setPreview(false)} />}
    </Card>
  );
}

/** Comma-separated list (Persian or Latin comma). Parsed on blur so typing a separator is not swallowed. */
function ListInput({ value, onChange, max, placeholder }: { value: string[]; onChange: (v: string[]) => void; max: number; placeholder?: string }) {
  const [text, setText] = useState(value.join("، "));
  useEffect(() => setText(value.join("، ")), [value]);
  const commit = () =>
    onChange(
      text
        .split(/[،,\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, max),
    );
  return <Input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 muted">{k}:</dt>
      <dd className="strong">{v}</dd>
    </div>
  );
}

function PairList({
  title,
  hint,
  items,
  labels,
  max,
  onChange,
}: {
  title: string;
  hint: string;
  items: { a: string; b: string }[];
  labels: [string, string];
  max: number;
  onChange: (items: { a: string; b: string }[]) => void;
}) {
  const { t } = useI18n();
  const update = (i: number, patch: Partial<{ a: string; b: string }>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="label !mb-0">{title}</span>
          <p className="text-[11px] muted">{hint}</p>
        </div>
        <Button size="sm" disabled={items.length >= max} onClick={() => onChange([...items, { a: "", b: "" }])}>
          <Plus className="size-4" /> {t("a.add")}
        </Button>
      </div>
      {items.map((x, i) => (
        <div key={i} className="grid gap-2 rounded-2xl bg-[var(--surface-sunken)] p-2 sm:grid-cols-[1fr_1.4fr_auto]">
          <Input aria-label={labels[0]} placeholder={labels[0]} value={x.a} maxLength={400} onChange={(e) => update(i, { a: e.target.value })} />
          <Textarea aria-label={labels[1]} placeholder={labels[1]} rows={2} value={x.b} maxLength={800} onChange={(e) => update(i, { b: e.target.value })} />
          <button type="button" aria-label="remove" className="self-center px-2 muted hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function PromptPreview({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const { data } = useApi<{ prompt: string }>(`/shops/${shop.id}/agent/prompt?channel=instagram`);
  return (
    <Modal open onClose={onClose} title={t("sp.preview")}>
      <p className="mb-2 text-xs muted">{t("sp.previewHint")}</p>
      {!data ? <Spinner /> : <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--surface-sunken)] p-3 text-xs leading-6" dir="auto">{data.prompt}</pre>}
    </Modal>
  );
}
