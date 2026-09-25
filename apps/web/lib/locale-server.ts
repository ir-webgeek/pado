import { cookies } from "next/headers";
import { translator, type Locale } from "./i18n";

export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get("lang")?.value;
  return c === "en" ? "en" : "fa";
}

export async function getT() {
  const locale = await getLocale();
  return { locale, t: translator(locale) };
}
