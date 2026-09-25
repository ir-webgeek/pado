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
};

export default nextConfig;
