import type { PaymentProvider } from "./types";

/**
 * Pasargad (PEP) "Dorsa" shared gateway with payment splitting (تسهیم) - PLACEHOLDER.
 *
 * Plan: the shop's share goes to the merchant's Sheba and the platform commission (PLATFORM_FEE_PERCENT)
 * to the platform Sheba in the same transaction, using the splits passed in PaymentRequest.splits.
 * The official API docs/SDKs (pep.co.ir/developers, github.com/pepco-api) were not reachable while this
 * was written, so no request shapes are guessed here. Implement request/verify against the official
 * docs, then set PAYMENT_PROVIDER=pasargad.
 */
export const pasargadProvider: PaymentProvider = {
  name: "pasargad",
  supportsSplit: true,
  async request() {
    throw new Error("pasargad provider is not implemented yet - see providers/pasargad.ts");
  },
  async verify() {
    throw new Error("pasargad provider is not implemented yet - see providers/pasargad.ts");
  },
};
