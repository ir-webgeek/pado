import { describe, expect, it } from "vitest";
import { BUILTIN_PERMISSIONS, canAccess, sectionOfPage, sectionOfRoute } from "./permissions";

describe("permissions", () => {
  it("maps API routes to panel sections", () => {
    expect(sectionOfRoute("/v1/shops/:shopId/orders/:id/status")).toBe("orders");
    expect(sectionOfRoute("/v1/shops/:shopId/conversations/summary")).toBe("inbox");
    expect(sectionOfRoute("/v1/shops/:shopId/time-off")).toBe("appointments");
    expect(sectionOfRoute("/v1/shops/:shopId/roles/:roleId")).toBe("settings");
    // unknown segments fall to the strictest section
    expect(sectionOfRoute("/v1/shops/:shopId/something-new")).toBe("settings");
    expect(sectionOfRoute("/v1/shops/:shopId")).toBeNull();
  });
  it("maps panel pages", () => {
    expect(sectionOfPage("/panel")).toBe("dashboard");
    expect(sectionOfPage("/panel/instagram")).toBe("inbox");
    expect(sectionOfPage("/panel/orders/abc")).toBe("orders");
    expect(sectionOfPage("/install")).toBeNull();
  });
  it("view vs edit", () => {
    const p = { ...BUILTIN_PERMISSIONS.viewer, inbox: "edit" as const };
    expect(canAccess(p, "inbox", "edit")).toBe(true);
    expect(canAccess(p, "orders", "view")).toBe(true);
    expect(canAccess(p, "orders", "edit")).toBe(false);
    expect(canAccess(p, "settings", "view")).toBe(false);
  });
});
