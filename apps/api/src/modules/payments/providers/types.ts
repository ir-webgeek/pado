export interface PaymentRequest {
  amount: number; // Toman
  description: string;
  callbackUrl: string;
  mobile?: string;
}

export interface PaymentProvider {
  readonly name: string;
  request(req: PaymentRequest): Promise<{ authority: string; redirectUrl: string }>;
  /** `query` is the callback query string the gateway redirected back with. */
  verify(input: { authority: string; amount: number; query: Record<string, string | undefined> }): Promise<{ ok: boolean; refId?: string; raw?: unknown }>;
}
