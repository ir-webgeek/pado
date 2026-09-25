"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";

/** Local stand-in for a bank gateway (PAYMENT_PROVIDER=mock). */
export default function MockGatewayPage() {
  return (
    <Suspense>
      <MockGateway />
    </Suspense>
  );
}

function MockGateway() {
  const { t, locale } = useI18n();
  const sp = useSearchParams();
  const authority = sp.get("authority") ?? "";
  const callback = sp.get("callback") ?? "/";
  const go = (ok: boolean) => {
    const url = new URL(callback, window.location.origin);
    url.searchParams.set("Authority", authority);
    url.searchParams.set("Status", ok ? "OK" : "NOK");
    window.location.href = url.toString();
  };
  return (
    <div data-theme="day" className="flex min-h-dvh items-center justify-center bg-[var(--bg)] px-4">
      <div className="card w-full max-w-sm space-y-4 p-6 text-center">
        <p className="text-sm muted">{t("mock.title")}</p>
        <p className="text-sm strong">{sp.get("description")}</p>
        <p className="num text-3xl font-bold strong">{money(Number(sp.get("amount") ?? 0), locale)}</p>
        <Button variant="primary" size="lg" className="w-full" onClick={() => go(true)}>
          {t("mock.ok")}
        </Button>
        <Button variant="danger" className="w-full" onClick={() => go(false)}>
          {t("mock.fail")}
        </Button>
      </div>
    </div>
  );
}
