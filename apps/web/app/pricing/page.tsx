import type { Metadata } from "next";
import { SiteFooter } from "@/components/landing/footer";
import { SiteNav } from "@/components/landing/nav";
import { PricingCards } from "@/components/landing/pricing-cards";
import { getT } from "@/lib/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("nav.pricing") };
}

export default async function PricingPage() {
  const { t } = await getT();
  return (
    <div className="night-sky min-h-dvh">
      <SiteNav />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h1 className="text-3xl font-bold strong sm:text-5xl">{t("sec.pricing.t")}</h1>
          <p className="mt-4 muted">{t("sec.pricing.s")}</p>
        </div>
        <PricingCards />
      </main>
      <SiteFooter t={t} />
    </div>
  );
}
