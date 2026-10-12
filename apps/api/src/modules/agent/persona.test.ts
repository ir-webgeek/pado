import { describe, expect, it } from "vitest";
import { DEFAULT_SHOP_SETTINGS } from "@shopino/db";
import { buildSystemPrompt, formatKnowledge, handoffKeyword, pickKnowledge, promoActive, retrievalQuery } from "./persona";
import { faNormalize } from "../../lib/fa-search";
import { trainPersonaFromPairs } from "./persona-train";

const settings = (sales: Partial<typeof DEFAULT_SHOP_SETTINGS.sales> = {}) => ({ ...DEFAULT_SHOP_SETTINGS, sales: { ...DEFAULT_SHOP_SETTINGS.sales, ...sales } });

describe("sales prompt", () => {
  it("uses the persona name, tone preset, style and few-shot examples", () => {
    const p = buildSystemPrompt(
      { name: "آتلیه رها", kind: "retail", settings: settings({ assistantName: "سارا", tonePreset: "luxury", style: "direct", emoji: "none", examples: [{ customer: "قیمت؟", reply: "۴۸۰ تومن عزیزم" }] }) },
      "instagram",
    );
    expect(p).toContain("You are سارا, the sales consultant of \"آتلیه رها\"");
    expect(p).toContain("calm, refined");
    expect(p).toContain("Propose the next step in the same message");
    expect(p).toContain("Do not use emoji.");
    expect(p).toContain("Customer: قیمت؟\nShop: ۴۸۰ تومن عزیزم");
  });
  it("custom tone uses the shop's own text; upsell and scarcity follow the toggles", () => {
    const base = { ...settings({ tonePreset: "custom", upsell: false, scarcity: false }) };
    base.agent = { ...base.agent, tone: "خیلی خودمونی" };
    const p = buildSystemPrompt({ name: "x", kind: "retail", settings: base }, "web");
    expect(p).toContain("Tone: خیلی خودمونی");
    expect(p).not.toContain("complementary item");
    expect(p).toContain("Do not use urgency or scarcity");
  });
  it("searches short follow-ups together with the previous message", () => {
    expect(retrievalQuery(["کت کتان کرم سایز ۳۸ دارید؟", "مشکی؟"])).toBe("کت کتان کرم سایز ۳۸ دارید؟ مشکی؟");
    expect(retrievalQuery(["سلام", "ارسال به شیراز چند روز طول میکشه؟"])).toBe("ارسال به شیراز چند روز طول میکشه؟");
  });
  it("labels knowledge by kind", () => {
    expect(formatKnowledge([{ title: "کت", content: "قیمت: ۱", source: "products" }])).toBe("- (product) کت: قیمت: ۱");
  });
});

describe("persona training from chat history", () => {
  const pairs = [
    { customer: "سلام قیمت کت کتان چنده؟", reply: "سلام عزیزم 🌸 کت کتان ۴۸۰ هزار تومنه، سایز ۳۶ تا ۴۰ موجوده. ممنون از انتخابت" },
    { customer: "سلام سایز ۳۸ مشکی دارید؟", reply: "سلام عزیزم 🌸 بله مشکی ۳۸ موجوده، لینک خرید رو بفرستم؟ ممنون از انتخابت" },
    { customer: "سلام ارسال به شیراز چقدر طول میکشه", reply: "سلام عزیزم 🌸 با پست پیشتاز ۲ تا ۳ روز کاری میرسه. ممنون از انتخابت" },
    { customer: "خیلی گرونه، تخفیف ندارید؟", reply: "سلام عزیزم 🌸 پارچه کتان درجه یک و دوخت دستیه، برای خرید دوم ۱۰٪ تخفیف داریم. ممنون از انتخابت" },
    { customer: "جنسش چیه؟", reply: "کتان صد درصد، خنک و بدون چروک زیاد" },
  ];
  it("learns greeting, sign-off, emoji habit, objections and examples", () => {
    const r = trainPersonaFromPairs(pairs);
    expect(r.greeting).toBe("سلام عزیزم 🌸");
    expect(r.signOff).toBe("ممنون از انتخابت");
    expect(r.emoji).toBe("many");
    expect(r.objections).toHaveLength(1);
    expect(r.objections[0]!.objection).toContain("تخفیف");
    expect(r.examples.length).toBeGreaterThanOrEqual(3);
    expect(r.examples.some((e) => e.customer.includes("تخفیف"))).toBe(false);
    expect(r.phrases).toContain("سلام عزیزم");
    expect(r.stats.pairs).toBe(5);
  });
  it("handles an empty history", () => {
    const r = trainPersonaFromPairs([]);
    expect(r.examples).toEqual([]);
    expect(r.greeting).toBe("");
  });
});

