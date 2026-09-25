import { randomToken } from "../../../lib/crypto";
import { env } from "../../../config";
import type { PaymentProvider } from "./types";

/** Development gateway: a local page lets you pick success or failure. */
export const mockProvider: PaymentProvider = {
  name: "mock",
  supportsSplit: false,
  async request(req) {
    const authority = `MOCK${randomToken(12)}`;
    const q = new URLSearchParams({ authority, amount: String(req.amount), callback: req.callbackUrl, description: req.description });
    return { authority, redirectUrl: `${env.PUBLIC_WEB_URL}/pay/mock?${q}` };
  },
  async verify({ authority, query }) {
    const ok = query.Status === "OK" && query.Authority === authority;
    return { ok, refId: ok ? `MOCKREF${Date.now()}` : undefined };
  },
};
