import { sql } from "drizzle-orm";
import type { DbOrTx } from "@shopino/db";
import { normalize } from "../automations/match";

/**
 * Function words and chat filler that match almost every entry ("با", "می", "دارید", "سلام"). Left out of
 * the query so retrieval follows the words that carry the question.
 */
const STOPWORDS = new Set(
  (
    "از به با در که را رو این اون آن و یا تا برای هم می نمی های ها است هست هستن هستید بود شد شده کنید کنم کنی کنه کرد کردم " +
    "دارید داری داره دارم دارین داشت چی چه چند چطور چطوری چرا کی کجا آیا ایا من شما تو ما اونا یه یک هر اگه اگر بر بی پس " +
    "چون سلام درود لطفا ممنون مرسی خیلی ای ام اش میشه باشه بله نه بدید بدین بده میخوام میخواستم خواستم ببخشید وقت بخیر " +
    "the a an is are do does to of for and or in on at it i you we can"
  ).split(" "),
);

/** The words of a question that carry meaning, normalized (Arabic-keyboard letters, digits, ZWNJ). */
export const queryTerms = (text: string) => [...new Set(normalize(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOPWORDS.has(w)))].slice(0, 12);

/** Build an OR tsquery from free text: "کت کتان سایز" -> "'کت' | 'کتان':* | 'سایز':*". */
export function toOrQuery(text: string): string | null {
  const terms = queryTerms(text);
  // two-letter words only as whole words: as prefixes they match half the dictionary
  return terms.length ? terms.map((t) => `'${t.replace(/'/g, "")}'${t.length > 2 ? ":*" : ""}`).join(" | ") : null;
}

/**
 * Retrieval over the shop's knowledge entries: Postgres full-text (simple config works for Persian,
 * which tokenizes on whitespace) ranked together with trigram similarity for typos and partial words.
 * The query layer is isolated here so an embedding-based retriever can replace it later.
 */
export async function searchKnowledge(db: DbOrTx, shopId: string, text: string, limit = 4, sources?: readonly string[]) {
  const q = toOrQuery(text);
  if (!q || (sources && !sources.length)) return [];
  // trigram similarity on the meaningful words only, so greetings and filler do not pull in noise
  const words = queryTerms(text).join(" ");
  const sourceFilter = sources ? sql`AND source IN (${sql.join(sources.map((s) => sql`${s}`), sql`, `)})` : sql``;
  const rows = await db.execute<{ id: string; title: string; content: string; source: string; score: number }>(sql`
    SELECT id, title, content, source,
      ts_rank(to_tsvector('simple', title || ' ' || content), to_tsquery('simple', ${q})) + similarity(content, ${words}) AS score
    FROM knowledge_entries
    WHERE shop_id = ${shopId} AND active ${sourceFilter}
      AND (to_tsvector('simple', title || ' ' || content) @@ to_tsquery('simple', ${q}) OR similarity(content, ${words}) > 0.12)
    ORDER BY score DESC
    LIMIT ${limit}`);
  return [...rows];
}
