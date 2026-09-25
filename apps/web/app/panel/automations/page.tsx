"use client";

import clsx from "clsx";
import { AtSign, ClipboardList, Film, Image as ImageIcon, Link2, MessageSquareReply, Mic, Plus, Sparkles, Trash2, Type, Zap } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle } from "@/components/ui";
import { UploadButton } from "@/components/upload";
import { api, useApi } from "@/lib/api";
import { num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

type Msg =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; caption?: string }
  | { kind: "audio"; url: string }
  | { kind: "video"; url: string }
  | { kind: "buttons"; text: string; buttons: { title: string; url: string }[] }
  | { kind: "form"; formId: string; text: string };

interface Rule {
  id: string;
  name: string;
  trigger: Trigger;
  mediaId: string | null;
  keywords: string[];
  matchMode: "contains" | "exact" | "any";
  publicReply: string | null;
  privateReply: string | null;
  messages: Msg[];
  thenMode: "keep" | "agent" | "human";
  priority: number;
  active: boolean;
  hits: number;
}
type Trigger = "comment" | "story_reply" | "story_mention" | "dm_keyword" | "first_message";
const TRIGGERS: Trigger[] = ["comment", "story_reply", "story_mention", "dm_keyword", "first_message"];
const triggerIcon: Record<Trigger, typeof Zap> = { comment: MessageSquareReply, story_reply: Film, story_mention: AtSign, dm_keyword: Type, first_message: Sparkles };

