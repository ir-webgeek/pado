"use client";

import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        variant === "primary" && "bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-105 shadow-[0_8px_24px_-10px_rgb(217_208_184/.6)]",
        variant === "secondary" && "border border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--text)] hover:bg-[var(--accent-soft)]",
        variant === "ghost" && "text-[var(--text-body)] hover:bg-[var(--surface-sunken)]",
        variant === "danger" && "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={clsx("card p-4 sm:p-5", className)}>
      {children}
    </div>
  );
}

const tones = {
  neutral: "bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border)]",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/12 text-warning border-warning/25",
  danger: "bg-danger/12 text-danger border-danger/25",
  info: "bg-info/12 text-info border-info/25",
  gold: "bg-gold/15 text-[var(--accent)] border-gold/30",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export const statusTone = (s: string): Tone =>
  (
    ({
      awaiting_payment: "warning",
      pending: "warning",
      pending_review: "warning",
      confirmed: "info",
      processing: "info",
      ready_to_ship: "gold",
      checked_in: "gold",
      shipped: "info",
      delivered: "success",
      completed: "success",
      paid: "success",
      cancelled: "danger",
      no_show: "danger",
      expired: "neutral",
      returned: "danger",
      unpaid: "neutral",
      failed: "danger",
      refunded: "neutral",
      vip: "gold",
      at_risk: "warning",
      lost: "danger",
      new: "info",
      regular: "neutral",
    }) as Record<string, Tone>
  )[s] ?? "neutral";

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs muted">{hint}</span>}
    </label>
  );
}

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx("input", className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx("input min-h-24", className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={clsx("input appearance-none", className)}>
    {children}
  </select>
);

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 py-1.5 text-start">
      <span className="text-sm strong">{label}</span>
      <span className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]")}>
        <span className={clsx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "start-[1.375rem]" : "start-0.5")} />
      </span>
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        "m-auto w-[calc(100%-1.5rem)] rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--bg-elev)] p-0 text-[var(--text-body)] shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
            <h3 className="text-base font-semibold strong">{title}</h3>
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-[var(--surface-sunken)]" aria-label="close">
              <X className="size-4" />
            </button>
          </div>
          <div className="scroll-thin overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="scroll-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition",
            value === it.value ? "bg-[var(--accent)] text-[var(--accent-ink)] font-medium" : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]",
          )}
        >
          {it.label}
          {it.count !== undefined && <span className={clsx("num rounded-full px-1.5 text-[11px]", value === it.value ? "bg-black/10" : "bg-[var(--surface-sunken)]")}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin muted", className)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="mb-1 rounded-2xl bg-[var(--surface-sunken)] p-3 muted">{icon}</div>}
      <p className="font-medium strong">{title}</p>
      {children && <div className="text-sm muted">{children}</div>}
    </div>
  );
}

export function Avatar({ name, color, size = 36 }: { name?: string | null; color?: string; size?: number }) {
  const ch = (name ?? "?").trim().charAt(0) || "?";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-ink-900"
      style={{ width: size, height: size, background: color ?? "var(--color-sky-brand)", fontSize: size * 0.42 }}
    >
      {ch}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold strong sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{msg}</p>;
}
