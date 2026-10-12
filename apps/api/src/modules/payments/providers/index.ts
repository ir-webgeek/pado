import { env } from "../../../config";
import { mockProvider } from "./mock";
import { pasargadProvider } from "./pasargad";
import type { PaymentProvider } from "./types";
import { zarinpalProvider } from "./zarinpal";
import { torobpayConfigured, torobpayProvider } from "./torobpay";
import { cfg } from "../../../lib/platform";

const all: Record<string, PaymentProvider> = { mock: mockProvider, zarinpal: zarinpalProvider, pasargad: pasargadProvider, torobpay: torobpayProvider };

/** Buy-now-pay-later offered next to the main gateway when its credentials are set. */
export const installmentProvider = () => (torobpayConfigured() ? torobpayProvider : null);

export const activeProvider = () => all[cfg("PAYMENT_PROVIDER") ?? env.PAYMENT_PROVIDER] ?? mockProvider;
export const providerByName = (name: string) => all[name];
export type { PaymentProvider, PaymentSplit } from "./types";
