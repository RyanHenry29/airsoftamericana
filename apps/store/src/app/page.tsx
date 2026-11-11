// language: TSX, file: apps/store/src/app/page.tsx, target: Next.js App Router
// Homepage dirigida pelo CMS: a ordem e a ativação das seções vêm de
// /api/store/home (homepage_sections). Títulos são editáveis no admin, com
// fallback real; vitrines sem seção declarada entram após a última seção de
// produtos. Zero dado inventado: tudo sai do banco ou da configuração da loja.
import Image from "next/image";
import Link from "next/link";
import { Header } from "./components/Header";
import { ProductCard } from "./components/ProductCard";
import { SiteFooter } from "./components/SiteFooter";

import {
  API_URL,
  storeGet,
  type CommercialSettings,
  type StoreHome,
  type StoreProduct,
} from "./lib/store";

export const dynamic = "force-dynamic";

type SectionRow = StoreHome["sections"][number];

/** Seções de fallback quando a API não responde (espelha o seed do CMS). */
const DEFAULT_SECTIONS: SectionRow[] = [
  { id: "fb-hero", kind: "hero", title: "Campanha principal", subtitle: "", position: 0, config: {} },
  { id: "fb-departments", kind: "departments", title: "Departamentos", subtitle: "", position: 1, config: {} },
  { id: "fb-featured", kind: "featured", title: "Destaques", subtitle: "", position: 2, config: {} },
  { id: "fb-news", kind: "news", title: "Novidades", subtitle: "", position: 3, config: {} },
  { id: "fb-bestsellers", kind: "bestsellers", title: "Mais vendidos", subtitle: "", position: 4, config: {} },
  { id: "fb-sale", kind: "sale", title: "Promoções", subtitle: "", position: 5, config: {} },
];

const PRODUCT_KINDS = new Set(["featured", "news", "bestsellers", "sale", "promo"]);
const EXTRA_VITRINES = ["news", "bestsellers", "sale"] as const;

/** Vitrines por kind — kicker/título de fallback; o título da seção vence. */
function vitrineFor(kind: string, home: StoreHome): { kicker: string; title: string; products: StoreProduct[] } | null {
  switch (kind) {
    case "featured":
      return { kicker: "Seleção da loja", title: "Destaques", products: home.featured };
    case "news":
      return { kicker: "Chegou agora", title: "Novidades", products: home.news };
    case "bestsellers":
      return { kicker: "Mais procurados", title: "Mais vendidos", products: home.bestsellers };
    case "sale":
    case "promo":
      return { kicker: "Ofertas por tempo", title: "Promoções", products: home.sale };
    default:
      return null;
  }
}

