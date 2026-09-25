import { describe, expect, it } from "vitest";
import { readPath, tomanFromUsd } from "./usd";

describe("usd pricing", () => {
  it("converts, marks up and rounds up to the step", () => {
    expect(tomanFromUsd(1999, 100_000, 0, 1000)).toBe(1_999_000);
    expect(tomanFromUsd(1000, 98_765, 10, 10_000)).toBe(1_090_000); // 1,086,415 -> 1,090,000
  });
  it("reads rates from json paths", () => {
    expect(readPath({ data: { usd: { sell: "1,050,000" } } }, "data.usd.sell")).toBe(1_050_000);
    expect(readPath({ usd: 98000 }, "usd")).toBe(98000);
    expect(readPath({ usd: "n/a" }, "usd")).toBeNull();
    expect(readPath({}, "x.y")).toBeNull();
  });
});
