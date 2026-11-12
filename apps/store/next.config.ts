// language: TS, file: apps/store/next.config.ts, target: Next.js App Router
import type { NextConfig } from "next";

const API_ORIGIN =
  process.env.API_PROXY_TARGET?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  "https://airsoftamericana-api.vercel.app";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 90],
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
    ];
  },
  async redirects() {
    return [
      // A seção de departamentos saiu do site: o slug antigo é slug de
      // categoria (mesma árvore) — 308 direto para o catálogo filtrado.
      {
        source: "/departamento/:slug",
        destination: "/catalogo?categoria=:slug",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN.replace(/\/+$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
