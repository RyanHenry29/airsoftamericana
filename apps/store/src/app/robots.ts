import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://airsoftamericana.vercel.app").replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Telas de app, nunca conteúdo: painel, carrinho/checkout/conta (URLs de
        // sessão) e a API. /busca fica FORA daqui de propósito — ela se exclui
        // do índice com noindex na própria página, e bloquear em robots.txt
        // esconderia o noindex do Googlebot.
        disallow: ["/admin", "/cart", "/checkout", "/conta", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
