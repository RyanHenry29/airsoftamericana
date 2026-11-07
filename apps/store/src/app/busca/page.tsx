// language: TSX, file: apps/store/src/app/busca/page.tsx, target: Next.js App Router
// Resultados de busca com filtros de categoria e marca vindos das facetas reais.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Header } from "../components/Header";
import { MegaMenu } from "../components/MegaMenu";
import { ProductCard } from "../components/ProductCard";
import { Footer } from "../components/Footer";
import {
  API_URL,
  storeGet,
  type CatalogResult,
  type CommercialSettings,
  type StoreHome,
} from "../lib/store";

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

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = (params?.q ?? "").trim();
  const page = Math.max(1, Number(params?.page ?? 1) || 1);

  const query = new URLSearchParams({ limit: "24", page: String(page) });
  if (q) query.set("q", q);

  const [home, data] = await Promise.all([
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
    storeGet<CatalogResult>(`${API_URL}/api/store/products?${query.toString()}`, EMPTY_RESULT),
  ]);

  const settings = home.settings;
  const products = data.items ?? [];

  return (
    <main className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

      <nav className="crumbs" aria-label="Trilha de navegação">
        <Link href="/">Início</Link>
        <ChevronRight size={12} />
        <span>Busca</span>
      </nav>

      <header className="catalog__head">
        <div>
          <h1 className="catalog__title">{q ? `“${q}”` : "Buscar no catálogo"}</h1>
          <p className="catalog__count">
            {data.total} {data.total === 1 ? "produto encontrado" : "produtos encontrados"}
          </p>
        </div>
      </header>

      {products.length === 0 ? (
        <div className="catalog__empty">
          <p className="catalog__empty-num">0</p>
          <h2>Nada encontrado com esse termo</h2>
          <p>Confira a escrita ou navegue pelos departamentos.</p>
          <Link href="/catalogo" className="btn-primary">
            Ver catálogo
          </Link>
        </div>
      ) : (
        <ul className="product-grid product-grid--dense">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} settings={settings} />
          ))}
        </ul>
      )}

      {data.pages > 1 && (
        <nav className="pager" aria-label="Paginação">
          {page > 1 ? (
            <Link href={`/busca?q=${encodeURIComponent(q)}&page=${page - 1}`} className="btn-secondary">
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="pager__info">
            Página {page} de {data.pages}
          </span>
          {page < data.pages ? (
            <Link href={`/busca?q=${encodeURIComponent(q)}&page=${page + 1}`} className="btn-secondary">
              Próxima →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Footer settings={settings} />
    </main>
  );
}
