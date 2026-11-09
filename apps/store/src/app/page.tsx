// language: TSX, file: apps/store/src/app/page.tsx, target: Next.js App Router
// Homepage comercial reestruturada seguindo padrão GM Tático:
// Barra de serviço → Hero focado → Categorias visuais → Produtos
// → Orientação ("Começando no airsoft?") → Provas de confiança → Guias → Rodapé
import Image from "next/image";
import Link from "next/link";
import { Header } from "./components/Header";
import { MegaMenu } from "./components/MegaMenu";
import { ProductCard } from "./components/ProductCard";
import { Footer } from "./components/Footer";
import { NewsletterForm } from "./components/NewsletterForm";
import {
  API_URL,
  formatBRL,
  installmentsFor,
  pixPrice,
  storeGet,
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

  const { settings } = home;
  const hero = home.banners[0] ?? null;
  const freeShipping = settings.free_shipping_from_cents;
  const pixPercent = settings.pix_discount_percent;
  const inst = settings.installments;

  // Hero usa apenas o primeiro banner ativo
  const heroContent = hero ? {
    title: hero.title || "Equipamento para jogar com segurança e confiança",
    subtitle: hero.subtitle || "Airsoft, tiro esportivo e equipamentos táticos. Entrega para todo o Brasil.",
    ctaLabel: hero.ctaLabel || "Ver catálogo",
    link: hero.link || "/catalogo",
    image: hero.imageDesktop || "/produtos/e0c3dc6a62a7f830.webp",
  } : null;

  return (
    <main id="conteudo" className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

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

      {/* ============================================================
           ORIENTAÇÃO — "Começando no airsoft?" caminho guiado
           ============================================================ */}
      <section className="block block--border" aria-labelledby="orientacao-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Precisa de ajuda?</span>
            <h2 id="orientacao-title" className="sec-title">Começando no airsoft?</h2>
          </div>
          <Link href="/atendimento" className="sec-link">Falar com especialista</Link>
        </div>
        <div className="orientacao-grid">
          <article className="orientacao-card">
            <div className="orientacao-icon" aria-hidden="true">🛡️</div>
            <h3>1. Proteção ocular</h3>
            <p>Óculos ou máscara com certificação de impacto (ANSI Z87.1+). Obrigatório em qualquer partida.</p>
            <Link href="/catalogo?categoria=protecao-ocular" className="orientacao-link">Ver proteções →</Link>
          </article>
          <article className="orientacao-card">
            <div className="orientacao-icon" aria-hidden="true">🔫</div>
            <h3>2. Réplica ideal</h3>
            <p>AEG para início (fácil manutenção), GBBR para realismo, HPA para performance. Escolha pelo seu estilo de jogo.</p>
            <Link href="/catalogo?categoria=replicas" className="orientacao-link">Ver réplicas →</Link>
          </article>
          <article className="orientacao-card">
            <div className="orientacao-icon" aria-hidden="true">⚪</div>
            <h3>3. BBs de qualidade</h3>
            <p>0.20g a 0.28g de marcas confiáveis. BBs ruins travam o cano e estragam o hop-up.</p>
            <Link href="/catalogo?categoria=bbs" className="orientacao-link">Ver BBs →</Link>
          </article>
          <article className="orientacao-card">
            <div className="orientacao-icon" aria-hidden="true">🔋</div>
            <h3>4. Bateria e carregador</h3>
            <p>LiPo 7.4V ou 11.1V com carregador balanceador. Nunca carregue sem supervisão.</p>
            <Link href="/catalogo?categoria=baterias" className="orientacao-link">Ver baterias →</Link>
          </article>
          <article className="orientacao-card">
            <div className="orientacao-icon" aria-hidden="true">🔧</div>
            <h3>5. Manutenção básica</h3>
            <p>Óleo de silicone, graxa branca, chave allen. Limpe o cano e lubrifique a gearbox periodicamente.</p>
            <Link href="/catalogo?categoria=manutencao" className="orientacao-link">Ver ferramentas →</Link>
          </article>
          <article className="orientacao-card">
            <div className="orientacao-icon" aria-hidden="true">🎒</div>
            <h3>6. Fardamento e carga</h3>
            <p>Cinto tático, coldre, pouches para mags, mochila de hidratação. Conforto define sua permanência no campo.</p>
            <Link href="/catalogo?categoria=loadout" className="orientacao-link">Ver loadout →</Link>
          </article>
        </div>
      </section>

      {/* ============================================================
           PROVAS DE CONFIANÇA — avaliações, marcas, prazo, atendimento
           ============================================================ */}
      <section className="block" aria-labelledby="confianca-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Por que comprar aqui?</span>
            <h2 id="confianca-title" className="sec-title">Confiança</h2>
          </div>
        </div>
        <ul className="confianca-grid">
          <li>
            <strong>{home.totals.products}</strong> produtos no catálogo
          </li>
          <li>
            Entrega para todo o Brasil
          </li>
          {settings.service_hours && (
            <li>
              <strong>Atendimento</strong> {settings.service_hours}
            </li>
          )}
          <li>
            <strong>PIX −{pixPercent}%</strong> desconto à vista
          </li>
          <li>
            <strong>{inst}x sem juros</strong> no cartão
          </li>
          <li>
            {settings.address.city ? (
              <>
                <strong>Loja física</strong> em {settings.address.city}/{settings.address.state}
              </>
            ) : null}
          </li>
          <li>
            Trocas e devoluções conforme CDC
          </li>
          <li>
            <a href="/atendimento" style={{ color: "var(--primary)", textDecoration: "underline" }}>Fale conosco no WhatsApp</a>
          </li>
        </ul>
      </section>

      {/* ============================================================
           GUIAS ÚTEIS — 3 artigos conectados a produtos
           ============================================================ */}
      <section className="block block--border" aria-labelledby="guias-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Conteúdo</span>
            <h2 id="guias-title" className="sec-title">Guias</h2>
          </div>
          <Link href="/busca" className="sec-link">Ver todos</Link>
        </div>
        <ul className="guias-grid">
          <li className="guia-card">
            <h3>Como escolher sua primeira AEG</h3>
            <p>Entenda sistemas de propulsão, marcas, upgrade path e orçamento. Evite arrependimento na primeira compra.</p>
            <Link href="/catalogo?categoria=aeg" className="guia-link">Ver AEGs recomendadas →</Link>
          </li>
          <li className="guia-card">
            <h3>GBB vs HPA: qual vale a pena?</h3>
            <p>Comparativo real: realismo, manutenção, custo por partida, consistência de FPS. Decida com dados.</p>
            <Link href="/catalogo?categoria=gbb" className="guia-link">Ver GBBs →</Link>
          </li>
          <li className="guia-card">
            <h3>Checklist de primeiro jogo</h3>
            <p>O que levar, o que vestir, regras de segurança, etiqueta de campo. Chegue preparado e jogue tranquilo.</p>
            <Link href="/atendimento" className="guia-link">Falar com especialista →</Link>
          </li>
        </ul>
      </section>

      {/* ============================================================
           NEWSLETTER — já existe no Footer, mas mantemos aqui também
           ============================================================ */}
      <section className="block block--border" aria-labelledby="newsletter-title">
        <div className="newsletter-band">
          <div>
            <span className="sec-kicker">Drops e reposição</span>
            <h2 id="newsletter-title" className="sec-title">Receba as novidades no seu e-mail</h2>
          </div>
          <NewsletterForm />
        </div>
      </section>

      <Footer settings={settings} />
    </main>
  );
}