describe("reply controls", () => {
  it("address, register, language, price policy, phone, banned words", () => {
    const p = buildSystemPrompt(
      { name: "x", kind: "retail", settings: settings({ address: "informal", register: "written", language: "fa", priceInChat: "link", askPhone: true, bannedWords: ["ارزون"] }) },
      "instagram",
    );
    expect(p).toContain("Address the customer as تو");
    expect(p).toContain("standard written Persian");
    expect(p).toContain("Always reply in Persian");
    expect(p).toContain("Do not write prices in the chat");
    expect(p).toContain("ask for the customer's mobile number");
    expect(p).toContain('Never use these words or phrases: "ارزون"');
  });
  it("promotion only until its last day", () => {
    const sales = { promo: "۲۰٪ تخفیف کت‌ها تا آخر هفته", promoUntil: "2026-10-15" };
    expect(promoActive(sales, "2026-10-15")).toBe(true);
    expect(promoActive(sales, "2026-10-16")).toBe(false);
    expect(buildSystemPrompt({ name: "x", kind: "retail", settings: settings(sales) }, "instagram", "2026-10-14")).toContain("Current offer");
    expect(buildSystemPrompt({ name: "x", kind: "retail", settings: settings(sales) }, "instagram", "2026-10-20")).not.toContain("Current offer");
  });
  it("strict knowledge mode sends uncovered policy questions to a person", () => {
    const st = settings();
    st.rag = { ...st.rag, strict: true };
    expect(buildSystemPrompt({ name: "x", kind: "retail", settings: st }, "web")).toContain("answer only from the shop knowledge");
  });
  it("keyword handoff ignores keyboard differences", () => {
    expect(handoffKeyword("سلام، می‌خوام مرجوعي بدم", ["مرجوعی", "شکایت"], faNormalize)).toBe("مرجوعی");
    expect(handoffKeyword("قیمت کت چنده؟", ["مرجوعی"], faNormalize)).toBeNull();
  });
});

describe("knowledge picking", () => {
  const hits = [
    { id: "1", source: "dm_history", score: 0.3 },
    { id: "2", source: "manual", score: 0.2 },
    { id: "3", source: "comments", score: 0.05 },
    { id: "4", source: "faq", score: 0.1 },
  ];
  it("drops weak matches and prefers what the shop wrote", () => {
    expect(pickKnowledge(hits, { minRelevance: "balanced", preferManual: true, topK: 2 }).map((h) => h.id)).toEqual(["2", "1"]);
    expect(pickKnowledge(hits, { minRelevance: "balanced", preferManual: false, topK: 2 }).map((h) => h.id)).toEqual(["1", "2"]);
    expect(pickKnowledge(hits, { minRelevance: "any", preferManual: false, topK: 8 })).toHaveLength(4);
    expect(pickKnowledge(hits, { minRelevance: "high", preferManual: false, topK: 8 }).map((h) => h.id)).toEqual(["1", "2"]);
  });
  it("cuts long snippets", () => {
    const long = "ارسال ".repeat(200);
    expect(formatKnowledge([{ title: "ارسال", content: long, source: "manual" }], 150).length).toBeLessThan(190);
  });
});
