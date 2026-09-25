import { describe, expect, it } from "vitest";
import { toOrQuery } from "./search";

describe("toOrQuery", () => {
  it("builds a prefix OR query and drops punctuation / 1-letter words", () => {
    expect(toOrQuery("کت کتان، سایز ۳۸ ؟ a")).toBe("'کت':* | 'کتان':* | 'سایز':* | '38':*");
    expect(toOrQuery("?!")).toBeNull();
  });
});
