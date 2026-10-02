import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { dirOf } from "@/lib/i18n";
import { DmRefTracker } from "@/components/dm-ref";
import { PwaSetup } from "@/components/pwa";
import { LocaleProvider } from "@/lib/locale-client";
import { getT } from "@/lib/locale-server";
import "./globals.css";

const vazirmatn = localFont({ src: "./Vazirmatn.woff2", variable: "--font-vazirmatn", display: "swap", weight: "100 900" });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { default: `${t("brand.name")} | ${t("brand.tagline")}`, template: `%s | ${t("brand.name")}` },
    description: t("hero.sub"),
    applicationName: t("brand.name"),
    appleWebApp: { capable: true, title: t("brand.name"), statusBarStyle: "black-translucent" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0916" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Runs before paint so the theme never flashes. "day"/"night" are explicit choices; anything else
// follows the OS and keeps following it when the OS switches.
const themeScript = `document.documentElement.classList.add("js");try{var d=document.documentElement,m=matchMedia("(prefers-color-scheme: light)");window.__applyTheme=function(){var t=localStorage.getItem("theme");d.dataset.theme=t==="day"||t==="night"?t:m.matches?"day":"night"};__applyTheme();m.addEventListener("change",__applyTheme)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getT();
  return (
    <html lang={locale} dir={dirOf(locale)} className={vazirmatn.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <PwaSetup />
        <DmRefTracker />
      </body>
    </html>
  );
}
