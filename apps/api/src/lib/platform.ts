import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { platformSettings, type Database } from "@shopino/db";
import { applyPlanOverrides, type PlanId, type PlanOverride } from "@shopino/shared";
import { env } from "../config";

/**
 * Platform configuration the super admin sets in the panel. Every key falls back to the environment
 * variable of the same name, so existing deployments keep working; a value saved in the panel wins.
 * Secrets are AES-256-GCM encrypted at rest and never returned to the browser.
 */
export interface SettingDef {
  key: string;
  group: "ai" | "meta" | "payment" | "shipping" | "notify" | "sms" | "site";
  label: { fa: string; en: string };
  secret?: boolean;
  /** allowed values for a select */
  options?: string[];
  kind?: "url" | "number" | "text" | "multiline";
  hint?: { fa: string; en: string };
}

export const SETTINGS: SettingDef[] = [
  { key: "ANTHROPIC_API_KEY", group: "ai", label: { fa: "کلید API هوش مصنوعی (Anthropic)", en: "AI API key (Anthropic)" }, secret: true },
  { key: "AGENT_MODEL", group: "ai", label: { fa: "مدل", en: "Model" } },
  { key: "META_APP_SECRET", group: "meta", label: { fa: "App Secret متا", en: "Meta app secret" }, secret: true },
  { key: "META_VERIFY_TOKEN", group: "meta", label: { fa: "توکن تایید وب‌هوک", en: "Webhook verify token" } },
  { key: "META_GRAPH_VERSION", group: "meta", label: { fa: "نسخه Graph API", en: "Graph API version" } },
  { key: "INSTAGRAM_APP_ID", group: "meta", label: { fa: "Instagram App ID", en: "Instagram app ID" } },
  { key: "INSTAGRAM_APP_SECRET", group: "meta", label: { fa: "Instagram App Secret", en: "Instagram app secret" }, secret: true },
  {
    key: "PAYMENT_PROVIDER",
    group: "payment",
    label: { fa: "درگاه فعال", en: "Active gateway" },
    options: ["mock", "pasargad", "zarinpal"],
    hint: { fa: "mock یعنی درگاه دمو برای تست، تا درگاه واقعی راه بیفتد.", en: "mock is the demo gateway for testing until the real one is set up." },
  },
  {
    key: "PASARGAD_BASE_URL",
    group: "payment",
    label: { fa: "آدرس درگاه پاسارگاد", en: "Pasargad gateway address" },
    kind: "url",
    hint: { fa: "پیش‌فرض: https://pep.shaparak.ir", en: "Default: https://pep.shaparak.ir" },
  },
  { key: "PASARGAD_MERCHANT_CODE", group: "payment", label: { fa: "کد پذیرنده پاسارگاد", en: "Pasargad merchant code" } },
  { key: "PASARGAD_TERMINAL", group: "payment", label: { fa: "کد ترمینال پاسارگاد", en: "Pasargad terminal code" } },
  {
    key: "PASARGAD_PRIVATE_KEY",
    group: "payment",
    label: { fa: "کلید خصوصی پاسارگاد (XML)", en: "Pasargad private key (XML)" },
    secret: true,
    kind: "multiline",
    hint: { fa: "محتوای فایل کلید <RSAKeyValue> که بانک داده است.", en: "Contents of the <RSAKeyValue> key file issued by the bank." },
  },
  { key: "ZARINPAL_MERCHANT_ID", group: "payment", label: { fa: "مرچنت زرین‌پال", en: "Zarinpal merchant ID" }, secret: true },
  { key: "PLATFORM_IBAN", group: "payment", label: { fa: "شبای پلتفرم (سهم کارمزد در تسهیم)", en: "Platform Sheba (fee share in splits)" } },
  { key: "PLATFORM_FEE_PERCENT", group: "payment", label: { fa: "کارمزد پلتفرم (درصد)", en: "Platform fee (%)" }, kind: "number" },
  { key: "POSTEX_BASE_URL", group: "shipping", label: { fa: "آدرس API پستکس", en: "Postex API address" }, kind: "url" },
  { key: "POSTEX_API_KEY", group: "shipping", label: { fa: "کلید API پستکس", en: "Postex API key" }, secret: true },
  { key: "TIPAX_BASE_URL", group: "shipping", label: { fa: "آدرس API تیپاکس", en: "Tipax API address" }, kind: "url" },
  { key: "TIPAX_API_KEY", group: "shipping", label: { fa: "کلید API تیپاکس", en: "Tipax API key" }, secret: true },
  { key: "SMS_PROVIDER", group: "sms", label: { fa: "سرویس پیامک", en: "SMS provider" }, options: ["console", "kavenegar"], hint: { fa: "console فقط در لاگ سرور چاپ می‌کند (تست).", en: "console only prints to the server log (testing)." } },
  { key: "KAVENEGAR_API_KEY", group: "sms", label: { fa: "کلید API کاوه‌نگار", en: "Kavenegar API key" }, secret: true },
  { key: "KAVENEGAR_SENDER", group: "sms", label: { fa: "شماره خط ارسال کاوه‌نگار", en: "Kavenegar sender line" }, hint: { fa: "خالی = خط پیش‌فرض حساب.", en: "Empty = the account's default line." } },
  {
    key: "KAVENEGAR_OTP_TEMPLATE",
    group: "sms",
    label: { fa: "قالب کد تایید (Verify Lookup)", en: "OTP template (Verify Lookup)" },
    hint: { fa: "نام قالب تاییدشده در پنل کاوه‌نگار؛ کدهای ورود با این قالب ارسال می‌شوند.", en: "Approved template name in Kavenegar; login codes are sent with it." },
  },
  { key: "KAVENEGAR_BASE_URL", group: "sms", label: { fa: "آدرس API کاوه‌نگار", en: "Kavenegar API address" }, kind: "url", hint: { fa: "پیش‌فرض: https://api.kavenegar.com", en: "Default: https://api.kavenegar.com" } },
  {
    key: "ENAMAD_META",
    group: "site",
    label: { fa: "کد متای اینماد", en: "eNamad meta code" },
    hint: { fa: "مقدار content تگ <meta name=\"enamad\"> که اینماد برای تایید دامنه می‌دهد.", en: "The content of the <meta name=\"enamad\"> tag eNamad gives for domain verification." },
  },
  {
    key: "ENAMAD_HTML",
    group: "site",
    label: { fa: "کد HTML نماد اعتماد", en: "Trust seal HTML" },
    kind: "multiline",
    hint: { fa: "کد نشانی که اینماد می‌دهد؛ در فوتر سایت نمایش داده می‌شود. تا وقتی خالی است، نشان پیش‌فرض با لینک زیر نمایش داده می‌شود.", en: "The badge code eNamad gives; shown in the site footer. Until set, the default badge with the link below is shown." },
  },
  { key: "TRUST_BADGE_URL", group: "site", label: { fa: "لینک نشان اعتماد", en: "Trust badge link" }, kind: "url" },
  { key: "TRUST_BADGE_IMAGE", group: "site", label: { fa: "تصویر نشان (اختیاری)", en: "Badge image (optional)" }, kind: "url", hint: { fa: "خالی = نشان طراحی‌شده خود سایت.", en: "Empty = the site's own badge." } },
  { key: "SITE_HEAD_HTML", group: "site", label: { fa: "کد اضافه در head (متاهای سفارشی)", en: "Extra head HTML (custom meta tags)" }, kind: "multiline", hint: { fa: "فقط تگ‌های meta و link پذیرفته می‌شوند.", en: "Only meta and link tags are accepted." } },
  { key: "TELEGRAM_BOT_TOKEN", group: "notify", label: { fa: "توکن ربات تلگرام", en: "Telegram bot token" }, secret: true },
];
const DEFS = new Map(SETTINGS.map((d) => [d.key, d]));
export type SettingKey = (typeof SETTINGS)[number]["key"];

