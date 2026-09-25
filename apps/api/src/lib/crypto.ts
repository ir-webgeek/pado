import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");
export const otpCode = () => String(randomInt(10000, 100000));

export function hmacSha256Hex(secret: string, payload: string | Buffer) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
