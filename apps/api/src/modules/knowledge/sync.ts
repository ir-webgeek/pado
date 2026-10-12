import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { categories, conversations, igComments, igMedia, knowledgeEntries, messages, productVariants, products, resolveShopSettings, shops, type Database } from "@shopino/db";
import { formatToman } from "@shopino/shared";
import { env } from "../../config";
import { cfg } from "../../lib/platform";
import { aiAvailable } from "../agent/llm";
import { normalize } from "../automations/match";
import { listMedia } from "../instagram/client";
import { learnFromDms } from "./learn";

/**
 * RAG auto-setup. Everything the assistant should "know" without the owner typing it:
 * - products: one entry per active product (price range, options, stock), rebuilt on every run
 * - comments: customer question + the shop's own reply under Instagram posts
 * - dm_history: the shop's style and recurring answers from past DMs (AI), or plain question/answer
 *   pairs from human replies when AI is not available
 * Synced sources are replaced wholesale on each run; manual and FAQ entries are never touched.
 */

const MAX_PRODUCTS = 500;
const MAX_PAIRS = 120;

export async function syncProductKnowledge(db: Database, shopId: string) {
  const rows = await db
    .select({ id: products.id, title: products.title, description: products.description, category: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.shopId, shopId), eq(products.status, "active")))
    .orderBy(desc(products.updatedAt))
    .limit(MAX_PRODUCTS);
  const variants = rows.length
    ? await db
        .select({ productId: productVariants.productId, attributes: productVariants.attributes, price: productVariants.price, stock: productVariants.stock, reserved: productVariants.reserved })
        .from(productVariants)
        .where(inArray(productVariants.productId, rows.map((r) => r.id)))
        .orderBy(asc(productVariants.position))
    : [];
  const byProduct = new Map<string, typeof variants>();
  for (const v of variants) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), v]);

  const entries = rows.map((p) => {
    const vs = byProduct.get(p.id) ?? [];
    const prices = vs.map((v) => v.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const options = new Map<string, Set<string>>();
    for (const v of vs) for (const [k, val] of Object.entries(v.attributes)) options.set(k, (options.get(k) ?? new Set()).add(val));
    const available = vs.filter((v) => v.stock - v.reserved > 0).length;
    const lines = [
      p.category ? `دسته: ${p.category}` : "",
      prices.length ? `قیمت: ${min === max ? formatToman(min) : `${formatToman(min)} تا ${formatToman(max)}`}` : "",
      ...[...options].map(([k, set]) => `${k}: ${[...set].join("، ")}`),
      vs.length ? (available ? `موجود (${available} از ${vs.length} مدل)` : "فعلا ناموجود") : "",
      p.description.slice(0, 600),
    ].filter(Boolean);
    return { shopId, source: "products", ref: p.id, title: p.title.slice(0, 200), content: lines.join("\n").slice(0, 8000) };
  });
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeEntries).where(and(eq(knowledgeEntries.shopId, shopId), eq(knowledgeEntries.source, "products")));
    if (entries.length) await tx.insert(knowledgeEntries).values(entries);
  });
  return entries.length;
}

interface GraphComment {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id: string; username?: string };
  replies?: { data: GraphComment[] };
}

/** GET /{media-id}/comments with replies expanded (Instagram API with Instagram Login, max 50 per call). */
async function fetchMediaComments(accessToken: string, mediaId: string): Promise<GraphComment[]> {
  const version = cfg("META_GRAPH_VERSION") ?? env.META_GRAPH_VERSION;
  const fields = "id,text,timestamp,username,from,replies{id,text,timestamp,username,from}";
  const res = await fetch(`https://graph.instagram.com/${version}/${mediaId}/comments?fields=${encodeURIComponent(fields)}&limit=50`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: GraphComment[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`instagram comments failed (${res.status}): ${json.error?.message ?? "unknown error"}`);
  return json.data ?? [];
}

export async function storeComment(
  db: Database,
  shopId: string,
  c: { commentId: string; text: string; mediaId?: string | null; parentId?: string | null; fromId?: string | null; username?: string | null; byShop: boolean; postedAt?: Date | null },
) {
  if (!c.text.trim()) return;
  await db
    .insert(igComments)
    .values({ shopId, ...c, text: c.text.slice(0, 2200) })
    .onConflictDoNothing();
}

/** Pull comments of the shop's recent posts (the ones already listed in the Instagram import). */
export async function fetchCommentHistory(db: Database, shopId: string, mediaLimit = 25) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop?.igUserId || !shop.igAccessToken) return 0;
  let media = await db.select({ mediaId: igMedia.mediaId }).from(igMedia).where(eq(igMedia.shopId, shopId)).orderBy(desc(igMedia.postedAt)).limit(mediaLimit);
  // nothing imported yet: list the page's recent posts directly
  if (!media.length) media = (await listMedia({ igUserId: shop.igUserId, accessToken: shop.igAccessToken }, mediaLimit)).map((m) => ({ mediaId: m.id }));
  let n = 0;
  for (const m of media) {
    const list = await fetchMediaComments(shop.igAccessToken, m.mediaId);
    for (const c of list) {
      const isShop = (x: GraphComment) => x.from?.id === shop.igUserId || (Boolean(shop.igUsername) && (x.username ?? x.from?.username) === shop.igUsername);
      await storeComment(db, shopId, { commentId: c.id, text: c.text ?? "", mediaId: m.mediaId, fromId: c.from?.id, username: c.username ?? c.from?.username, byShop: isShop(c), postedAt: c.timestamp ? new Date(c.timestamp) : null });
      n++;
      for (const r of c.replies?.data ?? []) {
        await storeComment(db, shopId, { commentId: r.id, text: r.text ?? "", mediaId: m.mediaId, parentId: c.id, fromId: r.from?.id, username: r.username ?? r.from?.username, byShop: isShop(r), postedAt: r.timestamp ? new Date(r.timestamp) : null });
        n++;
      }
    }
  }
  return n;
}

