// language: TSX, file: apps/store/src/app/page.tsx, target: Next.js App Router
// Homepage comercial enxuta: Hero focado → Departamentos → Produtos → Rodapé.
// Orientação, confiança e guias vivem em /por-que-comprar (entrada no rodapé).
import Image from "next/image";
import Link from "next/link";
import { Header } from "./components/Header";
import { ProductCard } from "./components/ProductCard";
import { SiteFooter } from "./components/SiteFooter";

import {
  API_URL,
  formatBRL,
  installmentsFor,
  pixPrice,
  storeGet,
  type CommercialSettings,
  type StoreHome,
  type StoreProduct,
  type StoreDepartment,
} from "./lib/store";

export const dynamic = "force-dynamic";

function SectionHead({
  kicker,
  title,
  href,
  label,
}: {
  kicker?: string;
  title: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="sec-head">
      <div>
        {kicker && <span className="sec-kicker">{kicker}</span>}
        <h2 className="sec-title">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="sec-link">
          {label ?? "Ver tudo"}
        </Link>
      )}
    </div>
  );
}

function productsForSection(home: StoreHome, kind: string): StoreProduct[] {
  switch (kind) {
    case "news":
      return home.news;
    case "featured":
      return home.featured;
    case "bestsellers":
      return home.bestsellers;
    case "promo":
      return home.sale;
    default:
      return [];
  }
}

function formatInstallments(priceCents: number, settings: { installments?: number; installment_interest_free?: boolean; min_installment_cents?: number }) {
  const max = Math.max(1, settings.installments ?? 1);
  const min = settings.min_installment_cents ?? 0;
  let count = max;
  while (count > 1 && Math.ceil(priceCents / count) < min) count--;
  return { count, valueCents: count > 0 ? Math.ceil(priceCents / count) : 0, interestFree: settings.installment_interest_free !== false };
}

