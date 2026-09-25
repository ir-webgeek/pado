import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().default(20),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
  /** Public base URL of this API (payment callbacks). Defaults to the web URL, which proxies /api. */
  PUBLIC_API_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  OTP_DEV_ECHO: bool.default(false),

  ANTHROPIC_API_KEY: z.string().optional(),
  AGENT_MODEL: z.string().default("claude-opus-5"),
  AGENT_PRICE_IN_PER_MTOK: z.coerce.number().default(500_000),
  AGENT_PRICE_OUT_PER_MTOK: z.coerce.number().default(2_500_000),
  AGENT_MIN_BALANCE: z.coerce.number().default(2_000),

  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().default("shopino-verify"),
  META_GRAPH_VERSION: z.string().default("v25.0"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),

  PAYMENT_PROVIDER: z.enum(["mock", "zarinpal"]).default("mock"),
  ZARINPAL_MERCHANT_ID: z.string().optional(),
  ZARINPAL_SANDBOX: bool.default(true),

  SMS_PROVIDER: z.enum(["console"]).default("console"),
  SMS_COST_PER_PART: z.coerce.number().default(150),

  UPLOAD_DIR: z.string().default("./uploads"),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  // treat empty strings from .env as unset
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Invalid environment:", z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();
export const isProd = env.NODE_ENV === "production";
export const publicApiUrl = () => env.PUBLIC_API_URL ?? `${env.PUBLIC_WEB_URL}/api`;
