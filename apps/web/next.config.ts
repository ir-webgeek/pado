import type { NextConfig } from "next";
import { resolve } from "node:path";

const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

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
