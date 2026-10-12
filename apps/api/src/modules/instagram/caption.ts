import type { ExtractedProduct } from "@shopino/db";
import { faNormalize } from "../../lib/fa-search";

/**
 * Reads an Instagram shop caption without AI: price, sizes, colours, a title and a clean description.
 * Free and instant, so every synced post gets a first pass; the AI scan can refine it later.
 * Persian sellers write prices many ways ("۴۸۰ تومن", "قیمت: ۱/۸۵۰ میلیون", "1,850,000 تومان", "ریال").
 */

const DIGITS = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
/** faNormalize per line (it collapses whitespace, and line breaks matter here). */
const normLines = (s: string) => s.split(/\r?\n/).map(faNormalize).join("\n");

const COLORS = [
  "مشکی", "سفید", "کرم", "طوسی", "خاکستری", "سرمه‌ای", "سرمه ای", "آبی", "قرمز", "سبز", "زرد", "نارنجی", "صورتی", "بنفش",
  "قهوه‌ای", "قهوه ای", "بژ", "نسکافه‌ای", "نسکافه ای", "شیری", "زرشکی", "یشمی", "طلایی", "نقره‌ای", "نقره ای", "گلبهی",
  "لیمویی", "فیروزه‌ای", "کالباسی", "خردلی", "کاراملی", "استخوانی", "یاسی", "سبز لجنی", "آجری",
];

const CATEGORY_WORDS: [string, string[]][] = [
  ["کیف", ["کیف", "کوله", "کیف پول", "کلاچ"]],
  ["کفش", ["کفش", "کتونی", "صندل", "بوت", "نیم بوت", "دمپایی", "اسنیکر"]],
  ["پوشاک", ["مانتو", "شومیز", "بلوز", "پیراهن", "کت", "شلوار", "دامن", "تیشرت", "تی شرت", "هودی", "سویشرت", "پالتو", "کاپشن", "جلیقه", "لباس", "کت و شلوار"]],
  ["زیورآلات", ["انگشتر", "گردنبند", "دستبند", "گوشواره", "پابند", "زیورآلات"]],
  ["عطر", ["عطر", "ادکلن", "ادوپرفیوم", "بادی اسپلش"]],
  ["آرایشی و بهداشتی", ["کرم", "سرم", "رژ", "ریمل", "پنکک", "آرایشی", "اسکین کر"]],
  ["خانه و دکور", ["ماگ", "لیوان", "فنجان", "ظرف", "بشقاب", "گلدان", "شمع", "دکوری"]],
  ["اکسسوری", ["شال", "روسری", "کلاه", "عینک", "کمربند", "ساعت"]],
];

/** Whole words only ("کت" must not match inside "دایرکت"); the title decides before the rest of the caption. */
function categoryOf(title: string, caption: string): string | null {
  const has = (text: string, word: string) => new RegExp(`(^|[^\\p{L}])${faNormalize(word)}($|[^\\p{L}])`, "u").test(text);
  for (const text of [faNormalize(title), faNormalize(caption)]) {
    let best: { cat: string; at: number } | null = null;
    for (const [cat, words] of CATEGORY_WORDS) {
      for (const w of words) {
        if (!has(text, w)) continue;
        const at = text.indexOf(faNormalize(w));
        if (!best || at < best.at) best = { cat, at };
      }
    }
    if (best) return best.cat;
  }
  return null;
}

const SALE_WORDS = /قیمت|موجود|سفارش|خرید|ارسال|تخفیف|فروش|تومان|تومن/;
const CONTACT = /(09\d{9}|\+98\d{10}|واتس ?اپ|واتساپ|تلگرام|دایرکت|direct|whatsapp|telegram|آیدی|ایدی|لینک (در )?بایو|link in bio|@\w+)/i;

/** "۱/۸۵۰" or "1.850" or "1,850,000" -> number (slash and dot are both used as thousands or decimal marks). */
function toNumber(raw: string, scaleFollows: boolean): number {
  const s = DIGITS(raw).replace(/[٬،\s]/g, ",");
  // with "میلیون" after it, a single separator is a decimal point: "1.8 میلیون", "۱/۵ میلیون"
  if (scaleFollows && /^\d+[./]\d{1,3}$/.test(s)) return Number(s.replace("/", "."));
  return Number(s.replace(/[.,/]/g, ""));
}

