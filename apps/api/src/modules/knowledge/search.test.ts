import { describe, expect, it } from "vitest";
import { toOrQuery } from "./search";

describe("toOrQuery", () => {
  it("builds a prefix OR query and drops punctuation / 1-letter words", () => {
    expect(toOrQuery("کت کتان، سایز ۳۸ ؟ a")).toBe("'کت' | 'کتان':* | 'سایز':* | '38'");
    expect(toOrQuery("?!")).toBeNull();
  });
  it("leaves out Persian function words and chat filler", () => {
    expect(toOrQuery("سلام، فاکتور رسمی با کد اقتصادی صادر می‌کنید؟")).toBe("'فاکتور':* | 'رسمی':* | 'کد' | 'اقتصادی':* | 'صادر':*");
    expect(toOrQuery("سلام خوبید؟ ارسال به شيراز چند روزه؟")).toBe("'خوبید':* | 'ارسال':* | 'شیراز':* | 'روزه':*");
    expect(toOrQuery("سلام ممنون")).toBeNull();
  });
});