export default function AutomationsPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data: rules, mutate } = useApi<Rule[]>(`/shops/${shop.id}/automations`);
  const [editing, setEditing] = useState<Rule | "new" | null>(null);

  return (
    <div>
      <PageHeader
        title={t("p.automations")}
        subtitle={t("au.free")}
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t("au.new")}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          {!rules ? (
            <Spinner />
          ) : rules.length === 0 ? (
            <Card>
              <Empty icon={<Zap className="size-6" />} title={t("au.new")} />
            </Card>
          ) : (
            <div className="space-y-2">
              {rules.map((r) => {
                const Icon = triggerIcon[r.trigger];
                return (
                  <button key={r.id} onClick={() => setEditing(r)} className={clsx("card flex w-full items-start gap-3 p-4 text-start transition hover:border-gold/40", !r.active && "opacity-50")}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-[var(--accent)]">
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold strong">{r.name}</span>
                        <Badge>{t(`au.tr.${r.trigger}` as DictKey)}</Badge>
                        {r.thenMode !== "keep" && <Badge tone={r.thenMode === "agent" ? "gold" : "info"}>{t(`au.then.${r.thenMode}` as DictKey)}</Badge>}
                      </span>
                      <span className="mt-1 block truncate text-xs muted">
                        {r.matchMode === "any" ? t("au.m.any") : r.keywords.join("، ")}
                        {" · "}
                        {r.messages.map((m) => t(`au.add.${m.kind}` as DictKey)).join(" + ") || r.privateReply}
                      </span>
                    </span>
                    <span className="num text-xs muted">
                      {num(r.hits, locale)} {t("au.hits")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Tester />
      </div>
      {editing && <RuleEditor rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), mutate())} />}
    </div>
  );
}

function Tester() {
  const { t } = useI18n();
  const { shop } = useShop();
  const [trigger, setTrigger] = useState<Trigger>("comment");
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ matched: boolean; rule?: { name: string }; publicReply?: string; privateReply?: string; messages?: string[] } | null>(null);
  return (
    <Card className="h-fit space-y-3">
      <h3 className="font-semibold strong">{t("au.test")}</h3>
      <Select value={trigger} onChange={(e) => setTrigger(e.target.value as Trigger)}>
        {TRIGGERS.map((tr) => (
          <option key={tr} value={tr}>{t(`au.tr.${tr}` as DictKey)}</option>
        ))}
      </Select>
      <Input placeholder={t("au.testText")} value={text} onChange={(e) => setText(e.target.value)} />
      <Button className="w-full" onClick={async () => setResult(await api(`/shops/${shop.id}/automations/test`, { method: "POST", json: { trigger, text } }))}>
        {t("au.test")}
      </Button>
      {result &&
        (result.matched ? (
          <div className="space-y-2 text-sm">
            <Badge tone="success">{result.rule?.name}</Badge>
            {result.publicReply && <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2">💬 {result.publicReply}</p>}
            {result.privateReply && <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2">✉️ {result.privateReply}</p>}
            {result.messages?.map((m, i) => (
              <p key={i} className="whitespace-pre-wrap rounded-xl bg-gold/10 px-3 py-2">{m}</p>
            ))}
          </div>
        ) : (
          <p className="text-sm muted">{t("au.noMatch")}</p>
        ))}
    </Card>
  );
}

function RuleEditor({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const { data: forms } = useApi<{ id: string; title: string; active: boolean }[]>(`/shops/${shop.id}/forms`);
  const [f, setF] = useState({
    name: rule?.name ?? "",
    trigger: rule?.trigger ?? ("comment" as Trigger),
    mediaId: rule?.mediaId ?? "",
    keywords: rule?.keywords.join("، ") ?? "",
    matchMode: rule?.matchMode ?? "contains",
    publicReply: rule?.publicReply ?? "",
    privateReply: rule?.privateReply ?? "",
    thenMode: rule?.thenMode ?? "keep",
    priority: rule?.priority ?? 0,
    active: rule?.active ?? true,
  });
  const [msgs, setMsgs] = useState<Msg[]>(rule?.messages ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const upd = (i: number, m: Msg) => setMsgs((ms) => ms.map((x, j) => (j === i ? m : x)));

  const blank = (kind: Msg["kind"]): Msg =>
    kind === "text"
      ? { kind, text: "" }
      : kind === "buttons"
        ? { kind, text: "", buttons: [{ title: "", url: "" }] }
        : kind === "form"
          ? { kind, formId: forms?.find((x) => x.active)?.id ?? "", text: "" }
          : kind === "image"
            ? { kind, url: "", caption: "" }
            : { kind, url: "" };

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      ...f,
      mediaId: f.mediaId || null,
      keywords: f.keywords.split(/[,،\n]/).map((k) => k.trim()).filter(Boolean),
      publicReply: f.trigger === "comment" && f.publicReply ? f.publicReply : null,
      privateReply: f.trigger === "comment" && f.privateReply ? f.privateReply : null,
      messages: msgs.map((m) => (m.kind === "image" && !m.caption ? { kind: m.kind, url: m.url } : m)),
    };
    try {
      if (rule) await api(`/shops/${shop.id}/automations/${rule.id}`, { method: "PUT", json: body });
      else await api(`/shops/${shop.id}/automations`, { method: "POST", json: body });
      onSaved();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const kinds: { k: Msg["kind"]; icon: typeof Type }[] = [
    { k: "text", icon: Type },
    { k: "image", icon: ImageIcon },
    { k: "audio", icon: Mic },
    { k: "video", icon: Film },
    { k: "buttons", icon: Link2 },
    { k: "form", icon: ClipboardList },
  ];

  return (
    <Modal open onClose={onClose} title={rule?.name ?? t("au.new")} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("au.name")}>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label={t("au.trigger")}>
            <Select value={f.trigger} onChange={(e) => set("trigger", e.target.value as Trigger)}>
              {TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>{t(`au.tr.${tr}` as DictKey)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("au.match")}>
            <Select value={f.matchMode} onChange={(e) => set("matchMode", e.target.value as "contains")}>
              {(["contains", "exact", "any"] as const).map((m) => (
                <option key={m} value={m}>{t(`au.m.${m}`)}</option>
              ))}
            </Select>
          </Field>
          {f.matchMode !== "any" && (
            <Field label={t("au.keywords")} className="sm:col-span-2">
              <Input value={f.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="قیمت، price، چند" />
            </Field>
          )}
        </div>
        {(f.trigger === "comment" || f.trigger === "story_reply") && (
          <Field label={t("au.mediaId")}>
            <Input dir="ltr" value={f.mediaId} onChange={(e) => set("mediaId", e.target.value)} />
          </Field>
        )}
        {f.trigger === "comment" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("au.publicReply")}>
              <Textarea className="min-h-16" value={f.publicReply} onChange={(e) => set("publicReply", e.target.value)} />
            </Field>
            <Field label={t("au.privateReply")}>
              <Textarea className="min-h-16" value={f.privateReply} onChange={(e) => set("privateReply", e.target.value)} />
            </Field>
          </div>
        )}

        <div>
          <p className="label">{t("au.messages")}</p>
          {f.trigger === "comment" && <p className="-mt-1 mb-2 text-xs muted">{t("au.followupHint")}</p>}
          <div className="space-y-2">
            {msgs.map((m, i) => (
              <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Badge tone="gold">{t(`au.add.${m.kind}` as DictKey)}</Badge>
                  <button className="p-1 muted hover:text-danger" onClick={() => setMsgs((ms) => ms.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {m.kind === "text" && <Textarea className="min-h-16" value={m.text} onChange={(e) => upd(i, { ...m, text: e.target.value })} />}
                {(m.kind === "image" || m.kind === "audio" || m.kind === "video") && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input dir="ltr" placeholder={t("au.url")} value={m.url} onChange={(e) => upd(i, { ...m, url: e.target.value })} />
                      <UploadButton label={t("au.upload")} accept={m.kind === "image" ? "image/*" : m.kind === "audio" ? "audio/*" : "video/*"} onUploaded={(url) => upd(i, { ...m, url })} />
                    </div>
                    {m.kind === "image" && <Input placeholder={t("au.caption")} value={m.caption ?? ""} onChange={(e) => upd(i, { ...m, caption: e.target.value })} />}
                    {m.kind === "audio" && m.url && <audio controls src={m.url} className="w-full" />}
                  </div>
                )}
                {m.kind === "buttons" && (
                  <div className="space-y-2">
                    <Input value={m.text} placeholder={t("au.add.text")} onChange={(e) => upd(i, { ...m, text: e.target.value })} />
                    {m.buttons.map((b, bi) => (
                      <div key={bi} className="flex gap-2">
                        <Input className="!w-40" placeholder={t("au.buttonTitle")} maxLength={20} value={b.title} onChange={(e) => upd(i, { ...m, buttons: m.buttons.map((x, j) => (j === bi ? { ...x, title: e.target.value } : x)) })} />
                        <Input dir="ltr" placeholder="https://" value={b.url} onChange={(e) => upd(i, { ...m, buttons: m.buttons.map((x, j) => (j === bi ? { ...x, url: e.target.value } : x)) })} />
                      </div>
                    ))}
                    {m.buttons.length < 3 && (
                      <button className="text-xs text-[var(--accent)]" onClick={() => upd(i, { ...m, buttons: [...m.buttons, { title: "", url: "" }] })}>
                        + {t("au.buttonTitle")}
                      </button>
                    )}
                  </div>
                )}
                {m.kind === "form" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select value={m.formId} onChange={(e) => upd(i, { ...m, formId: e.target.value })}>
                      {(forms ?? []).filter((x) => x.active).map((x) => (
                        <option key={x.id} value={x.id}>{x.title}</option>
                      ))}
                    </Select>
                    <Input placeholder={t("au.add.text")} value={m.text} onChange={(e) => upd(i, { ...m, text: e.target.value })} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {kinds.map(({ k, icon: Icon }) => (
              <button key={k} disabled={k === "form" && !forms?.length} onClick={() => setMsgs((ms) => [...ms, blank(k)])} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--surface-sunken)] disabled:opacity-40">
                <Icon className="size-3.5" /> {t(`au.add.${k}` as DictKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("au.then")}>
            <Select value={f.thenMode} onChange={(e) => set("thenMode", e.target.value as "keep")}>
              {(["keep", "agent", "human"] as const).map((m) => (
                <option key={m} value={m}>{t(`au.then.${m}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("au.priority")}>
            <Input type="number" min={0} max={100} value={f.priority} onChange={(e) => set("priority", Number(e.target.value))} />
          </Field>
        </div>
        <Toggle checked={f.active} onChange={(v) => set("active", v)} label={t("a.active")} />
        <ErrorNote error={error} />
        <div className="flex justify-between gap-2">
          {rule ? (
            <Button variant="danger" onClick={async () => (await api(`/shops/${shop.id}/automations/${rule.id}`, { method: "DELETE" }), onSaved())}>
              <Trash2 className="size-4" />
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>{t("a.cancel")}</Button>
            <Button variant="primary" loading={busy} disabled={!f.name} onClick={save}>
              {t("a.save")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
