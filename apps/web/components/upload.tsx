"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useShop } from "@/lib/shop";

/** Uploads a file to the shop's storage and returns its public URL. */
export function UploadButton({ onUploaded, accept = "image/*", label }: { onUploaded: (url: string) => void; accept?: string; label: string }) {
  const { shop } = useShop();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-3 text-xs strong hover:bg-[var(--surface-sunken)]"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} {label}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const fd = new FormData();
            fd.append("file", file);
            const r = await api<{ url: string }>(`/shops/${shop.id}/uploads`, { method: "POST", body: fd });
            onUploaded(r.url);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
    </span>
  );
}
