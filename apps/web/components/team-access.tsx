"use client";

import { PERMISSION_SECTIONS, type PermissionLevel, type PermissionSection, type Permissions } from "@shopino/shared";
import clsx from "clsx";
import { Pencil, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";

interface Member {
  id: string;
  role: "owner" | "admin" | "staff" | "viewer";
  customRoleId: string | null;
  userId: string;
  phone: string;
  name: string | null;
}
interface Role {
  id: string;
  name: string;
  permissions: Partial<Permissions>;
}
interface RolesResp {
  roles: Role[];
  builtin: Record<Member["role"], Permissions>;
}

const LEVELS: PermissionLevel[] = ["none", "view", "edit"];
const BASE_ROLES = ["admin", "staff", "viewer"] as const;

/** Team members, their built-in role, and custom roles with per-section access. */
export function TeamAccess() {
  const { t } = useI18n();
  const { shop } = useShop();
  const { data: members, mutate: reloadMembers } = useApi<Member[]>(`/shops/${shop.id}/members`);
  const { data: roles, mutate: reloadRoles } = useApi<RolesResp>(`/shops/${shop.id}/roles`);
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!members || !roles) return <Spinner />;

  const patch = async (m: Member, body: { role?: Member["role"]; customRoleId?: string | null }) => {
    setError(null);
    try {
      await api(`/shops/${shop.id}/members/${m.id}`, { method: "PATCH", json: body });
      reloadMembers();
    } catch (err) {
      setError(err);
    }
  };
  const remove = async (m: Member) => {
    if (!confirm(t("tm.removeConfirm"))) return;
    setError(null);
    try {
      await api(`/shops/${shop.id}/members/${m.id}`, { method: "DELETE" });
      reloadMembers();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold strong">{t("tm.members")}</h3>
            <p className="text-xs muted">{t("tm.membersHint")}</p>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> {t("tm.add")}
          </Button>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={m.name ?? m.phone} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium strong">{m.name ?? t("tm.noName")}</span>
                <span className="num block text-xs muted" dir="ltr">
                  {m.phone}
                </span>
              </span>
              {m.role === "owner" ? (
                <Badge tone="gold">{t("role.owner")}</Badge>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Select aria-label={t("tm.baseRole")} value={m.role} onChange={(e) => patch(m, { role: e.target.value as Member["role"] })} className="!w-auto !py-1.5 text-sm">
                    {BASE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`role.${r}` as DictKey)}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label={t("tm.customRole")} value={m.customRoleId ?? ""} onChange={(e) => patch(m, { customRoleId: e.target.value || null })} className="!w-auto !py-1.5 text-sm">
                    <option value="">{t("tm.noCustom")}</option>
                    {roles.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                  {shop.role === "owner" && (
                    <button onClick={() => remove(m)} className="rounded-full p-1.5 muted hover:text-danger" aria-label={t("tm.remove")}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {error ? <ErrorNote error={error} /> : null}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold strong">{t("tm.roles")}</h3>
            <p className="text-xs muted">{t("tm.rolesHint")}</p>
          </div>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t("tm.newRole")}
          </Button>
        </div>
        {roles.roles.length === 0 ? (
          <Empty icon={<ShieldCheck className="size-6" />} title={t("tm.noRoles")} />
        ) : (
          <ul className="space-y-2">
            {roles.roles.map((r) => {
              const used = members.filter((m) => m.customRoleId === r.id).length;
              return (
                <li key={r.id} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium strong">{r.name}</span>
                    <span className="flex items-center gap-2 text-xs muted">
                      {t("tm.usedBy").replace("{n}", String(used))}
                      <button onClick={() => setEditing(r)} className="rounded-full p-1.5 hover:bg-[var(--surface-sunken)]" aria-label={t("tm.edit")}>
                        <Pencil className="size-4" />
                      </button>
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {PERMISSION_SECTIONS.filter((s) => (r.permissions[s] ?? "view") !== "none").map((s) => (
                      <Badge key={s} tone={r.permissions[s] === "edit" ? "success" : "neutral"}>
                        {t(`psec.${s}` as DictKey)} · {t(`lvl.${r.permissions[s] ?? "view"}` as DictKey)}
                      </Badge>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editing && (
        <RoleEditor
          role={editing === "new" ? null : editing}
          builtin={roles.builtin}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadRoles();
            reloadMembers();
          }}
        />
      )}
      <AddMember open={adding} onClose={() => setAdding(false)} onAdded={() => (setAdding(false), reloadMembers())} />
    </div>
  );
}

function RoleEditor({ role, builtin, onClose, onSaved }: { role: Role | null; builtin: RolesResp["builtin"]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [name, setName] = useState(role?.name ?? "");
  const [perms, setPerms] = useState<Permissions>({ ...builtin.viewer, ...(role?.permissions ?? builtin.staff) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/roles${role ? `/${role.id}` : ""}`, { method: role ? "PUT" : "POST", json: { name, permissions: perms } });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!role || !confirm(t("tm.deleteConfirm"))) return;
    await api(`/shops/${shop.id}/roles/${role.id}`, { method: "DELETE" });
    onSaved();
  };
  const set = (s: PermissionSection, l: PermissionLevel) => setPerms((p) => ({ ...p, [s]: l }));

  return (
    <Modal open onClose={onClose} title={role ? t("tm.editRole") : t("tm.newRole")} wide>
      <div className="space-y-4">
        <Field label={t("tm.roleName")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tm.roleNamePh")} maxLength={60} />
        </Field>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="muted">{t("tm.startFrom")}</span>
          {BASE_ROLES.map((r) => (
            <button key={r} onClick={() => setPerms({ ...builtin[r] })} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-sunken)]">
              {t(`role.${r}` as DictKey)}
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          {PERMISSION_SECTIONS.map((s, i) => (
            <div key={s} className={clsx("flex items-center justify-between gap-3 px-3 py-2", i % 2 === 1 && "bg-[var(--surface-sunken)]")}>
              <span className="text-sm strong">{t(`psec.${s}` as DictKey)}</span>
              <div className="flex rounded-full bg-[var(--surface-sunken)] p-0.5 text-xs" role="radiogroup" aria-label={t(`psec.${s}` as DictKey)}>
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    role="radio"
                    aria-checked={perms[s] === l}
                    onClick={() => set(s, l)}
                    className={clsx(
                      "rounded-full px-3 py-1 transition",
                      perms[s] === l ? (l === "edit" ? "bg-success/25 font-medium strong" : l === "view" ? "bg-info/25 font-medium strong" : "bg-[var(--border)] font-medium strong") : "muted",
                    )}
                  >
                    {t(`lvl.${l}` as DictKey)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs muted">{t("tm.matrixHint")}</p>
        {error ? <ErrorNote error={error} /> : null}
        <div className="flex justify-between gap-2">
          {role ? (
            <Button variant="ghost" onClick={del} className="text-danger">
              <Trash2 className="size-4" /> {t("tm.delete")}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            {t("a.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddMember({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<(typeof BASE_ROLES)[number]>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/members`, { method: "POST", json: { phone, name: name || undefined, role } });
      setPhone("");
      setName("");
      onAdded();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t("tm.add")}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("tm.phone")}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" placeholder="09121234567" required />
        </Field>
        <Field label={t("tm.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("tm.baseRole")} hint={t("tm.addHint")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            {BASE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}` as DictKey)}
              </option>
            ))}
          </Select>
        </Field>
        {error ? <ErrorNote error={error} /> : null}
        <Button variant="primary" loading={busy} className="w-full">
          {t("tm.add")}
        </Button>
      </form>
    </Modal>
  );
}
