import { sql } from "drizzle-orm";
import type { DbOrTx } from "@shopino/db";
import { normalize } from "../automations/match";

/** Build an OR prefix tsquery from free text: "کت کتان سایز" -> "'کت':* | 'کتان':* | 'سایز':*". */
export function toOrQuery(text: string): string | null {
  const terms = [...new Set(normalize(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))].slice(0, 12);
  return terms.length ? terms.map((t) => `'${t.replace(/'/g, "")}':*`).join(" | ") : null;
}

/**
 * Retrieval over the shop's knowledge entries: Postgres full-text (simple config works for Persian,
 * which tokenizes on whitespace) ranked together with trigram similarity for typos and partial words.
 * The query layer is isolated here so an embedding-based retriever can replace it later.
 */
export async function searchKnowledge(db: DbOrTx, shopId: string, text: string, limit = 4) {
  const q = toOrQuery(text);
  if (!q) return [];
  const rows = await db.execute<{ id: string; title: string; content: string; score: number }>(sql`
    SELECT id, title, content,
      ts_rank(to_tsvector('simple', title || ' ' || content), to_tsquery('simple', ${q})) + similarity(content, ${text}) AS score
    FROM knowledge_entries
    WHERE shop_id = ${shopId} AND active
      AND (to_tsvector('simple', title || ' ' || content) @@ to_tsquery('simple', ${q}) OR similarity(content, ${text}) > 0.12)
    ORDER BY score DESC
    LIMIT ${limit}`);
  return [...rows];
}
