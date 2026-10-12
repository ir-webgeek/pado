import { describe, expect, it } from "vitest";
import { faNormalize } from "./fa-search";

describe("faNormalize", () => {
  it("folds Arabic-keyboard letters, ZWNJ and digits", () => {
    expect(faNormalize("كيف مشكي")).toBe("کیف مشکی");
    expect(faNormalize("می‌خوام")).toBe("می خوام");
    expect(faNormalize("سایز ۳۸")).toBe("سایز 38");
    expect(faNormalize("٠٩١٢")).toBe("0912");
    expect(faNormalize("  Mug   سرامیكی ")).toBe("mug سرامیکی");
  });
});
