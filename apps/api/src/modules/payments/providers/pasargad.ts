import { createPrivateKey, createSign, randomInt } from "node:crypto";
import { cfg } from "../../../lib/platform";
import type { PaymentProvider } from "./types";
import { resilientFetch } from "../../../lib/http";

/**
 * Pasargad (PEP) IPG, REST API v1, following the bank's official SDK (github.com/pepco-api/nodejs-rest-sdk):
 * - POST {base}/Api/v1/Payment/GetToken, then redirect to {base}/payment.aspx?n=Token
 * - the bank returns with ?IN=invoiceNumber&ID=invoiceDate&tref=transactionReferenceID
 * - POST CheckTransactionResult (IsSuccess), then VerifyPayment (IsSuccess) to keep the money
 * Every request body is signed with the merchant's RSA private key (SHA1, base64) in a `Sign` header.
 * Amounts are sent in Rial (we store Toman), as with the other Shaparak gateways here.
 * Split (تسهیم شاپرکی, must be enabled on the terminal): `MultiPaymentData` = base64 of an XML list of
 * <item><iban/><type/><value/></item>, type 0 = fixed amount (Rial), exactly as the official PHP SDK builds it.
 */
const ACTION_PAYMENT = 1003;
const base = () => (cfg("PASARGAD_BASE_URL") ?? "https://pep.shaparak.ir").replace(/\/+$/, "");

/** The bank issues the key in .NET XML form (<RSAKeyValue><Modulus>...); Node takes it via JWK. */
export function xmlKeyToPrivateKey(xml: string) {
  const tag = (name: string) => {
    const m = xml.match(new RegExp(`<${name}>([^<]+)</${name}>`));
    if (!m) throw new Error(`pasargad private key: <${name}> missing`);
    return Buffer.from(m[1]!.trim(), "base64").toString("base64url");
  };
  return createPrivateKey({
    key: { kty: "RSA", n: tag("Modulus"), e: tag("Exponent"), d: tag("D"), p: tag("P"), q: tag("Q"), dp: tag("DP"), dq: tag("DQ"), qi: tag("InverseQ") },
    format: "jwk",
  });
}

/** MultiPaymentData payload (official PHP SDK: PaymentItem + generatePayment). Values in Rial. */
export function multiPaymentData(splits: { iban: string; amount: number }[]) {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const items = splits.map((x) => `<item>\n <iban>${esc(x.iban)}</iban>\n <type>0</type>\n <value>${x.amount * 10}</value>\n</item>\n`).join("");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${items}`, "utf8").toString("base64");
}

export function signBody(body: string, xmlKey: string) {
  const s = createSign("SHA1");
  s.update(body);
  return s.sign(xmlKeyToPrivateKey(xmlKey), "base64");
}

/** "YYYY/MM/DD HH:mm:ss" for invoiceDate, "YYYY-MM-DD HH:mm:ss" for timeStamp, Tehran time as the bank expects. */
function tehran(d: Date, sep: "/" | "-") {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${sep}${p.month}${sep}${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function creds() {
  const merchantCode = cfg("PASARGAD_MERCHANT_CODE");
  const terminalCode = cfg("PASARGAD_TERMINAL");
  const key = cfg("PASARGAD_PRIVATE_KEY");
  if (!merchantCode || !terminalCode || !key) throw new Error("Pasargad gateway is not configured (super admin > platform settings)");
  return { merchantCode, terminalCode, key };
}

async function call<T>(path: string, params: Record<string, unknown>, key: string): Promise<T> {
  const body = JSON.stringify(params);
  const res = await resilientFetch(`${base()}/Api/v1/Payment/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", Sign: signBody(body, key) },
    body,
    timeoutMs: 30_000,
    service: "pasargad",
    // checking and verifying the same invoice can be repeated safely; a token request is not retried
    idempotent: path !== "GetToken",
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !data) throw new Error(`pasargad ${path} failed (${res.status})`);
  return data;
}

export const pasargadProvider: PaymentProvider = {
  name: "pasargad",
  supportsSplit: true,
  async request(req) {
    const c = creds();
    const invoiceNumber = `${Date.now()}${randomInt(100, 1000)}`;
    const invoiceDate = tehran(new Date(), "/");
    const r = await call<{ IsSuccess?: boolean; Token?: string; Message?: string }>(
      "GetToken",
      {
        amount: req.amount * 10,
        invoiceNumber,
        invoiceDate,
        action: ACTION_PAYMENT,
        merchantCode: c.merchantCode,
        terminalCode: c.terminalCode,
        redirectAddress: req.callbackUrl,
        timeStamp: tehran(new Date(), "-"),
        ...(req.mobile ? { mobile: req.mobile } : {}),
        ...(req.splits?.length ? { MultiPaymentData: multiPaymentData(req.splits) } : {}),
      },
      c.key,
    );
    if (!r.Token) throw new Error(`pasargad token failed: ${r.Message ?? "no token"}`);
    // authority keeps what verification needs: invoice number and date
    return { authority: `${invoiceNumber}|${invoiceDate}`, redirectUrl: `${base()}/payment.aspx?n=${encodeURIComponent(r.Token)}` };
  },
  async verify({ authority, amount, query }) {
    const [invoiceNumber, invoiceDate] = authority.split("|");
    if (!query.tref || query.IN !== invoiceNumber) return { ok: false, raw: { reason: "callback mismatch", query } };
    const c = creds();
    const check = await call<{ IsSuccess?: boolean; Amount?: number; ReferenceNumber?: number | string }>(
      "CheckTransactionResult",
      { transactionReferenceID: query.tref, invoiceNumber, invoiceDate, merchantCode: c.merchantCode, terminalCode: c.terminalCode },
      c.key,
    );
    if (!check.IsSuccess || Number(check.Amount) !== amount * 10) return { ok: false, raw: check };
    const v = await call<{ IsSuccess?: boolean; ShaparakRefNumber?: string }>(
      "VerifyPayment",
      { amount: amount * 10, invoiceNumber, invoiceDate, merchantCode: c.merchantCode, terminalCode: c.terminalCode, timeStamp: tehran(new Date(), "-") },
      c.key,
    );
    return { ok: Boolean(v.IsSuccess), refId: v.ShaparakRefNumber ?? (check.ReferenceNumber != null ? String(check.ReferenceNumber) : undefined), raw: { check, verify: v } };
  },
};
