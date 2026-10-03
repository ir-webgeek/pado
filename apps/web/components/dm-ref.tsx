"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Chat -> site attribution. DM links carry `ref` (a signed conversation token, see the API's
 * inbox/dm-ref). We keep it for 30 days, report customer-page views once per page per session, and
 * attach it to orders and bookings so the shop sees which chat they came from.
 */
const KEY = "dmref";
const TTL = 30 * 86_400_000;
const CUSTOMER_PAGES = /^\/(s|b|o|f)\//;

export function getDmRef(): string | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const { ref, at } = JSON.parse(raw) as { ref: string; at: number };
    return Date.now() - at < TTL ? ref : undefined;
  } catch {
    return undefined;
  }
}

export function DmRefTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!CUSTOMER_PAGES.test(pathname)) return;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("ref");
      if (fromUrl) localStorage.setItem(KEY, JSON.stringify({ ref: fromUrl, at: Date.now() }));
      const ref = getDmRef();
      const seen = `dmref-seen:${pathname}`;
      if (!ref || sessionStorage.getItem(seen)) return;
      sessionStorage.setItem(seen, "1");
      void fetch("/api/v1/public/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref, path: pathname }), keepalive: true });
    } catch {}
  }, [pathname]);
  return null;
}
