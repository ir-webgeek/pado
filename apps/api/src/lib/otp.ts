import type { Redis } from "ioredis";
import { normalizeIranPhone } from "@shopino/shared";
import { env, isProd } from "../config";
import { otpCode, safeEqual, sha256 } from "./crypto";
import { AppError, badRequest } from "./errors";
import { sendSms } from "../modules/notifications/sms";

const OTP_TTL_S = 120;

/** Shared by shop staff login and the customer portal; `scope` keeps the two code spaces apart. */
export async function requestOtp(redis: Redis, rawPhone: string, scope: "staff" | "customer", label: string) {
  const phone = normalizeIranPhone(rawPhone);
  if (!phone) throw badRequest("invalid_phone", "enter a valid mobile number");
  const throttleKey = `otp:throttle:${scope}:${phone}`;
  const sent = await redis.incr(throttleKey);
  if (sent === 1) await redis.expire(throttleKey, 600);
  if (sent > 5) throw new AppError(429, "too_many_requests", "too many codes requested, try again later");

  const code = otpCode();
  await redis.set(`otp:${scope}:${phone}`, JSON.stringify({ h: sha256(code), tries: 0 }), "EX", OTP_TTL_S);
  await sendSms(phone, `${label}: ${code}`);
  const echo = env.OTP_DEV_ECHO && !isProd;
  return { phone, ttl: OTP_TTL_S, devCode: echo ? code : undefined };
}

export async function verifyOtp(redis: Redis, rawPhone: string, code: string, scope: "staff" | "customer") {
  const phone = normalizeIranPhone(rawPhone);
  if (!phone) throw badRequest("invalid_phone");
  const key = `otp:${scope}:${phone}`;
  const raw = await redis.get(key);
  if (!raw) throw badRequest("otp_expired", "code expired, request a new one");
  const state = JSON.parse(raw) as { h: string; tries: number };
  if (state.tries >= 5) {
    await redis.del(key);
    throw badRequest("otp_locked", "too many wrong attempts");
  }
  if (!safeEqual(state.h, sha256(code))) {
    await redis.set(key, JSON.stringify({ ...state, tries: state.tries + 1 }), "KEEPTTL");
    throw badRequest("otp_invalid", "wrong code");
  }
  await redis.del(key);
  return phone;
}
