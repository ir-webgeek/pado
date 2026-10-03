"use client";

import { useEffect, useSyncExternalStore } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// beforeinstallprompt fires once, early, on any page; keep it so the /install page can use it later
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Registers the service worker and captures the browser's install prompt. Mounted once in the root layout. */
export function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as InstallPromptEvent;
      emit();
    };
    const onInstalled = () => {
      deferred = null;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

/** The captured install prompt (Chrome / Edge / Android); null where the browser has none, such as iOS Safari. */
export function useInstallPrompt() {
  const available = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => deferred !== null,
    () => false,
  );
  const install = async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    emit();
    return outcome === "accepted";
  };
  return { available, install };
}

export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
