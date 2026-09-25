import Link from "next/link";
import { Logo } from "@/components/logo";
import type { DictKey } from "@/lib/i18n";

export function SiteFooter({ t }: { t: (k: DictKey) => string }) {
  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-10 sm:flex-row sm:items-center">
        <div>
          <Logo label={t("brand.name")} />
          <p className="mt-2 text-sm muted">{t("brand.tagline")}</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm muted">
          <Link href="/pricing">{t("nav.pricing")}</Link>
          <Link href="/#faq">{t("nav.faq")}</Link>
          <Link href="/login">{t("nav.panel")}</Link>
        </div>
        <p className="text-xs muted">© {new Date().getFullYear()} {t("brand.name")}. {t("footer.rights")}</p>
      </div>
    </footer>
  );
}
