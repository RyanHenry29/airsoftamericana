import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

// Proxy /api/* → API (mesmo padrão da loja): o painel fala com a API na mesma
// origem — cookie de sessão first-party, sem CORS e sem depender de env var
// embutida no build (NEXT_PUBLIC ausente derrubava o login apontando para
// localhost:4000). Em dev aponta para a API local; em produção, para a URL da
// API (API_PROXY_TARGET/NEXT_PUBLIC_API_URL sobrescrevem quando existirem).
const API_ORIGIN =
  process.env.API_PROXY_TARGET?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  (process.env.NODE_ENV === "production"
    ? "https://airsoftamericana-api.vercel.app"
    : "http://localhost:4000");

const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN.replace(/\/+$/, "")}/api/:path*` }];
  },
};

export default config;
