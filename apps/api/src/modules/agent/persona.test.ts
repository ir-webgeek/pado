import { describe, expect, it } from "vitest";
import { DEFAULT_SHOP_SETTINGS } from "@shopino/db";
import { buildSystemPrompt, formatKnowledge, retrievalQuery } from "./persona";
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
