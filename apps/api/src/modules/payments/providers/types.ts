export interface PaymentSplit {
  /** destination account (Sheba/IBAN) */
  iban: string;
  amount: number; // Toman
  role: "merchant" | "platform";
}

/** What an installment (BNPL) provider needs to underwrite the purchase. Amounts in Toman. */
export interface InstallmentCart {
  reference: string;
  items: { id: string; productId: string; name: string; count: number; unitAmount: number; category: string; url: string }[];
  shippingAmount: number;
  discountAmount: number;
  customer: { name: string; province: string; city: string; address: string; postalCode: string };
}

export interface PaymentRequest {
  amount: number; // Toman
  description: string;
  callbackUrl: string;
  mobile?: string;
  /** required by installment providers */
  cart?: InstallmentCart;
  /**
   * Shared-gateway split (تسهیم): merchant share + platform commission. Providers that don't support
   * splitting ignore it and the platform fee stays recorded on the payment for manual settlement.
   */
  splits?: PaymentSplit[];
}

export interface PaymentProvider {
  readonly name: string;
  readonly supportsSplit: boolean;
  request(req: PaymentRequest): Promise<{ authority: string; redirectUrl: string }>;
  /** `query` is the callback query string the gateway redirected back with. */
  verify(input: { authority: string; amount: number; query: Record<string, string | undefined> }): Promise<{ ok: boolean; refId?: string; raw?: unknown; settlePending?: boolean }>;
  /** installment providers: finish a payment that was verified but not yet settled */
  settle?(authority: string): Promise<boolean>;
}
