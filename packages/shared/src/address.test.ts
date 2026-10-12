import { describe, expect, it } from "vitest";
import { addressSchema } from "./schemas";

const base = { fullName: "علی کریمی", province: "فارس", city: "شیراز", line: "خیابان زند، پلاک ۳۴" };

describe("addressSchema", () => {
  it("stores Persian-keyboard digits as Latin", () => {
    const a = addressSchema.parse({ ...base, phone: "۰۹۱۲ ۸۸۸-۷۷۶۶", postalCode: "۷۱۳۴۵-۶۷۸۹۰" });
    expect(a.phone).toBe("09128887766");
    expect(a.postalCode).toBe("7134567890");
    expect(a.line).toBe("خیابان زند، پلاک ۳۴");
  });
  it("accepts a landline and an empty postal code", () => {
    const a = addressSchema.parse({ ...base, phone: "071-32223344", postalCode: "" });
    expect(a.phone).toBe("07132223344");
    expect(a.postalCode).toBeUndefined();
  });
  it("rejects a malformed postal code", () => {
    expect(addressSchema.safeParse({ ...base, phone: "09128887766", postalCode: "12345" }).success).toBe(false);
  });
});
