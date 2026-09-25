export interface PaymentSplit {
  /** destination account (Sheba/IBAN) */
  iban: string;
  amount: number; // Toman
  role: "merchant" | "platform";
}

export interface PaymentRequest {
  amount: number; // Toman
  description: string;
  callbackUrl: string;
  mobile?: string;
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
  verify(input: { authority: string; amount: number; query: Record<string, string | undefined> }): Promise<{ ok: boolean; refId?: string; raw?: unknown }>;
}
