import { describe, expect, it } from "vitest";
import { validateSubmission } from "./validate";

describe("form validation", () => {
  const fields = [
    { key: "name", label: "Name", type: "text" as const, required: true },
    { key: "phone", label: "Phone", type: "phone" as const, required: true },
    { key: "color", label: "Color", type: "select" as const, required: false, options: ["a", "b"] },
    { key: "ok", label: "Agree", type: "checkbox" as const, required: true },
  ];
  it("accepts valid data", () => {
    const r = validateSubmission(fields, { name: " Sara ", phone: "09121234567", color: "a", ok: true });
    expect(r.errors).toEqual({});
    expect(r.data).toEqual({ name: "Sara", phone: "09121234567", color: "a", ok: true });
  });
  it("reports each problem", () => {
    const r = validateSubmission(fields, { name: "", phone: "123", color: "z" });
    expect(r.errors).toEqual({ name: "required", phone: "invalid_phone", color: "invalid_option", ok: "required" });
  });
});