const looksLikeQuestion = (t: string) => /[?؟]|چند|قیمت|موجود|سایز|ارسال|چطور|کی |کجا|رنگ|price|size|how|when/i.test(t);

/** Customer question under a post + the shop's reply to it become a knowledge entry. Deterministic, no AI. */
export async function learnFromComments(db: Database, shopId: string) {
  const rows = await db.select().from(igComments).where(eq(igComments.shopId, shopId)).orderBy(desc(igComments.postedAt)).limit(3000);
  const byId = new Map(rows.map((r) => [r.commentId, r]));
  const seen = new Set<string>();
  const entries: (typeof knowledgeEntries.$inferInsert)[] = [];
  for (const reply of rows) {
    if (!reply.byShop || !reply.parentId) continue;
    const q = byId.get(reply.parentId);
    if (!q || q.byShop || !looksLikeQuestion(q.text)) continue;
    const key = normalize(q.text).slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ shopId, source: "comments", ref: q.commentId, title: q.text.slice(0, 200), content: reply.text.slice(0, 2000) });
    if (entries.length >= MAX_PAIRS) break;
  }
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeEntries).where(and(eq(knowledgeEntries.shopId, shopId), eq(knowledgeEntries.source, "comments")));
    if (entries.length) await tx.insert(knowledgeEntries).values(entries);
  });
  return entries.length;
}

/** Without AI: a customer's question followed by a teammate's reply in DMs becomes a Q/A entry. */
export async function learnPairsFromDms(db: Database, shopId: string) {
  const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.shopId, shopId)).orderBy(desc(conversations.lastMessageAt)).limit(200);
  if (!convs.length) return 0;
  const msgs = await db
    .select({ conversationId: messages.conversationId, direction: messages.direction, sender: messages.sender, text: messages.text })
    .from(messages)
    .where(inArray(messages.conversationId, convs.map((c) => c.id)))
    .orderBy(asc(messages.createdAt));
  const seen = new Set<string>();
  const entries: (typeof knowledgeEntries.$inferInsert)[] = [];
  for (let i = 0; i < msgs.length - 1 && entries.length < MAX_PAIRS; i++) {
    const q = msgs[i]!;
    const a = msgs[i + 1]!;
    if (q.conversationId !== a.conversationId || q.direction !== "in" || a.sender !== "human" || !looksLikeQuestion(q.text) || a.text.length < 8) continue;
    const key = normalize(q.text).slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ shopId, source: "dm_history", ref: q.conversationId, title: q.text.slice(0, 200), content: a.text.slice(0, 2000) });
  }
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeEntries).where(and(eq(knowledgeEntries.shopId, shopId), eq(knowledgeEntries.source, "dm_history")));
    if (entries.length) await tx.insert(knowledgeEntries).values(entries);
  });
  return entries.length;
}

/** Full rebuild of the synced sources; records the outcome in settings.rag.lastRun. */
export async function autoSetupKnowledge(db: Database, shopId: string, opts: { fetchComments?: boolean; useAi?: boolean } = {}) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) return null;
  const settings = resolveShopSettings(shop.settings);
  const result = { at: new Date().toISOString(), products: 0, comments: 0, dms: 0 } as { at: string; products: number; comments: number; dms: number; error?: string };
  const errors: string[] = [];
  try {
    result.products = await syncProductKnowledge(db, shopId);
  } catch (err) {
    errors.push(`products: ${(err as Error).message}`);
  }
  try {
    if (opts.fetchComments !== false) await fetchCommentHistory(db, shopId);
  } catch (err) {
    errors.push(`comments fetch: ${(err as Error).message}`);
  }
  try {
    result.comments = await learnFromComments(db, shopId);
  } catch (err) {
    errors.push(`comments: ${(err as Error).message}`);
  }
  try {
    result.dms = opts.useAi !== false && aiAvailable() ? (await learnFromDms(db, shopId)).faqs : await learnPairsFromDms(db, shopId);
  } catch (err) {
    errors.push(`dms: ${(err as Error).message}`);
    result.dms = await learnPairsFromDms(db, shopId).catch(() => 0);
  }
  if (errors.length) result.error = errors.join("; ").slice(0, 500);
  // re-read: learnFromDms may have just written the learned style
  const fresh = await db.query.shops.findFirst({ where: eq(shops.id, shopId), columns: { settings: true } });
  const stored = (fresh?.settings ?? {}) as Record<string, unknown>;
  await db.update(shops).set({ settings: { ...stored, rag: { ...settings.rag, ...(stored.rag as object), lastRun: result } } }).where(eq(shops.id, shopId));
  return result;
}
