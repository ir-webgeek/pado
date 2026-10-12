import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/platform", () => ({ cfg: (k: string) => ({ TOROBPAY_BASE_URL: "https://cpg.torobpay.com/" })[k] }));
const { tokenBody, trustedPaymentPage } = await import("./torobpay");

describe("torobpay", () => {
  it("only redirects to TorobPay's own pages", () => {
    expect(trustedPaymentPage("https://cpg.torobpay.com/pay/abc")).toBe(true);
    expect(trustedPaymentPage("https://pay.torobpay.com/x")).toBe(true);
    expect(trustedPaymentPage("https://torobpay.com.evil.example/x")).toBe(false);
    expect(trustedPaymentPage("http://pay.torobpay.com/x")).toBe(false);
    expect(trustedPaymentPage("javascript:alert(1)")).toBe(false);
  });
  it("sends Rial amounts and the cart like the official plugin", () => {
    const b = tokenBody(
      {
        amount: 1_000_000,
        description: "Order SHP-1",
        callbackUrl: "https://x.ir/api/v1/pay/callback/torobpay?pid=1",
        mobile: "+989121234567",
        cart: {
          reference: "SHP-1",
          items: [{ id: "v1", productId: "p1", name: "کت - M", count: 2, unitAmount: 450_000, category: "پوشاک", url: "https://x.ir/s/a/p/kat" }],
          shippingAmount: 150_000,
          discountAmount: 50_000,
          customer: { name: "علی", province: "تهران", city: "تهران", address: "خیابان ۱", postalCode: "1234567890" },
        },
      },
      "T-1",
    );
    expect(b.amount).toBe(10_000_000);
    expect(b.paymentMethodTypeDto).toBe("INSTALLMENT");
    expect(b.cartList[0]!.totalAmount).toBe(10_000_000);
    expect(b.cartList[0]!.cartItems[0]!.amount).toBe(4_500_000);
    expect(b.cartList[0]!.shippingAmount).toBe(1_500_000);
    expect(b.discountAmount).toBe(500_000);
    expect(b.mobile).toBe("+989121234567");
  });
});
