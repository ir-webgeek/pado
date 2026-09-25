import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { dirOf } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/locale-client";
import { getT } from "@/lib/locale-server";
import "./globals.css";

const vazirmatn = localFont({ src: "./Vazirmatn.woff2", variable: "--font-vazirmatn", display: "swap", weight: "100 900" });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { default: `${t("brand.name")} | ${t("brand.tagline")}`, template: `%s | ${t("brand.name")}` },
    description: t("hero.sub"),
  };
}

export const viewport: Viewport = { themeColor: "#0b1120", width: "device-width", initialScale: 1 };

// applied before paint so the saved theme never flashes
const themeScript = `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getT();
  return (
    <html lang={locale} dir={dirOf(locale)} className={vazirmatn.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
