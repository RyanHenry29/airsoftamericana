// language: TS, file: apps/store/next.config.ts, target: Next.js App Router
import type { NextConfig } from "next";

const API_ORIGIN =
  process.env.API_PROXY_TARGET?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  "https://airsoftamericana-api.vercel.app";

const nextConfig: NextConfig = {
  images: {
    // 90 = logo do header (nitidez no downscale 1254→84); 75 = padrão do resto.
    qualities: [75, 90],
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
  async rewrites() {
    // Proxy same-origin /api/* to the Fastify API so cookies (aa_customer, aa_cart)
    // work without cross-site SameSite issues in production.
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN.replace(/\/+$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
