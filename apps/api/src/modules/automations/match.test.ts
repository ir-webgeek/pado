import { describe, expect, it } from "vitest";
import { matchRule, normalize, textMatches, type RuleLike } from "./match";

const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: Math.random().toString(36),
  trigger: "comment",
  mediaId: null,
  keywords: [],
  matchMode: "contains",
  priority: 0,
  active: true,
  createdAt: new Date("2026-01-01"),
  ...over,
});

describe("normalize", () => {
  it("unifies Arabic/Persian letters, digits and ZWNJ", () => {
    expect(normalize("قيمت  كت‌ها ۳۸")).toBe("قیمت کت ها 38");
  });
});

describe("textMatches", () => {
  it("contains / exact / any", () => {
    expect(textMatches({ keywords: ["قیمت"], matchMode: "contains" }, "سلام قيمتش چنده؟")).toBe(true);
    expect(textMatches({ keywords: ["قیمت"], matchMode: "exact" }, "قیمت چنده")).toBe(false);
    expect(textMatches({ keywords: ["price"], matchMode: "exact" }, " PRICE ")).toBe(true);
    expect(textMatches({ keywords: [], matchMode: "any" }, "هر چیزی")).toBe(true);
    expect(textMatches({ keywords: [], matchMode: "contains" }, "x")).toBe(false);
  });
});

describe("matchRule", () => {
  it("prefers media-specific rules and respects priority", () => {
    const general = rule({ keywords: ["قیمت"] });
    const specific = rule({ keywords: ["قیمت"], mediaId: "m1" });
    const urgent = rule({ keywords: ["قیمت"], priority: 5 });
    expect(matchRule([general, specific], { trigger: "comment", text: "قیمت؟", mediaId: "m1" })).toBe(specific);
    expect(matchRule([general, specific], { trigger: "comment", text: "قیمت؟", mediaId: "m2" })).toBe(general);
    expect(matchRule([general, specific, urgent], { trigger: "comment", text: "قیمت؟", mediaId: "m1" })).toBe(urgent);
  });
  it("filters by trigger and active", () => {
    const off = rule({ trigger: "dm_keyword", keywords: ["سلام"], active: false });
    const story = rule({ trigger: "story_reply", matchMode: "any" });
    expect(matchRule([off, story], { trigger: "dm_keyword", text: "سلام" })).toBeUndefined();
    expect(matchRule([off, story], { trigger: "story_reply", text: "😍" })).toBe(story);
  });
});