export default async function HomePage() {
  const home = await storeGet<StoreHome>(`${API_URL}/api/store/home`, {
    banners: [],
    sections: [],
    departments: [],
    brands: [],
    featured: [],
    news: [],
    sale: [],
    bestsellers: [],
    settings: {
      pix_discount_percent: 0,
      installments: 1,
      installment_interest_free: false,
      min_installment_cents: 0,
      free_shipping_from_cents: 0,
      shipping_carriers: [],
      whatsapp: "",
      email: "",
      address: { street: "", district: "", city: "", state: "", zip: "" },
      service_hours: "",
      social: { instagram: "", whatsapp: "" },
      announcement: "",
    },
    totals: { products: 0 },
  });

  const settingsFromHome = home.settings ?? ({} as CommercialSettings);
  const settings = {
    ...settingsFromHome,
    address: settingsFromHome.address ?? ({} as CommercialSettings["address"]),
  };
  const hero = home.banners[0] ?? null;
  const freeShipping = settings?.free_shipping_from_cents ?? 0;
  const pixPercent = settings?.pix_discount_percent ?? 0;
  const inst = settings?.installments ?? 1;

  // Hero usa apenas o primeiro banner ativo
  // Se tiver imageUploadId, usa o endpoint de serve da API; senão cai no imageDesktop (URL externa/legado)
  const heroImage = hero?.imageUploadId
    ? `/api/banners/image/${hero.imageUploadId}`
    : hero?.imageDesktop || "/produtos/e0c3dc6a62a7f830.webp";
  const heroContent = hero ? {
    title: hero.title || "Equipamento para jogar com segurança e confiança",
    subtitle: hero.subtitle || "Airsoft, tiro esportivo e equipamentos táticos. Entrega para todo o Brasil.",
    ctaLabel: hero.ctaLabel || "Ver catálogo",
    link: hero.link || "/catalogo",
    image: heroImage,
  } : null;

  return (
    <main id="conteudo" className="page-shell">
      <Header departments={home.departments} />

      {/* ============================================================
           HERO FOCADO — uma mensagem, um CTA, imagem à direita
           ============================================================ */}
      {heroContent && (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__grid">
            <div className="hero__copy">
              <h1 id="hero-title" className="hero__title">
                {heroContent.title}
              </h1>
              <p className="hero__sub">{heroContent.subtitle}</p>
              <div className="hero__facts">
                {freeShipping > 0 && (
                  <span className="hero__fact">
                    Frete grátis acima de {formatBRL(freeShipping)} · {settings.shipping_carriers[0] ?? "Correios PAC/SEDEX"}
                  </span>
                )}
                {pixPercent > 0 && (
                  <span className="hero__fact">
                    PIX −{pixPercent}% na hora · Aprovação imediata
                  </span>
                )}
                {inst > 1 && (
                  <span className="hero__fact">
                    {inst}x sem juros no cartão
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
                <Link href={heroContent.link} className="btn-primary btn-lg">
                  {heroContent.ctaLabel}
                </Link>
                <Link href="/catalogo" className="btn-secondary hero__secondary">
                  Ver catálogo completo
                </Link>
              </div>
            </div>
            <div className="hero__image">
              <Image
                src={heroContent.image}
                alt={heroContent.title}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 560px"
                className="hero__img"
              />
            </div>
          </div>
        </section>
      )}

      {/* ============================================================
           CATEGORIAS VISUAIS — 6 a 8 entradas com imagem
           ============================================================ */}
      {home.departments.length > 0 && (
        <section className="block" aria-labelledby="departamentos-title">
          <div className="sec-head">
            <div>
              <span className="sec-kicker">Escolha pelo sistema</span>
              <h2 id="departamentos-title" className="sec-title">Departamentos</h2>
            </div>
            <Link href="/catalogo" className="sec-link">Catálogo completo</Link>
          </div>
          <ul className="dept-cards">
            {home.departments.slice(0, 8).map((dept) => (
              <li key={dept.id}>
                <Link href={`/departamento/${dept.slug}`} className="dept-card">
                  {dept.imageUrl && (
                    <span className="dept-card__media">
                      <Image
                        src={dept.imageUrl}
                        alt={dept.name}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className="dept-card__img"
                      />
                    </span>
                  )}
                  <span className="dept-card__body">
                    <strong>{dept.name}</strong>
                    <em>{dept.children.length} categorias</em>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ============================================================
           PRODUTOS EM DESTAQUE — novidades e mais vendidos
           ============================================================ */}
      {(home.featured.length > 0 || home.news.length > 0 || home.bestsellers.length > 0) && (
        <>
          {home.featured.length > 0 && (
            <section className="block" aria-labelledby="selecao-title">
              <div className="sec-head">
                <div>
                  <span className="sec-kicker">Seleção da loja</span>
                  <h2 id="selecao-title" className="sec-title">Destaques</h2>
                </div>
                <Link href="/catalogo" className="sec-link">Ver tudo</Link>
              </div>
              <ul className="product-grid">
                {home.featured.slice(0, 8).map((product) => (
                  <ProductCard key={product.id} product={product} settings={settings} />
                ))}
              </ul>
            </section>
          )}

          {home.news.length > 0 && (
            <section className="block block--border" aria-labelledby="novidades-title">
              <div className="sec-head">
                <div>
                  <span className="sec-kicker">Chegou agora</span>
                  <h2 id="novidades-title" className="sec-title">Novidades</h2>
                </div>
                <Link href="/catalogo" className="sec-link">Ver tudo</Link>
              </div>
              <ul className="product-grid">
                {home.news.slice(0, 8).map((product) => (
                  <ProductCard key={product.id} product={product} settings={settings} />
                ))}
              </ul>
            </section>
          )}

          {home.bestsellers.length > 0 && (
            <section className="block block--border" aria-labelledby="mais-vendidos-title">
              <div className="sec-head">
                <div>
                  <span className="sec-kicker">Mais procurados</span>
                  <h2 id="mais-vendidos-title" className="sec-title">Mais vendidos</h2>
                </div>
                <Link href="/catalogo" className="sec-link">Ver tudo</Link>
              </div>
              <ul className="product-grid">
                {home.bestsellers.slice(0, 8).map((product) => (
                  <ProductCard key={product.id} product={product} settings={settings} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <SiteFooter settings={settings} />
    </main>
  );
}