"use client";

import clsx from "clsx";
import { Clock, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { hhmmToMinutes, minutesToHHMM } from "@shopino/shared";
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, Toggle } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { latinDigits, money, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import type { Hours, Service, Staff } from "@/lib/types";

const COLORS = ["#d9d0b8", "#c4b894", "#aebbd0", "#778da9", "#52b4fd", "#2dbf80", "#ef9736", "#f86d77"];
// Iranian week order: Saturday first
const WEEK = [6, 0, 1, 2, 3, 4, 5];

export default function ServicesPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [tab, setTab] = useState<"services" | "staff">("services");
  const { data: services, mutate: reloadServices } = useApi<Service[]>(`/shops/${shop.id}/services`);
  const { data: staff, mutate: reloadStaff } = useApi<Staff[]>(`/shops/${shop.id}/staff`);
  const [editService, setEditService] = useState<Service | "new" | null>(null);
  const [editStaff, setEditStaff] = useState<Staff | "new" | null>(null);

  return (
    <div>
      <PageHeader
        title={t("p.services")}
        actions={
          tab === "services" ? (
            <Button variant="primary" onClick={() => setEditService("new")}>
              <Plus className="size-4" /> {t("sv.new")}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setEditStaff("new")}>
              <UserPlus className="size-4" /> {t("st.new")}
            </Button>
          )
        }
      />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "services", label: t("sv.services"), count: services?.filter((s) => s.active).length },
            { value: "staff", label: t("sv.staff"), count: staff?.length },
          ]}
        />
      </div>

      {tab === "services" ? (
        !services || !staff ? (
          <Spinner />
        ) : services.filter((s) => s.active).length === 0 ? (
          <Card>
            <Empty icon={<Clock className="size-6" />} title={t("sv.new")} />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {services
              .filter((s) => s.active)
              .map((s) => (
                <button key={s.id} onClick={() => setEditService(s)} className="card flex gap-3 p-4 text-start transition hover:border-gold/40">
                  <span className="w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold strong">{s.name}</span>
                      <span className="num shrink-0 text-sm strong">
                        {s.priceFrom && <span className="text-xs muted">{t("sv.priceFrom")} </span>}
                        {money(s.price, locale)}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge>
                        <Clock className="size-3" /> {num(s.durationMin, locale)} {t("ap.minutes")}
                      </Badge>
                      {s.deposit.type !== "none" && (
                        <Badge tone="gold">
                          {t("ap.deposit")} {s.deposit.type === "percent" ? `${num(s.deposit.value, locale)}٪` : money(s.deposit.value, locale)}
                        </Badge>
                      )}
                      {s.capacity > 1 && (
                        <Badge tone="info">
                          <Users className="size-3" /> {num(s.capacity, locale)}
                        </Badge>
                      )}
                      {!s.onlineBookable && <Badge tone="warning">offline</Badge>}
                      {s.requiresApproval && <Badge tone="warning">{t("sv.approval")}</Badge>}
                    </span>
                    <span className="flex -space-x-2 rtl:space-x-reverse">
                      {staff
                        .filter((st) => s.staffIds.includes(st.id))
                        .map((st) => (
                          <span key={st.id} className="rounded-full ring-2 ring-[var(--surface-strong)]">
                            <Avatar name={st.name} color={st.color} size={24} />
                          </span>
                        ))}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        )
      ) : !staff ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {staff.map((s) => (
            <button key={s.id} onClick={() => setEditStaff(s)} className={clsx("card p-4 text-start transition hover:border-gold/40", !s.active && "opacity-50")}>
              <div className="flex items-center gap-3">
                <Avatar name={s.name} color={s.color} size={42} />
                <div>
                  <p className="font-semibold strong">{s.name}</p>
                  <p className="text-xs muted">{s.title}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px]">
                {WEEK.map((wd) => {
                  const h = s.workingHours.filter((x) => x.weekday === wd);
                  return (
                    <div key={wd} className={clsx("rounded-md py-1.5", h.length ? "bg-gold/15 text-[var(--accent)]" : "bg-[var(--surface-sunken)] muted")}>
                      {t(`wd.${wd}` as DictKey).slice(0, locale === "fa" ? 1 : 2)}
                    </div>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      )}

      {editService && staff && (
        <ServiceEditor service={editService === "new" ? null : editService} staff={staff} onClose={() => setEditService(null)} onSaved={() => (setEditService(null), reloadServices())} />
      )}
      {editStaff && <StaffEditor member={editStaff === "new" ? null : editStaff} onClose={() => setEditStaff(null)} onSaved={() => (setEditStaff(null), reloadStaff())} />}
    </div>
  );
}

function ServiceEditor({ service, staff, onClose, onSaved }: { service: Service | null; staff: Staff[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [f, setF] = useState({
    name: service?.name ?? "",
    description: service?.description ?? "",
    durationMin: String(service?.durationMin ?? 60),
    bufferBeforeMin: String(service?.bufferBeforeMin ?? 0),
    bufferAfterMin: String(service?.bufferAfterMin ?? 10),
    price: String(service?.price ?? ""),
    priceFrom: service?.priceFrom ?? false,
    depositType: service?.deposit.type ?? "none",
    depositValue: String(service?.deposit.value ?? 0),
    capacity: String(service?.capacity ?? 1),
    onlineBookable: service?.onlineBookable ?? true,
    requiresApproval: service?.requiresApproval ?? false,
    color: service?.color ?? COLORS[0]!,
    staffIds: service?.staffIds ?? staff.map((s) => s.id),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const n = (s: string) => Number(latinDigits(s) || 0);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name: f.name,
      description: f.description,
      durationMin: n(f.durationMin),
      bufferBeforeMin: n(f.bufferBeforeMin),
      bufferAfterMin: n(f.bufferAfterMin),
      price: n(f.price),
      priceFrom: f.priceFrom,
      deposit: { type: f.depositType, value: n(f.depositValue) },
      capacity: Math.max(1, n(f.capacity)),
      onlineBookable: f.onlineBookable,
      requiresApproval: f.requiresApproval,
      color: f.color,
      staffIds: f.staffIds,
    };
    try {
      if (service) await api(`/shops/${shop.id}/services/${service.id}`, { method: "PUT", json: body });
      else await api(`/shops/${shop.id}/services`, { method: "POST", json: body });
      onSaved();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={service?.name ?? t("sv.new")} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("sv.name")}>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label={t("sv.price")}>
            <Input inputMode="numeric" value={f.price} onChange={(e) => set("price", e.target.value)} />
          </Field>
        </div>
        <Field label={t("pr.desc")}>
          <Textarea className="min-h-16" value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t("sv.duration")}>
            <Input inputMode="numeric" value={f.durationMin} onChange={(e) => set("durationMin", e.target.value)} />
          </Field>
          <Field label={t("sv.bufferBefore")}>
            <Input inputMode="numeric" value={f.bufferBeforeMin} onChange={(e) => set("bufferBeforeMin", e.target.value)} />
          </Field>
          <Field label={t("sv.bufferAfter")}>
            <Input inputMode="numeric" value={f.bufferAfterMin} onChange={(e) => set("bufferAfterMin", e.target.value)} />
          </Field>
          <Field label={t("sv.capacity")}>
            <Input inputMode="numeric" value={f.capacity} onChange={(e) => set("capacity", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("sv.depositType")}>
            <Select value={f.depositType} onChange={(e) => set("depositType", e.target.value as "none")}>
              {(["none", "fixed", "percent"] as const).map((d) => (
                <option key={d} value={d}>{t(`sv.deposit.${d}`)}</option>
              ))}
            </Select>
          </Field>
          {f.depositType !== "none" && (
            <Field label={f.depositType === "percent" ? "%" : t("sv.price")}>
              <Input inputMode="numeric" value={f.depositValue} onChange={(e) => set("depositValue", e.target.value)} />
            </Field>
          )}
        </div>
        <div>
          <p className="label">{t("sv.whoOffers")}</p>
          <div className="flex flex-wrap gap-2">
            {staff.map((s) => {
              const on = f.staffIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => set("staffIds", on ? f.staffIds.filter((x) => x !== s.id) : [...f.staffIds, s.id])}
                  className={clsx("flex items-center gap-2 rounded-full border py-1 pe-3 ps-1 text-sm", on ? "border-gold/60 bg-gold/10 strong" : "border-[var(--border)] muted")}
                >
                  <Avatar name={s.name} color={s.color} size={24} /> {s.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button key={c} onClick={() => set("color", c)} className={clsx("size-7 rounded-full", f.color === c && "ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--bg-elev)]")} style={{ background: c }} />
          ))}
        </div>
        <div className="rounded-xl bg-[var(--surface-sunken)] px-3 py-1">
          <Toggle checked={f.onlineBookable} onChange={(v) => set("onlineBookable", v)} label={t("sv.online")} />
          <Toggle checked={f.requiresApproval} onChange={(v) => set("requiresApproval", v)} label={t("sv.approval")} />
          <Toggle checked={f.priceFrom} onChange={(v) => set("priceFrom", v)} label={t("sv.priceFrom")} />
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-between gap-2">
          {service ? (
            <Button variant="danger" onClick={async () => (await api(`/shops/${shop.id}/services/${service.id}`, { method: "DELETE" }), onSaved())}>
              <Trash2 className="size-4" />
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>{t("a.cancel")}</Button>
            <Button variant="primary" loading={busy} disabled={!f.name || !f.price} onClick={save}>
              {t("a.save")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function StaffEditor({ member, onClose, onSaved }: { member: Staff | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [name, setName] = useState(member?.name ?? "");
  const [title, setTitle] = useState(member?.title ?? "");
  const [color, setColor] = useState(member?.color ?? COLORS[1]!);
  const [active, setActive] = useState(member?.active ?? true);
  const [hours, setHours] = useState<Hours[]>(
    member?.workingHours ?? [6, 0, 1, 2, 3].flatMap((wd) => [{ weekday: wd, startMin: 600, endMin: 1200 }]),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = (idx: number, patch: Partial<Hours>) => setHours((hs) => hs.map((h, i) => (i === idx ? { ...h, ...patch } : h)));

  async function save() {
    setBusy(true);
    setError(null);
    const body = { name, title, color, active, workingHours: hours.filter((h) => h.endMin > h.startMin) };
    try {
      if (member) await api(`/shops/${shop.id}/staff/${member.id}`, { method: "PUT", json: body });
      else await api(`/shops/${shop.id}/staff`, { method: "POST", json: body });
      onSaved();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={member?.name ?? t("st.new")} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("st.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("st.title")}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={clsx("size-7 rounded-full", color === c && "ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--bg-elev)]")} style={{ background: c }} />
          ))}
        </div>
        <div>
          <p className="label">{t("st.hours")}</p>
          <div className="space-y-1.5">
            {WEEK.map((wd) => {
              const rows = hours.map((h, i) => ({ h, i })).filter((x) => x.h.weekday === wd);
              return (
                <div key={wd} className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--surface-sunken)] px-3 py-2">
                  <span className="w-20 text-sm font-medium strong">{t(`wd.${wd}` as DictKey)}</span>
                  {rows.length === 0 && <span className="text-xs muted">{t("ap.closed")}</span>}
                  {rows.map(({ h, i }) => (
                    <span key={i} className="flex items-center gap-1">
                      <input type="time" className="input !w-28 !py-1 text-sm" value={minutesToHHMM(h.startMin)} onChange={(e) => update(i, { startMin: hhmmToMinutes(e.target.value) })} />
                      <span className="muted">–</span>
                      <input type="time" className="input !w-28 !py-1 text-sm" value={minutesToHHMM(Math.min(h.endMin, 1439))} onChange={(e) => update(i, { endMin: hhmmToMinutes(e.target.value) })} />
                      <button className="p-1 muted hover:text-danger" onClick={() => setHours((hs) => hs.filter((_, j) => j !== i))}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  ))}
                  <button className="ms-auto text-xs text-[var(--accent)]" onClick={() => setHours((hs) => [...hs, { weekday: wd, startMin: 600, endMin: 1080 }])}>
                    + {t("st.addShift")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <Toggle checked={active} onChange={setActive} label="Active" />
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("a.cancel")}</Button>
          <Button variant="primary" loading={busy} disabled={!name} onClick={save}>
            {t("a.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
