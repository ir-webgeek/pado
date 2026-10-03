import { describe, expect, it } from "vitest";
import { tagLinks, tagUrl } from "./dm-ref";

const SITE = "https://shopino.ir";

describe("dm link tagging", () => {
  it("tags own-site links with the dm utm source and ref, keeping existing params", () => {
    const u = new URL(tagUrl("https://shopino.ir/o/SHP-1?t=abc", SITE, "conv.sig"));
    expect(u.searchParams.get("t")).toBe("abc");
    expect(u.searchParams.get("utm_source")).toBe("shopino_dm");
    expect(u.searchParams.get("ref")).toBe("conv.sig");
  });
  it("leaves other sites and an explicit utm_source alone", () => {
    expect(tagUrl("https://instagram.com/p/1", SITE, "r")).toBe("https://instagram.com/p/1");
    expect(new URL(tagUrl("https://shopino.ir/s/a?utm_source=bio", SITE, "r")).searchParams.get("utm_source")).toBe("bio");
  });
  it("rewrites links inside Persian text without swallowing punctuation", () => {
    const out = tagLinks("لینک سفارش: https://shopino.ir/o/SHP-1?t=abc، ممنون!", SITE, "r");
    expect(out).toContain("utm_source=shopino_dm");
    expect(out.endsWith("&ref=r، ممنون!")).toBe(true);
  });
});
