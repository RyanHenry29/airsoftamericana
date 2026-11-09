// language: TSX, file: apps/store/src/app/page.tsx, target: Next.js App Router
// Homepage comercial: hero full-bleed com foto, chips de benefício, faixa de
// departamentos, blocos com imagem e grades densas. Tudo alimentado por /api/store/home.
import Image from "next/image";
import Link from "next/link";
import { Header } from "./components/Header";
import { MegaMenu } from "./components/MegaMenu";
import { ProductCard } from "./components/ProductCard";
import { Footer } from "./components/Footer";
import { NewsletterForm } from "./components/NewsletterForm";
// ícones decorativos removidos (cara de IA / template) — foco em texto e dados reais.
import {
  API_URL,
  formatBRL,
  storeGet,
  type StoreHome,
  type StoreProduct,
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

/** Escolhe a vitrine de cada seção pelo tipo — os dados vêm sempre da API. */
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

  const { settings } = home;
  const hero = home.banners[0] ?? null;
  const sections = home.sections.length > 0 ? home.sections : [];
  const freeShipping = settings.free_shipping_from_cents;
  const pixPercent = settings.pix_discount_percent;
  const inst = settings.installments;

  const benefits = [
    {
      title: freeShipping > 0 ? `Frete grátis acima de ${formatBRL(freeShipping)}` : "Entrega para todo o Brasil",
      sub: settings.shipping_carriers.length > 0 ? settings.shipping_carriers.join(" / ") : "Frete calculado por CEP no checkout",
    },
    ...(pixPercent > 0
      ? [{ title: `PIX −${pixPercent}%`, sub: "Desconto no pagamento à vista" }]
      : []),
    ...(inst > 1
      ? [{ title: `${inst}x sem juros`, sub: "Cartão de crédito" }]
      : []),
    ...(settings.address.city
      ? [{ title: `Loja física em ${settings.address.city}${settings.address.state ? `-${settings.address.state}` : ""}`, sub: settings.service_hours || "Consulte o horário de atendimento" }]
      : []),
  ];

  return (
    <main id="conteudo" className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

      {/* HERO — padrão comercial: texto pesado à esquerda, confiança e CTA, imagem à direita */}
      {hero && (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__grid">
            <div className="hero__copy">
              {hero.eyebrow && (
                <span className="hero__eyebrow">{hero.eyebrow}</span>
              )}
              <h1 id="hero-title" className="hero__title">
                {hero.title}
              </h1>
              {hero.subtitle && (
                <p className="hero__sub">{hero.subtitle}</p>
              )}
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
              {hero.ctaLabel && (
                <Link href={hero.link ?? "/catalogo"} className="btn-primary btn-lg">
                  {hero.ctaLabel}
                </Link>
              )}
              {hero.link && (
                <Link
                  href="/catalogo"
                  className="btn-secondary hero__secondary"
                >
                  Ver catálogo completo
                </Link>
              )}
            </div>
            <div className="hero__image">
              <Image
                src={hero.imageDesktop ?? "/produtos/e0c3dc6a62a7f830.webp"}
                alt={hero.title}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 560px"
                className="hero__img"
              />
            </div>
          </div>
        </section>
      )}

      {/* CHIPS DE BENEFÍCIO */}
      <section className="chips" aria-label="Condições comerciais">
        <ul className="chips__row">
          {benefits.map((b) => (
            <li key={b.title} className="chip">
              <span>
                <strong>{b.title}</strong>
                <em>{b.sub}</em>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* FAIXA DE DEPARTAMENTOS */}
      {home.departments.length > 0 && (
        <section className="dept-strip" aria-label="Departamentos">
          <ul className="dept-strip__row">
            {home.departments.map((dept) => (
              <li key={dept.id}>
                <Link href={`/departamento/${dept.slug}`} className="dept-strip__item">
                  {dept.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/catalogo" className="dept-strip__item dept-strip__item--all">
                Todos os produtos
</Link>
            </li>
          </ul>
        </section>
      )}

      {/* SEÇÕES ADMINISTRÁVEIS — ordem e ativação vêm de homepage_sections */}
      {sections.map((section) => {
        if (section.kind === "hero" || section.kind === "benefits") return null;

        if (section.kind === "departments") {
          return (
            <section key={section.id} className="block">
              <SectionHead
                kicker="Escolha pelo sistema"
                title={section.title || "Departamentos"}
                href="/catalogo"
                label="Catálogo completo"
              />
              <ul className="dept-cards">
                {home.departments.map((dept) => (
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
          );
        }

        if (section.kind === "brands") {
          const brands = home.brands.filter((b) => b.productCount > 0);
          if (brands.length === 0) return null;
          return (
            <section key={section.id} className="block block--border">
              <SectionHead kicker="Fabricantes que trabalham com a gente" title={section.title || "Marcas"} />
              <ul className="brand-grid">
                {brands.map((brand) => (
                  <li key={brand.id}>
                    <Link href={`/marca/${brand.slug}`} className="brand-tile">
                      <span className="brand-tile__name">{brand.name}</span>
                      <span className="brand-tile__count">{brand.productCount} produtos</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        }

        if (section.kind === "institutional") {
          return (
            <section key={section.id} className="block block--border">
              <div className="inst">
                <div className="inst__copy">
                  <span className="sec-kicker">Loja física</span>
                  <h2 className="sec-title">
                    {settings.address.city || "Americana"}{settings.address.state ? `/${settings.address.state}` : ""}
                  </h2>
                  {settings.address.street ? (
                    <p>
                      {settings.address.street}
                      {settings.address.district ? ` — ${settings.address.district}` : ""}
                      {settings.address.zip ? ` · CEP ${settings.address.zip}` : ""}
                    </p>
                  ) : null}
                  {settings.service_hours ? <p>{settings.service_hours}</p> : null}
                  <div className="inst__actions">
                    <Link href="/institucional" className="btn-primary">
                      Conhecer a loja
                    </Link>
                    <Link href="/atendimento" className="btn-secondary">
                      Falar com a gente
                    </Link>
                  </div>
                </div>
                <ul className="inst__facts">
                  <li>
                    <span>
                      <strong>{home.totals.products}</strong> produtos no catálogo
                    </span>
                  </li>
                  <li>
                    <span>Entrega para todo o Brasil</span>
                  </li>
                  {settings.service_hours ? (
                    <li>
                      <span>
                        <strong>Atendimento</strong> {settings.service_hours}
                      </span>
                    </li>
                  ) : null}
                </ul>
              </div>
            </section>
          );
        }

        if (section.kind === "newsletter") {
          return (
            <section key={section.id} className="block block--border">
              <div className="newsletter-band">
                <div>
                  <span className="sec-kicker">Drops e reposição</span>
                  <h2 className="sec-title">Receba as novidades no seu e-mail</h2>
                </div>
                <NewsletterForm />
              </div>
            </section>
          );
        }

        const products = productsForSection(home, section.kind);
        if (products.length === 0) return null;

        return (
          <section key={section.id} className="block">
            <SectionHead
              kicker={section.subtitle}
              title={section.title}
              href="/catalogo"
              label="Ver tudo"
            />
            <ul className="product-grid">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} settings={settings} />
              ))}
            </ul>
          </section>
        );
      })}

      <Footer settings={settings} />
    </main>
  );
}
