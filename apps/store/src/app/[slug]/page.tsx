// language: TSX, file: apps/store/src/app/[slug]/page.tsx, target: Next.js App Router
// PDP comercial: galeria com foto real, preço, PIX, parcelamento, frete por CEP,
// ficha técnica, produtos relacionados e breadcrumb de navegação.
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, ShieldCheck, Truck, Zap } from "lucide-react";
import { Header } from "../components/Header";
import { ProductCard } from "../components/ProductCard";
import { SiteFooter } from "../components/SiteFooter";
import { Gallery } from "./Gallery";
import { AddToCart } from "./AddToCart";
import { ShippingQuote } from "./ShippingQuote";
import {
  API_URL,
  formatBRL,
  installmentsFor,
  pixPrice,
  storeGet,
  type CommercialSettings,
  type StoreHome,
  type StoreProduct,
} from "../lib/store";
import { OG_IMAGE } from "../lib/seo";

export const dynamic = "force-dynamic";

type PdpProduct = StoreProduct & {
  specs?: { id: string; key: string; label: string; value: string; position: number }[];
};

const EMPTY_SETTINGS: CommercialSettings = {
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
};

async function getProduct(slug: string): Promise<PdpProduct | null> {
  const product = await storeGet<PdpProduct | null>(
    `${API_URL}/api/store/products/${encodeURIComponent(slug)}`,
    null,
  );
  return product;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  const name = product?.name ?? slug;
  const description =
    product?.shortDescription ||
    product?.description?.slice(0, 155) ||
    `${name} — airsoft e equipamentos táticos na Airsoft Americana.`;
  const image = product?.images?.[0]?.url;
  return {
    title: name,
    description,
    alternates: { canonical: `/${slug}` },
    openGraph: {
      type: "website",
      title: name,
      description,
      url: `/${slug}`,
      // Sem foto no produto ainda (catálogo vazio): o card volta para a arte de marca.
      images: image ? [{ url: image, alt: name }, OG_IMAGE] : [OG_IMAGE],
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, home] = await Promise.all([
    getProduct(slug),
    storeGet<StoreHome>(`${API_URL}/api/store/home`, {
      banners: [],
      sections: [],
      departments: [],
      brands: [],
      featured: [],
      news: [],
      sale: [],
      bestsellers: [],
      settings: EMPTY_SETTINGS,
      totals: { products: 0 },
    }),
  ]);

  if (!product) {
    return (
      <main className="page-shell">
        <Header departments={home.departments} />
        <div className="notfound">
          <p className="notfound__num">404</p>
          <h1>Produto não encontrado</h1>
          <p>Verifique o endereço ou volte ao catálogo.</p>
          <Link href="/catalogo" className="btn-primary">
            Ver catálogo
          </Link>
        </div>
        <SiteFooter settings={home.settings} />
      </main>
    );
  }

  const settings = home.settings;
  const variants = product.variants ?? [];
  const first = variants[0];
  const price = product.priceCents;
  const listPrice = product.listPriceCents;
  const hasDiscount = listPrice > price && price > 0;
  const pix = pixPrice(price, settings);
  const inst = installmentsFor(price, settings);
  const out = product.available <= 0;
  const specs = product.specs ?? [];

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: first?.sku,
    description: product.description || product.shortDescription || undefined,
    image: product.images?.map((i) => i.url),
    brand: product.brandName ? { "@type": "Brand", name: product.brandName } : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: (price / 100).toFixed(2),
      availability: out ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      itemCondition:
        product.condicao === "usado"
          ? "https://schema.org/UsedCondition"
          : product.condicao === "seminovo"
            ? "https://schema.org/RefurbishedCondition"
            : "https://schema.org/NewCondition",
    },
  };

  return (
    <main className="page-shell">
      <Header departments={home.departments} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />

      <nav className="crumbs" aria-label="Trilha de navegação">
        <Link href="/">Início</Link>
        <ChevronRight size={12} />
        <Link href="/catalogo">Catálogo</Link>
        {product.categoryName && (
          <>
            <ChevronRight size={12} />
            <Link href={`/catalogo?categoria=${product.categorySlug}`}>{product.categoryName}</Link>
          </>
        )}
        <ChevronRight size={12} />
        <span>{product.name}</span>
      </nav>

      <div className="pdp">
        <div className="pdp__media">
          <Gallery images={product.images ?? []} name={product.name} />
        </div>

        <div className="pdp__info">
          {product.brandName && (
            <Link href={`/marca/${product.brandSlug}`} className="pdp__brand">
              {product.brandName}
            </Link>
          )}
          <h1 className="pdp__title">{product.name}</h1>
          {product.shortDescription && <p className="pdp__lead">{product.shortDescription}</p>}

          <div className="pdp__pricebox">
            {hasDiscount && (
              <span className="pdp__was">
                {formatBRL(listPrice)}
                <em>
                  −
                  {Math.round(((listPrice - price) / listPrice) * 100)}%
                </em>
              </span>
            )}
            <span className="pdp__price">{formatBRL(price)}</span>
            {settings.pix_discount_percent > 0 && pix > 0 && (
              <span className="pdp__pix">
                {formatBRL(pix)} no PIX ({settings.pix_discount_percent}% de desconto)
              </span>
            )}
            {price > 0 && (
              <span className="pdp__inst">
                {inst.count}x de {formatBRL(inst.valueCents)}
                {inst.interestFree ? " sem juros" : ""} · ou boleto
              </span>
            )}

            <div className="pdp__flags">
              {product.condicao === "usado" && <span className="pdp__flag">Usado — estado de conservação informado</span>}
              {product.condicao === "seminovo" && <span className="pdp__flag">Seminovo revisado</span>}
              {(!product.condicao || product.condicao === "novo") && <span className="pdp__flag">Novo</span>}
              {product.ageRestricted && <span className="pdp__flag">18+ — compra restrita</span>}
              <span className={`pdp__flag ${out ? "is-out" : "is-ok"}`}>
                {out ? "Sem estoque" : `${product.available} unidades disponíveis`}
              </span>
              {first && <span className="pdp__flag">SKU {first.sku}</span>}
            </div>

            {(product.condicao === "usado" || product.condicao === "seminovo" || product.estado_conservacao || product.itens_inclusos || product.garantia_dias != null) && (
              <section className="pdp__specs" aria-label="Condição e procedência">
                <h2 className="pdp__specs-title">Condição e procedência</h2>
                <dl className="spec-list">
                  <div className="spec-list__row"><dt>Condição</dt><dd>{product.condicao === "usado" ? "Usado" : product.condicao === "seminovo" ? "Seminovo revisado" : "Novo"}</dd></div>
                  {product.estado_conservacao ? <div className="spec-list__row"><dt>Estado de conservação</dt><dd>{product.estado_conservacao}</dd></div> : null}
                  {product.itens_inclusos ? <div className="spec-list__row"><dt>Acessórios incluídos</dt><dd>{product.itens_inclusos}</dd></div> : null}
                  {product.garantia_dias != null ? <div className="spec-list__row"><dt>Garantia</dt><dd>{product.garantia_dias} dia(s)</dd></div> : null}
                </dl>
              </section>
            )}

            {first ? (
              <div className="pdp__buy">
                <AddToCart variantId={first.id} />
              </div>
            ) : (
              <p className="pdp__nostock">Sem variações cadastradas para este item.</p>
            )}
          </div>

          <div className="pdp__perks">
            <div>
              <ShieldCheck size={18} />
              <span>Compra protegida</span>
            </div>
            <div>
              <Truck size={18} />
              <span>Envio para todo o Brasil</span>
            </div>
            <div>
              <Zap size={18} />
              <span>PIX −{settings.pix_discount_percent}%</span>
            </div>
          </div>

          {first && (
            <ShippingQuote
              variantId={first.id}
              subtotalCents={price}
              weightGrams={first.weightGrams}
              freeShippingFrom={settings.free_shipping_from_cents}
            />
          )}

          {specs.length > 0 && (
            <section className="pdp__specs">
              <h2 className="pdp__specs-title">Ficha técnica</h2>
              <dl className="spec-list">
                {specs.map((spec) => (
                  <div key={spec.id} className="spec-list__row">
                    <dt>{spec.label}</dt>
                    <dd>{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {product.description && (
            <section className="pdp__desc">
              <h2 className="pdp__specs-title">Descrição</h2>
              <p>{product.description}</p>
            </section>
          )}
        </div>
      </div>

      {product.related && product.related.length > 0 && (
        <section className="block">
          <div className="sec-head">
            <div>
              <span className="sec-kicker">Da mesma categoria</span>
              <h2 className="sec-title">Produtos relacionados</h2>
            </div>
          </div>
          <ul className="product-grid">
            {product.related.map((rel) => (
              <ProductCard key={rel.id} product={rel} settings={settings} />
            ))}
          </ul>
        </section>
      )}

      {product.compatible && product.compatible.length > 0 && (
        <section className="block">
          <div className="sec-head">
            <div>
              <span className="sec-kicker">Compatibilidade</span>
              <h2 className="sec-title">Produtos compatíveis</h2>
            </div>
          </div>
          <ul className="product-grid">
            {product.compatible.map((rel) => (
              <ProductCard key={rel.id} product={rel} settings={settings} />
            ))}
          </ul>
        </section>
      )}

      <SiteFooter settings={settings} />
    </main>
  );
}