function SectionHead({
  id,
  kicker,
  title,
  href,
  label,
}: {
  id?: string;
  kicker?: string;
  title: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="sec-head">
      <div>
        {kicker && <span className="sec-kicker">{kicker}</span>}
        <h2 id={id} className="sec-title">
          {title}
        </h2>
      </div>
      {href && (
        <Link href={href} className="sec-link">
          {label ?? "Ver tudo"}
        </Link>
      )}
    </div>
  );
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
  const sections = home.sections.length > 0 ? home.sections : DEFAULT_SECTIONS;

  // Hero usa apenas o primeiro banner ativo
  // Se tiver imageUploadId, usa o endpoint de serve da API; senão cai no imageDesktop (URL externa/legado)
  const heroImage = hero?.imageUploadId
    ? `/api/banners/image/${hero.imageUploadId}`
    : hero?.imageDesktop || "/produtos/e0c3dc6a62a7f830.webp";
  const heroContent = hero
    ? {
        title: hero.title || "Equipamento para jogar com segurança e confiança",
        subtitle: hero.subtitle || "Airsoft, tiro esportivo e equipamentos táticos. Entrega para todo o Brasil.",
        ctaLabel: hero.ctaLabel || "Ver catálogo",
        link: hero.link || "/catalogo",
        image: heroImage,
      }
    : null;

  const limitOf = (s: SectionRow) => {
    const n = Number(s.config?.limit);
    return Number.isFinite(n) && n > 0 ? n : 8;
  };

  function renderProductSection(section: SectionRow, key: string) {
    const vitrine = vitrineFor(section.kind, home);
    if (!vitrine || vitrine.products.length === 0) return null;
    const id = `${section.kind}-title`;
    return (
      <section key={key} className="block" aria-labelledby={id}>
        <SectionHead
          id={id}
          kicker={vitrine.kicker}
          title={section.title?.trim() || vitrine.title}
          href="/catalogo"
          label="Ver tudo"
        />
        <ul className="product-grid">
          {vitrine.products.slice(0, limitOf(section)).map((product) => (
            <ProductCard key={product.id} product={product} settings={settings} />
          ))}
        </ul>
      </section>
    );
  }

  function renderSection(section: SectionRow, index: number): React.ReactNode[] {
    const key = `${section.kind}-${section.id ?? index}`;

    switch (section.kind) {
      case "hero":
        if (!heroContent) return [];
        return [
          <section key={key} className="hero" aria-labelledby="hero-title">
            <div className="hero__grid">
              <div className="hero__copy">
                <h1 id="hero-title" className="hero__title">
                  {heroContent.title}
                </h1>
                <p className="hero__sub">{heroContent.subtitle}</p>
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
          </section>,
        ];

      case "departments":
        if (home.departments.length === 0) return [];
        return [
          <section key={key} className="block" aria-labelledby="departamentos-title">
            <SectionHead
              id="departamentos-title"
              kicker="Escolha pelo sistema"
              title={section.title?.trim() || "Departamentos"}
              href="/catalogo"
              label="Catálogo completo"
            />
            <ul className="dept-cards">
              {home.departments.slice(0, limitOf(section)).map((dept) => {
                const subs = dept.children.slice(0, 3);
                return (
                  <li key={dept.id}>
                    <Link href={`/departamento/${dept.slug}`} className="dept-card">
                      {dept.imageUrl ? (
                        <span className="dept-card__media">
                          <Image
                            src={dept.imageUrl}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                            className="dept-card__img"
                          />
                        </span>
                      ) : (
                        <span className="dept-card__media dept-card__media--type" aria-hidden="true">
                          <span className="dept-card__mono">{dept.name.charAt(0).toUpperCase()}</span>
                        </span>
                      )}
                      <span className="dept-card__body">
                        <strong>{dept.name}</strong>
                        {dept.productCount > 0 && <em>{dept.productCount} produtos</em>}
                        {subs.length > 0 && (
                          <span className="dept-card__subs">
                            {subs.map((s) => (
                              <span key={s.id}>{s.name}</span>
                            ))}
                            {dept.children.length > 3 && <span>+{dept.children.length - 3}</span>}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>,
        ];

      case "brands":
        if (home.brands.length === 0) return [];
        return [
          <section key={key} className="block" aria-labelledby="marcas-title">
            <SectionHead
              id="marcas-title"
              kicker="Quem a loja trabalha"
              title={section.title?.trim() || "Marcas"}
              href="/catalogo"
              label="Ver catálogo"
            />
            <ul className="brand-grid">
              {home.brands.slice(0, limitOf(section)).map((brand) => (
                <li key={brand.id}>
                  <Link href={`/marca/${brand.slug}`} className="brand-tile">
                    <span className="brand-tile__name">{brand.name}</span>
                    <span className="brand-tile__count">
                      {brand.productCount > 0 ? `${brand.productCount} produtos` : "Ver produtos"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>,
        ];

      default: {
        // kinds de vitrine renderizam pelo mapa; desconhecidos são ignorados
        const node = PRODUCT_KINDS.has(section.kind) ? renderProductSection(section, key) : null;
        return node ? [node] : [];
      }
    }
  }

  // Vitrines que o CMS não declarou (ex.: seed só traz "featured") continuam
  // visíveis: entram logo após a última seção de produtos (ou após os
  // departamentos/hero, se nenhuma vitrine estiver declarada).
  const declared = new Set(sections.map((s) => s.kind));
  const extras: React.ReactNode[] = [];
  for (const kind of EXTRA_VITRINES) {
    if (declared.has(kind)) continue;
    const auto: SectionRow = { id: `auto-${kind}`, kind, title: "", subtitle: "", position: -1, config: {} };
    const node = renderProductSection(auto, `auto-${kind}`);
    if (node) extras.push(node);
  }

  let injectAt = -1;
  sections.forEach((s, i) => {
    if (PRODUCT_KINDS.has(s.kind)) injectAt = i;
  });
  if (injectAt < 0) {
    const depIdx = sections.findIndex((s) => s.kind === "departments");
    injectAt = depIdx >= 0 ? depIdx : sections.findIndex((s) => s.kind === "hero");
  }

  const rendered: React.ReactNode[] = [];
  if (injectAt < 0) rendered.push(...extras);
  sections.forEach((section, index) => {
    rendered.push(...renderSection(section, index));
    if (index === injectAt) rendered.push(...extras);
  });

  return (
    <main id="conteudo" className="page-shell">
      <Header departments={home.departments} />
      {rendered}
      <SiteFooter settings={settings} />
    </main>
  );
}
