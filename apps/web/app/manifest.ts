import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/panel",
    name: "شاپینو | فروشگاه و نوبت‌دهی",
    short_name: "شاپینو",
    description: "پنل فروش، نوبت‌دهی و ایجنت دایرکت اینستاگرام",
    lang: "fa",
    dir: "rtl",
    start_url: "/panel",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0916",
    theme_color: "#0b0916",
    categories: ["business", "productivity", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "نوبت‌ها", url: "/panel/appointments", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "سفارش‌ها", url: "/panel/orders", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "دایرکت‌ها", url: "/panel/inbox", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
