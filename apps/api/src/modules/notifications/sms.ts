import { env } from "../../config";

/**
 * SMS provider boundary. Only a console provider ships; add an Iranian provider adapter
 * (Kavenegar, SMS.ir, ...) here following its official API docs.
 */
export interface SmsProvider {
  send(to: string, text: string): Promise<{ ok: boolean; parts: number }>;
}

const consoleProvider: SmsProvider = {
  async send(to, text) {
    console.info(`[sms -> ${to}] ${text}`);
    return { ok: true, parts: smsParts(text) };
  },
};

const providers: Record<typeof env.SMS_PROVIDER, SmsProvider> = { console: consoleProvider };

export function smsParts(text: string) {
  // Persian text is UCS-2: 70 chars single, 67 per part when concatenated
  const ucs2 = /[^\u0000-\u007f]/.test(text);
  const single = ucs2 ? 70 : 160;
  const multi = ucs2 ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

export function sendSms(to: string, text: string) {
  return providers[env.SMS_PROVIDER].send(to, text);
}
