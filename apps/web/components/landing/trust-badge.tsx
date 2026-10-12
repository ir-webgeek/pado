import { ShieldCheck } from "lucide-react";
import { siteConfig } from "@/lib/server-api";

/**
 * Footer trust seal: the eNamad badge code once the platform admin pastes it, otherwise the site's own
 * badge (or the admin's image) linking to the configured URL. Nothing when neither is set.
 */
export async function TrustBadge({ label }: { label: string }) {
  const site = await siteConfig();
  if (site?.enamadHtml) {
    // pasted by the platform admin from eNamad's panel (an <a><img></a> snippet)
    return <div className="trust-seal [&_img]:max-h-24" dangerouslySetInnerHTML={{ __html: site.enamadHtml }} />;
  }
  if (!site?.badgeUrl) return null;
  return (
    <a href={site.badgeUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="origin" className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 transition hover:border-gold/50">
      {site.badgeImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={site.badgeImage} alt={label} referrerPolicy="origin" className="h-14 w-auto" />
      ) : (
        <>
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f8f5f] to-[#0b5e8f] text-white">
            <ShieldCheck className="size-6" />
          </span>
          <span className="text-xs leading-5">
            <b className="block strong">{label}</b>
            <span className="muted">e-Namad</span>
          </span>
        </>
      )}
    </a>
  );
}
