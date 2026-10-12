import type { SalesPersona } from "@shopino/db";

/**
 * Learn the shop's selling voice from its own replies (customer message -> teammate reply), without AI:
 * emoji habit, reply length, usual greeting and sign-off, recurring phrases, how objections were
 * answered, and a few representative examples for the prompt. Pure, so it is unit tested.
 */
export interface Pair {
  customer: string;
  reply: string;
}

export type PersonaProposal = Pick<SalesPersona, "emoji" | "length" | "greeting" | "signOff" | "phrases" | "objections" | "examples"> & {
  tonePreset: SalesPersona["tonePreset"];
  stats: { pairs: number; avgReplyLength: number; emojiShare: number };
};

const EMOJI = /\p{Extended_Pictographic}/u;
const GREETING = /^(سلام|درود|وقت(تون)?\s?بخیر|عرض ادب|hi|hello)/i;
const OBJECTION = /(گرون|گران|تخفیف|ارزون|مطمئن|اعتماد|اصل|فیک|کیفیت|دیر|تاخیر|مرجوع|پس\s?بد|ضمانت|گارانتی|expensive|discount|refund|trust)/i;
const FORMAL = /(بفرمایید|می‌باشد|میباشد|خواهشمند|احتراما|جنابعالی|سرکار)/;
const INFORMAL = /(میشه|داریم\s|هستش|چطوره|عزیزم|جونم|رفیق)/;
const STOP = new Set(["و", "به", "از", "که", "را", "رو", "با", "در", "این", "اون", "هم", "برای", "تا", "یه", "یک", "هست", "است", "the", "a", "to", "and"]);

/** opening words: up to the first comma or stop, at most three words ("سلام عزیزم 🌸") */
const opening = (t: string) => t.split(/[\n،,.!؟?]+/)[0]!.trim().split(/\s+/).slice(0, 3).join(" ");
const lastSentence = (t: string) => {
  const parts = t.split(/[\n.!؟?]+/).map((x) => x.trim()).filter(Boolean);
  return parts.at(-1) ?? "";
};
const norm = (t: string) => t.replace(/[ً-ٟ]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim().toLowerCase();

function mostCommon(values: string[], min: number) {
  const counts = new Map<string, { n: number; sample: string }>();
  for (const v of values) {
    if (!v) continue;
    const k = norm(v);
    const c = counts.get(k);
    counts.set(k, { n: (c?.n ?? 0) + 1, sample: c?.sample ?? v });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best && best.n >= min ? best.sample : "";
}

function frequentPhrases(replies: string[], max = 8) {
  const counts = new Map<string, number>();
  for (const r of replies) {
    const words = norm(r).split(/[^\p{L}\p{N}‌]+/u).filter(Boolean);
    const seen = new Set<string>();
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (STOP.has(gram[0]!) || STOP.has(gram.at(-1)!)) continue;
        const k = gram.join(" ");
        if (k.length < 6 || seen.has(k)) continue;
        seen.add(k);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  const min = Math.max(3, Math.ceil(replies.length * 0.08));
  const ranked = [...counts.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const out: string[] = [];
  for (const [k] of ranked) {
    if (out.some((o) => o.includes(k) || k.includes(o))) continue;
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

export function trainPersonaFromPairs(input: Pair[]): PersonaProposal {
  const pairs = input
    .map((p) => ({ customer: p.customer.trim(), reply: p.reply.trim() }))
    .filter((p) => p.customer.length >= 2 && p.reply.length >= 4 && !/^\[.*\]$/.test(p.customer));
  const replies = pairs.map((p) => p.reply);
  const n = replies.length || 1;
  const emojiShare = replies.filter((r) => EMOJI.test(r)).length / n;
  const avgReplyLength = Math.round(replies.reduce((s, r) => s + r.length, 0) / n);
  const formal = replies.filter((r) => FORMAL.test(r)).length;
  const informal = replies.filter((r) => INFORMAL.test(r)).length;

  const greeting = mostCommon(replies.map(opening).filter((s) => GREETING.test(s) && s.length <= 60), 3);
  const signOff = mostCommon(replies.map(lastSentence).filter((s) => s.length >= 4 && s.length <= 60 && !GREETING.test(s)), 3);

  const seenQ = new Set<string>();
  const unique = pairs.filter((p) => {
    const k = norm(p.customer).slice(0, 60);
    if (seenQ.has(k)) return false;
    seenQ.add(k);
    return true;
  });
  const objections = unique
    .filter((p) => OBJECTION.test(p.customer) && p.reply.length >= 15)
    .slice(0, 6)
    .map((p) => ({ objection: p.customer.slice(0, 300), answer: p.reply.slice(0, 800) }));
  // representative examples: mid-length replies, spread over different questions, objections excluded
  const examples = unique
    .filter((p) => !OBJECTION.test(p.customer) && p.reply.length >= 20 && p.reply.length <= 400 && p.customer.length <= 300)
    .sort((a, b) => Math.abs(a.reply.length - avgReplyLength) - Math.abs(b.reply.length - avgReplyLength))
    .slice(0, 6)
    .map((p) => ({ customer: p.customer.slice(0, 400), reply: p.reply.slice(0, 800) }));

  return {
    tonePreset: formal > informal * 1.5 ? "formal" : emojiShare > 0.5 ? "energetic" : "friendly",
    emoji: emojiShare < 0.1 ? "none" : emojiShare < 0.5 ? "few" : "many",
    length: avgReplyLength > 220 ? "medium" : "short",
    greeting,
    signOff,
    phrases: frequentPhrases(replies),
    objections,
    examples,
    stats: { pairs: pairs.length, avgReplyLength, emojiShare: Math.round(emojiShare * 100) / 100 },
  };
}
