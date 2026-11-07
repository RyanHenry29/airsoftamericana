// language: TSX, file: apps/store/src/app/robots.ts, target: Next.js App Router
// Mesma política do GM TÁTICO: fora do índice vão compra, conta e busca.
import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://airsoftamericana.com.br";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/cart", "/checkout", "/conta", "/entrar", "/cadastro", "/admin", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
