/** Pure rule matching for static (non-AI) Instagram automations. */

export type Trigger = "comment" | "story_reply" | "story_mention" | "dm_keyword" | "first_message";

export interface RuleLike {
  id: string;
  trigger: string;
  mediaId: string | null;
  keywords: string[];
  matchMode: string;
  priority: number;
  active: boolean;
  createdAt: Date;
}

/** Normalize Persian/Arabic variants, digits, case and invisible characters before comparing. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ً-ٰٟ]/g, "") // harakat
    .replace(/[‌‍‎‏]/g, " ") // ZWNJ / marks
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
}

export function textMatches(rule: Pick<RuleLike, "keywords" | "matchMode">, text: string): boolean {
  if (rule.matchMode === "any") return true;
  const t = normalize(text);
  const keys = rule.keywords.map(normalize).filter(Boolean);
  if (!keys.length) return false;
  if (rule.matchMode === "exact") return keys.includes(t);
  return keys.some((k) => t.includes(k));
}

/**
 * Best rule for an event: active, same trigger, media matches (a rule bound to a post/story only fires
 * there; unbound rules fire everywhere), text matches. Ties: priority, then media-specific, then oldest.
 */
export function matchRule<R extends RuleLike>(rules: R[], event: { trigger: Trigger; text: string; mediaId?: string | null }): R | undefined {
  return rules
    .filter((r) => r.active && r.trigger === event.trigger)
    .filter((r) => !r.mediaId || r.mediaId === event.mediaId)
    .filter((r) => textMatches(r, event.text))
    .sort((a, b) => b.priority - a.priority || Number(Boolean(b.mediaId)) - Number(Boolean(a.mediaId)) || a.createdAt.getTime() - b.createdAt.getTime())[0];
}
