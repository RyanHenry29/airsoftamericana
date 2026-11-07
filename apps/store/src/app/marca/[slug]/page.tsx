// language: TSX, file: apps/store/src/app/marca/[slug]/page.tsx, target: Next.js App Router
// Página de marca: capa com a marca e grade de produtos do fabricante.
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { Header } from "../../components/Header";
import { MegaMenu } from "../../components/MegaMenu";
import { ProductCard } from "../../components/ProductCard";
import { Footer } from "../../components/Footer";
import {
  API_URL,
  storeGet,
  type CatalogResult,
  type CommercialSettings,
  type StoreHome,
} from "../../lib/store";

export const dynamic = "force-dynamic";

const EMPTY_RESULT: CatalogResult = {
  items: [],
  total: 0,
  page: 1,
  limit: 24,
  pages: 1,
  facets: { brands: [], categories: [], price: { minCents: 0, maxCents: 0 } },
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brands = await storeGet<{ id: string; name: string; slug: string }[]>(
    `${API_URL}/api/store/brands`,
    [],
  );
  const brand = brands.find((b) => b.slug === slug);
  if (!brand) return { title: "Marca não encontrada" };
  return {
    title: brand.name,
    description: `Produtos ${brand.name} na Airsoft Americana — airsoft, tiro esportivo e loadout com frete para todo o Brasil.`,
    alternates: { canonical: `/marca/${brand.slug}` },
  };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [home, data, brands] = await Promise.all([
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
    storeGet<CatalogResult>(
      `${API_URL}/api/store/products?brand=${encodeURIComponent(slug)}&limit=24`,
      EMPTY_RESULT,
    ),
    storeGet<{ id: string; name: string; slug: string; productCount: number }[]>(
      `${API_URL}/api/store/brands`,
      [],
    ),
  ]);

  const brand = brands.find((b) => b.slug === slug);
  const settings = home.settings;

  return (
    <main className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

      <nav className="crumbs" aria-label="Trilha de navegação">
        <Link href="/">Início</Link>
        <ChevronRight size={12} />
        <Link href="/catalogo">Catálogo</Link>
        <ChevronRight size={12} />
        <span>{brand?.name ?? slug}</span>
      </nav>

      <section className="brand-hero">
        <span className="sec-kicker">Fabricante</span>
        <h1 className="brand-hero__title">{brand?.name ?? slug}</h1>
        <p className="brand-hero__count">{data.total} produtos</p>
        {brand && brand.productCount > 0 && (
          <Link href={`/catalogo?brand=${brand.slug}`} className="sec-link">
            Ver no catálogo completo
          </Link>
        )}
      </section>

      {data.items.length > 0 ? (
        <section className="block">
          <ul className="product-grid product-grid--dense">
            {data.items.map((product) => (
              <ProductCard key={product.id} product={product} settings={settings} />
            ))}
          </ul>
          {data.pages > 1 && (
            <nav className="pager" aria-label="Paginação">
              <span />
              <span className="pager__info">
                Página {data.page} de {data.pages}
              </span>
              {data.page < data.pages ? (
                <Link
                  href={`/marca/${slug}?page=${data.page + 1}`}
                  className="btn-secondary"
                >
                  Próxima →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      ) : (
        <div className="catalog__empty">
          <p className="catalog__empty-num">0</p>
          <h2>Nenhum produto desta marca no catálogo</h2>
          <Link href="/catalogo" className="btn-primary">
            Ver catálogo
          </Link>
        </div>
      )}

      <Footer settings={settings} />
    </main>
  );
}
