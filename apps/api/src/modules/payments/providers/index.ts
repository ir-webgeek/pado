import { env } from "../../../config";
import { mockProvider } from "./mock";
import type { PaymentProvider } from "./types";
import { zarinpalProvider } from "./zarinpal";

const all: Record<string, PaymentProvider> = { mock: mockProvider, zarinpal: zarinpalProvider };

export const activeProvider = () => all[env.PAYMENT_PROVIDER]!;
export const providerByName = (name: string) => all[name];
export type { PaymentProvider } from "./types";
