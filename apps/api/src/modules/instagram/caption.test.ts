import { describe, expect, it } from "vitest";
import { parseCaption, parseColors, parsePrice, parseSizes } from "./caption";

describe("parsePrice", () => {
  it("reads the ways sellers write prices", () => {
    expect(parsePrice("قیمت: ۴۸۰ تومن")).toBe(480_000);
    expect(parsePrice("قیمت ۴۸۰ هزار تومان")).toBe(480_000);
    expect(parsePrice("۱/۸۵۰ میلیون")).toBe(1_850_000);
    expect(parsePrice("1.5 میلیون تومان")).toBe(1_500_000);
    expect(parsePrice("1,850,000 تومان")).toBe(1_850_000);
    expect(parsePrice("۱٬۸۵۰٬۰۰۰ تومان")).toBe(1_850_000);
    expect(parsePrice("۱۸۵۰۰۰۰۰ ریال")).toBe(1_850_000);
    expect(parsePrice("فقط ۹۵۰ت")).toBe(950_000);
  });
  it("ignores sizes, phone numbers and codes; keeps the discounted price", () => {
    expect(parsePrice("سایز ۳۸ و ۴۰ موجوده")).toBeNull();
    expect(parsePrice("سفارش: ۰۹۱۲۱۲۳۴۵۶۷")).toBeNull();
    expect(parsePrice("قیمت قبل ۶۵۰ تومن\nبا تخفیف ۴۹۰ تومن")).toBe(490_000);
  });
});

describe("sizes and colours", () => {
  it("expands ranges and reads letter sizes", () => {
    expect(parseSizes("سایزبندی: ۳۶ تا ۴۲")).toEqual(["36", "38", "40", "42"]);
    expect(parseSizes("سایز ۳۷ تا ۴۰")).toEqual(["37", "38", "39", "40"]);
    expect(parseSizes("سایز: S, M, L, XL")).toEqual(["S", "M", "L", "XL"]);
    expect(parseSizes("فری سایز تا ۴۴")).toContain("فری سایز");
  });
  it("only takes colours from colour lines", () => {
    expect(parseColors("رنگبندی: مشکی، کرم و سرمه ای")).toEqual(["مشکی", "کرم", "سرمه‌ای"]);
    expect(parseColors("با دکمه‌های طلایی")).toEqual([]);
  });
});

describe("parseCaption", () => {
  it("turns a typical shop post into a product draft", () => {
    const x = parseCaption(`✨ کت کتان کرم ✨
جنس: کتان درجه یک، آستر دار
سایزبندی: ۳۶ تا ۴۰
رنگبندی: کرم، مشکی
💰 قیمت: ۴۸۰ تومن
📩 سفارش از دایرکت یا واتساپ ۰۹۱۲۱۲۳۴۵۶۷
#کت #کت_زنانه`);
    expect(x.isProduct).toBe(true);
    expect(x.title).toBe("کت کتان کرم");
    expect(x.price).toBe(480_000);
    expect(x.category).toBe("پوشاک");
    expect(x.variants).toHaveLength(6);
    expect(x.variants[0]).toEqual({ attributes: { رنگ: "کرم", سایز: "36" }, price: null });
    expect(x.description).toContain("جنس: کتان");
    expect(x.description).not.toContain("0912");
    expect(x.description).not.toContain("#");
    expect(x.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("does not call a lifestyle post a product", () => {
    const x = parseCaption("صبح جمعه و یه فنجون قهوه ☕️\n#جمعه");
    expect(x.isProduct).toBe(false);
  });
});

describe("category", () => {
  it("matches whole words and prefers the title", () => {
    expect(parseCaption("کیف دوشی چرم\nقیمت ۹۰۰ تومن\nسفارش از دایرکت").category).toBe("کیف");
    expect(parseCaption("ست کت و دامن\nقیمت ۲ میلیون").category).toBe("پوشاک");
    expect(parseCaption("ماگ سرامیکی\nقیمت ۱۲۰ تومن").category).toBe("خانه و دکور");
  });
});