const KEY = createHash("sha256").update(`${env.COOKIE_SECRET}:platform-settings`).digest();

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64")}`;
}

export function unseal(sealed: string) {
  const raw = Buffer.from(sealed.replace(/^v1:/, ""), "base64");
  const d = createDecipheriv("aes-256-gcm", KEY, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

let cache = new Map<string, string>();
let loadedAt = 0;
const TTL = 15_000;
let db: Database | null = null;

/** Load saved values; call once at boot (API and worker). Reloads every 15s so all processes converge. */
export async function initPlatformSettings(database: Database) {
  db = database;
  await reload();
  setInterval(() => void reload().catch(() => {}), TTL).unref();
}

async function reload() {
  if (!db) return;
  const rows = await db.select().from(platformSettings);
  const next = new Map<string, string>();
  for (const r of rows) {
    try {
      next.set(r.key, r.secret ? unseal(r.value) : r.value);
    } catch {
      console.error(`[platform] could not decrypt ${r.key} (COOKIE_SECRET changed?)`);
    }
  }
  cache = next;
  loadedAt = Date.now();
  try {
    applyPlanOverrides(JSON.parse(next.get("PLANS") ?? "{}"));
  } catch {
    console.error("[platform] stored plan overrides are not valid JSON");
  }
}

/** Current value: panel setting, else environment variable. */
export function cfg(key: SettingKey): string | undefined {
  const v = cache.get(key);
  if (v !== undefined && v !== "") return v;
  const e = (env as Record<string, unknown>)[key];
  return e === undefined || e === null || e === "" ? undefined : String(e);
}

export const cfgNumber = (key: SettingKey, fallback: number) => {
  const n = Number(cfg(key));
  return Number.isFinite(n) && cfg(key) !== undefined ? n : fallback;
};

/** For the admin form: never the secret itself, only whether it is set and where from. */
export function describeSettings() {
  return SETTINGS.map((d) => {
    const saved = cache.get(d.key);
    const value = cfg(d.key);
    return {
      ...d,
      source: saved ? "panel" : value !== undefined ? "env" : "unset",
      value: d.secret ? null : (value ?? ""),
      preview: d.secret && value ? `••••${value.slice(-4)}` : null,
    };
  });
}

/** Save values from the admin form; empty string clears the panel value (env fallback applies again). */
export async function saveSettings(database: Database, values: Record<string, string | null | undefined>, userId: string) {
  for (const [key, raw] of Object.entries(values)) {
    const def = DEFS.get(key);
    if (!def || raw === undefined || raw === null) continue;
    const v = raw.trim();
    if (def.options && v && !def.options.includes(v)) throw new Error(`${key}: must be one of ${def.options.join(", ")}`);
    if (def.kind === "url" && v && !/^https?:\/\//.test(v)) throw new Error(`${key}: must be a URL`);
    if (def.kind === "number" && v && !Number.isFinite(Number(v))) throw new Error(`${key}: must be a number`);
    if (!v) {
      await database.delete(platformSettings).where(eqKey(key));
      continue;
    }
    const value = def.secret ? seal(v) : v;
    await database
      .insert(platformSettings)
      .values({ key, value, secret: Boolean(def.secret), updatedBy: userId })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, secret: Boolean(def.secret), updatedBy: userId, updatedAt: new Date() } });
  }
  db ??= database;
  await reload();
}

const eqKey = (key: string) => eq(platformSettings.key, key);

export const settingsLoadedAt = () => loadedAt;

/** Super admin's plan table edits (prices, limits, features); empty object restores the defaults. */
export async function savePlanOverrides(database: Database, overrides: Partial<Record<PlanId, PlanOverride>>, userId: string) {
  const value = JSON.stringify(overrides);
  await database
    .insert(platformSettings)
    .values({ key: "PLANS", value, secret: false, updatedBy: userId })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
  db ??= database;
  await reload();
}

export const planOverrides = (): Partial<Record<PlanId, PlanOverride>> => {
  try {
    return JSON.parse(cache.get("PLANS") ?? "{}");
  } catch {
    return {};
  }
};
