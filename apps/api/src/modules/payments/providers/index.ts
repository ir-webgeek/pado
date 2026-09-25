import { env } from "../../../config";
import { mockProvider } from "./mock";
import { pasargadProvider } from "./pasargad";
import type { PaymentProvider } from "./types";
import { zarinpalProvider } from "./zarinpal";

const all: Record<string, PaymentProvider> = { mock: mockProvider, zarinpal: zarinpalProvider, pasargad: pasargadProvider };

export const activeProvider = () => all[env.PAYMENT_PROVIDER]!;
export const providerByName = (name: string) => all[name];
export type { PaymentProvider, PaymentSplit } from "./types";
