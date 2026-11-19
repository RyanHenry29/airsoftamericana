import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://airsoftamericana.vercel.app").replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Telas de app, nunca conteúdo: o painel e a API. Carrinho, checkout
        // e conta ficam FORA daqui de propósito — eles se excluem do índice
        // com noindex na própria página (canonical próprio, robots noindex),
        // e bloquear em robots.txt esconderia essa diretiva do Googlebot:
        // a URL apareceria indexada como "bloqueada por robots.txt".
        // /busca segue a mesma regra.
        disallow: ["/admin", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
