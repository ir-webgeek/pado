/**
 * Chat -> site attribution. Links to the shop's own pages that we send in a DM carry a dedicated UTM
 * source plus `ref`, a signed conversation token, so visits, orders and bookings on the site can be
 * tied back to the chat that sent the customer there. Links to other sites are left untouched.
 */
export const DM_UTM = { utm_source: "shopino_dm", utm_medium: "instagram", utm_campaign: "dm" } as const;

export function tagUrl(url: string, siteOrigin: string, ref: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.origin !== siteOrigin) return url;
  for (const [k, v] of Object.entries(DM_UTM)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  u.searchParams.set("ref", ref);
  return u.toString();
}

// stop at whitespace and at closing punctuation that commonly wraps a link in a sentence
const URL_RE = /https?:\/\/[^\s<>()\]«»"']+[^\s<>()\]«»"'.,;:!?،؛]/g;

export function tagLinks(text: string, siteOrigin: string, ref: string): string {
  return text.replace(URL_RE, (m) => tagUrl(m, siteOrigin, ref));
}
