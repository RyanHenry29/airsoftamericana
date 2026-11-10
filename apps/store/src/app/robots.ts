import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://airsoftamericana.vercel.app";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/conta", "/checkout", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