/** Price in Toman from free text; null when none is stated. Discounted captions keep the lowest price. */
export function parsePrice(text: string): number | null {
  const t = DIGITS(normLines(text)).replace(/هزارتومان/g, "هزار تومان");
  const re = /(\d[\d.,/٬]*)\s*(میلیون|ملیون|هزار|تومان|تومن|ت(?!\p{L})|ریال)?\s*(تومان|تومن)?/gu;
  const found: number[] = [];
  for (const m of t.matchAll(re)) {
    const unit = m[2] ?? "";
    const tail = m[3] ?? "";
    const near = t.slice(Math.max(0, m.index! - 14), m.index!);
    const labelled = /قیمت|price|فقط|با تخفیف/.test(near);
    if (!unit && !tail && !labelled) continue; // a bare number (size, code, phone) is not a price
    if (/^0?9\d{9}$/.test(m[1]!.replace(/\D/g, ""))) continue; // phone number
    let n = toNumber(m[1]!, unit === "میلیون" || unit === "ملیون");
    if (!Number.isFinite(n) || n <= 0) continue;
    if (unit === "میلیون" || unit === "ملیون") n *= 1_000_000;
    else if (unit === "هزار") n *= 1000;
    else if (unit === "ریال") n = Math.round(n / 10);
    // "۴۸۰ تومن" in an Instagram caption means 480 thousand
    else if (n < 1000) n *= 1000;
    if (n >= 1000 && n <= 10_000_000_000) found.push(Math.round(n));
  }
  if (!found.length) return null;
  return /تخفیف|حراج|off/i.test(t) ? Math.min(...found) : found[0]!;
}

const LETTER_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL"];

/** Sizes from lines that mention size: "سایز ۳۶ تا ۴۰", "سایز: S, M, L", "فری سایز". */
export function parseSizes(text: string): string[] {
  const out: string[] = [];
  for (const line of DIGITS(normLines(text)).split(/\n/)) {
    if (/فری ?سایز|free ?size/i.test(line)) out.push("فری سایز");
    if (!/سایز|size|سایزبندی/i.test(line)) continue;
    const range = line.match(/(\d{2})\s*(?:تا|-|الی|to)\s*(\d{2})/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (b > a && b - a <= 20) {
        // clothing sizes usually go up in twos (36, 38, 40); shoe sizes in ones
        const step = a % 2 === 0 && b % 2 === 0 && b - a >= 4 ? 2 : 1;
        for (let s = a; s <= b; s += step) out.push(String(s));
        continue;
      }
    }
    for (const n of line.match(/\b\d{2}\b/g) ?? []) if (Number(n) >= 20 && Number(n) <= 60) out.push(n);
    for (const l of line.toUpperCase().match(/\b(?:\d?X{0,3}[SML]|\dXL|X{1,3}L)\b/g) ?? []) if (LETTER_SIZES.includes(l)) out.push(l);
  }
  return [...new Set(out)].slice(0, 12);
}

/** Colours from lines about colour ("رنگبندی: مشکی، کرم") - other mentions are often details, not options. */
export function parseColors(text: string): string[] {
  const out: string[] = [];
  for (const line of normLines(text).split(/\n/)) {
    if (!/رنگ/.test(line)) continue;
    // in the order the seller listed them
    const hits = COLORS.map((c) => ({ c: c.replace(" ای", "‌ای"), at: line.indexOf(faNormalize(c)) })).filter((h) => h.at >= 0);
    out.push(...hits.sort((x, y) => x.at - y.at).map((h) => h.c));
  }
  return [...new Set(out)].slice(0, 10);
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const clean = (line: string) => line.replace(EMOJI, "").replace(/#[^\s#]+/g, "").replace(/^[\s\-–•*✓✔️▪️◾️🔸🔹]+/u, "").replace(/\s+/g, " ").trim();

export function parseCaption(caption: string): ExtractedProduct & { source: "rules" } {
  const lines = caption.split(/\r?\n/).map(clean).filter(Boolean);
  const isInfo = (l: string) => CONTACT.test(l) || parsePrice(l) !== null || /سایز|size|رنگ/i.test(l);
  const titleLine = lines.find((l) => !isInfo(l) && l.length >= 3 && /\p{L}/u.test(l)) ?? "";
  const title = titleLine.length > 70 ? `${titleLine.slice(0, 70).replace(/\s+\S*$/, "")}...` : titleLine;
  const description = lines.filter((l) => l !== titleLine && !CONTACT.test(l) && parsePrice(l) === null).join("\n").slice(0, 2000);

  const price = parsePrice(caption);
  const sizes = parseSizes(caption);
  const colors = parseColors(caption);
  const variants: ExtractedProduct["variants"] = [];
  if (sizes.length && colors.length) for (const c of colors) for (const s of sizes) variants.push({ attributes: { رنگ: c, سایز: s }, price: null });
  else for (const s of sizes) variants.push({ attributes: { سایز: s }, price: null });
  if (!sizes.length) for (const c of colors) variants.push({ attributes: { رنگ: c }, price: null });

  const norm = faNormalize(caption);
  const category = categoryOf(title, caption);
  const isProduct = price !== null || (variants.length > 0 && SALE_WORDS.test(norm));
  const confidence = !isProduct ? 0.2 : price !== null && title ? (variants.length ? 0.8 : 0.7) : 0.5;
  return { isProduct, confidence, title, description, price, variants: variants.slice(0, 50), category, source: "rules" };
}
