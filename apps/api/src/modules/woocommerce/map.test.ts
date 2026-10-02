import { describe, expect, it } from "vitest";
import { mapSimple, mapVariation, stripHtml, toToman, variantKey, type WooProduct } from "./map";

const base: WooProduct = { id: 1, name: "Shirt", type: "simple", status: "publish" };

describe("woocommerce mapping", () => {
  it("converts prices to whole Toman", () => {
    expect(toToman("1250000", "rial")).toBe(125000);
    expect(toToman("99000", "toman")).toBe(99000);
    expect(toToman("", "toman")).toBeNull();
  });
  it("uses the sale price with the regular price as compare-at", () => {
    const v = mapSimple({ ...base, regular_price: "200000", sale_price: "150000", manage_stock: true, stock_quantity: 4 }, "toman", 10);
    expect(v).toMatchObject({ price: 150000, compareAtPrice: 200000, stock: 4 });
  });
  it("defaults stock for unmanaged in-stock items and zero when out of stock", () => {
    expect(mapSimple({ ...base, price: "1000", stock_status: "instock" }, "toman", 7).stock).toBe(7);
    expect(mapSimple({ ...base, price: "1000", stock_status: "outofstock" }, "toman", 7).stock).toBe(0);
  });
  it("maps variation attributes and parent-managed stock", () => {
    const parent = { ...base, type: "variable", stock_quantity: 9 };
    const v = mapVariation({ id: 2, regular_price: "50000", manage_stock: "parent", attributes: [{ name: "Size", option: "M" }] }, parent, "toman", 3);
    expect(v).toMatchObject({ attributes: { Size: "M" }, price: 50000, stock: 9 });
  });
  it("keys variants by sku, else by attributes regardless of order", () => {
    expect(variantKey({ sku: "A1", attributes: {} })).toBe("sku:A1");
    expect(variantKey({ attributes: { b: "2", a: "1" } })).toBe(variantKey({ attributes: { a: "1", b: "2" } }));
  });
  it("strips html to plain text", () => {
    expect(stripHtml("<p>سلام&nbsp;<b>دنیا</b></p><p>خط دوم</p>")).toBe("سلام دنیا\n\nخط دوم");
  });
});
