"use client";

import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { getDmRef } from "@/components/dm-ref";

export interface CartLine {
  variantId: string;
  title: string;
  label: string;
  price: number;
  image?: string;
  quantity: number;
  max: number;
}

interface CartCtx {
  lines: CartLine[];
  add: (l: Omit<CartLine, "quantity">) => void;
  setQty: (variantId: string, q: number) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}

const Ctx = createContext<CartCtx | null>(null);
export const useCart = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
};

export function CartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const key = `cart:${slug}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setLines(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {}
  }, [key]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(lines));
    } catch {}
  }, [key, lines]);

  const add = useCallback((l: Omit<CartLine, "quantity">) => {
    setLines((ls) => {
      const found = ls.find((x) => x.variantId === l.variantId);
      if (found) return ls.map((x) => (x.variantId === l.variantId ? { ...x, quantity: Math.min(x.max, x.quantity + 1) } : x));
      return [...ls, { ...l, quantity: 1 }];
    });
    setOpen(true);
  }, []);
  const setQty = useCallback((variantId: string, q: number) => {
    setLines((ls) => (q <= 0 ? ls.filter((x) => x.variantId !== variantId) : ls.map((x) => (x.variantId === variantId ? { ...x, quantity: Math.min(x.max, q) } : x))));
  }, []);
  const value = useMemo(() => ({ lines, add, setQty, open, setOpen }), [lines, add, setQty, open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <CartDrawer slug={slug} />
    </Ctx.Provider>
  );
}

export function CartButton() {
  const { lines, setOpen } = useCart();
  const count = lines.reduce((a, l) => a + l.quantity, 0);
  const { locale } = useI18n();
  return (
    <button onClick={() => setOpen(true)} className="relative rounded-full p-2 hover:bg-[var(--surface-sunken)]" aria-label="cart">
      <ShoppingBag className="size-5" />
      {count > 0 && <span className="num absolute -end-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-[var(--accent-ink)]">{num(count, locale)}</span>}
    </button>
  );
}

function CartDrawer({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const { lines, setQty, open, setOpen } = useCart();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const total = lines.reduce((a, l) => a + l.price * l.quantity, 0);
  if (!open) return null;

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ code: string; token: string }>(`/public/shops/${slug}/orders`, {
        method: "POST",
        json: { items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), ref: getDmRef() },
      });
      localStorage.removeItem(`cart:${slug}`);
      router.push(`/o/${r.code}?t=${r.token}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <aside onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-sm flex-col bg-[var(--bg-elev)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
          <h2 className="font-semibold strong">{t("sf.cart")}</h2>
          <button onClick={() => setOpen(false)} className="rounded-full p-1.5 hover:bg-[var(--surface-sunken)]">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {lines.length === 0 && <p className="py-10 text-center muted">{t("sf.emptyCart")}</p>}
          {lines.map((l) => (
            <div key={l.variantId} className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {l.image ? <img src={l.image} alt="" className="size-16 rounded-xl object-cover" /> : <div className="size-16 rounded-xl bg-[var(--surface-sunken)]" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium strong">{l.title}</p>
                {l.label && <p className="text-xs muted">{l.label}</p>}
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 rounded-full border border-[var(--border)] px-1">
                    <button className="p-1" onClick={() => setQty(l.variantId, l.quantity - 1)}>
                      <Minus className="size-3" />
                    </button>
                    <span className="num w-4 text-center text-sm">{num(l.quantity, locale)}</span>
                    <button className="p-1" onClick={() => setQty(l.variantId, l.quantity + 1)} disabled={l.quantity >= l.max}>
                      <Plus className="size-3" />
                    </button>
                  </div>
                  <span className="num text-sm strong">{money(l.price * l.quantity, locale)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {lines.length > 0 && (
          <div className="space-y-3 border-t border-[var(--border)] p-4">
            <div className="flex justify-between font-semibold strong">
              <span>{t("o.total")}</span>
              <span className="num">{money(total, locale)}</span>
            </div>
            <ErrorNote error={error} />
            <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={checkout}>
              {t("sf.checkout")}
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}
