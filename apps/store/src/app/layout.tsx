// language: TSX, file: apps/store/src/app/layout.tsx, target: Next.js App Router
// Metadados completos + JSON-LD Organization/WebSite — corrige os furos que o GM TÁTICO tem
// (sem og, sem twitter:card, sem JSON-LD de marca, meta description com entity quebrado).
import "./globals.css";
import "./css/layout.css";
import "./css/home.css";
import "./css/catalog.css";
import "./css/pdp.css";
import "./css/pages.css";
import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, Inter } from "next/font/google";
import { CookieConsent } from "./components/CookieConsent";
import { API_URL, formatBRL } from "./lib/store";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://airsoftamericana.com.br";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

async function fetchSettings() {
  try {
    const res = await fetch(`${API_URL}/api/store/settings`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as { pix_discount_percent?: number; installments?: number; free_shipping_from_cents?: number; address?: { street?: string; district?: string; city?: string; state?: string; zip?: string }; service_hours?: string; email?: string };
  } catch {
    return null;
  }
}

export async function generateMetadata() {
  const s = await fetchSettings();
  const pix = s?.pix_discount_percent ?? 0;
  const inst = s?.installments ?? 1;
  const free = s?.free_shipping_from_cents ?? 0;
  const pixBit = pix > 0 ? `PIX −${pix}% à vista, ` : "";
  const shipBit = free > 0 ? `frete grátis acima de ${formatBRL(free)}, ` : "";
  const baseDesc = `Réplicas de airsoft, carabinas de pressão, upgrades, loadout e equipamentos táticos. ${pixBit}${shipBit}3x sem juros e envio para todo o Brasil.`.replace(/, $/, ". ");
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: "Airsoft Americana",
      template: "%s | Airsoft Americana",
    },
    description: baseDesc,
    keywords: ["airsoft", "réplica airsoft", "AEG", "GBBR", "tiro esportivo", "carabina de pressão", "equipamento tático", "loadout"],
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      url: SITE_URL,
      siteName: "Airsoft Americana",
      title: "Airsoft Americana",
      description: `Airsoft, tiro esportivo e equipamentos táticos. ${pixBit}${inst}x sem juros e envio nacional.`,
      // og:image / og:image:alt vêm da convenção app/opengraph-image.tsx (1200×630),
      // não do logo quadrado do site antigo.
    },
    twitter: {
      card: "summary_large_image",
      title: "Airsoft Americana",
      description: `Airsoft, tiro esportivo e equipamentos táticos. ${pixBit}envio nacional.`,
    },
    robots: { index: true, follow: true },
  };
}

const orgJsonLd = async () => {
  const s = await fetchSettings();
  const addr = s?.address;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Airsoft Americana",
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    address: {
      "@type": "PostalAddress",
      streetAddress: addr?.street ?? "Rua Celinda Antônia Quaino Santa Rosa, 157, Jardim Luciane",
      addressLocality: addr?.city ?? "Americana",
      addressRegion: addr?.state ?? "SP",
      postalCode: addr?.zip ?? "13477-225",
      addressCountry: "BR",
    },
    ...(s?.service_hours ? { openingHours: s.service_hours } : null),
    ...(s?.email ? { email: s.email } : null),
  };
};

const siteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Airsoft Americana",
  url: SITE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE_URL}/catalogo?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const org = await orgJsonLd();
  return (
    <html lang="pt-BR">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} bg-background font-sans antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
