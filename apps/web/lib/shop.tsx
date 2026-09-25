"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface ShopSummary {
  id: string;
  slug: string;
  name: string;
  kind: "retail" | "services" | "hybrid";
  plan: string;
  role: string;
}

const ShopContext = createContext<{ shop: ShopSummary; shops: ShopSummary[]; switchShop: (id: string) => void } | null>(null);

export function ShopProvider({ value, children }: { value: { shop: ShopSummary; shops: ShopSummary[]; switchShop: (id: string) => void }; children: ReactNode }) {
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop outside ShopProvider");
  return ctx;
}
