import type { NextConfig } from "next";
import { resolve } from "node:path";

const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const dev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy. Inline scripts are needed for the theme bootstrap; eNamad / Samandehi trust
 * seals load from their own hosts. Images may come from Instagram's CDN or shop uploads over https.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://trustseal.enamad.ir https://logo.samandehi.ir`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: http://localhost:*" : ""}`,
  "frame-src 'self' https://trustseal.enamad.ir https://logo.samandehi.ir",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  output: "standalone",
  // trace files from the monorepo root so workspace packages land in the standalone bundle
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  poweredByHeader: false,
  transpilePackages: ["@shopino/shared"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // the browser talks to the API through the web origin: first-party cookies, no CORS
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
  // the service worker must never be cached, or users keep an old one
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // hashed build assets never change
      { source: "/_next/static/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
