// language: TSX, file: apps/store/src/app/catalogo/page.tsx, target: Next.js App Router
// Catálogo com filtros laterais reais (facetas da API), ordenação, paginação e grade densa com foto.
import Link from "next/link";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { Header } from "../components/Header";
import { ProductCard } from "../components/ProductCard";
import { SiteFooter } from "../components/SiteFooter";
import {
  API_URL,
  formatBRL,
  storeGet,
  type CatalogResult,
  type CommercialSettings,
  type StoreHome,
} from "../lib/store";

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "featured_first", label: "Relevância" },
  { key: "price_asc", label: "Menor preço" },
  { key: "price_desc", label: "Maior preço" },
  { key: "name_asc", label: "Nome (A–Z)" },
  { key: "news", label: "Novidades" },
  { key: "bestsellers", label: "Mais vendidos" },
];

const EMPTY_RESULT: CatalogResult = {
  items: [],
  total: 0,
  page: 1,
  limit: 24,
  pages: 1,
  facets: { brands: [], categories: [], price: { minCents: 0, maxCents: 0 } },
};

type Params = {
  categoria?: string;
  brand?: string;
  sort?: string;
  page?: string;
  q?: string;
  minPrice?: string;
  maxPrice?: string;
  disponivel?: string;
  condicao?: string;
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const categoria = params?.categoria ?? "";
  const brand = params?.brand ?? "";
  const sort = params?.sort ?? "featured_first";
  const page = Math.max(1, Number(params?.page ?? 1) || 1);
  const q = params?.q ?? "";
  const minPrice = params?.minPrice ?? "";
  const maxPrice = params?.maxPrice ?? "";
  const disponivel = params?.disponivel ?? "";
  const condicao = params?.condicao ?? "";

  const query = new URLSearchParams({ limit: "24", page: String(page), sort });
  if (categoria) query.set("categoria", categoria);
  if (brand) query.set("brand", brand);
  if (q) query.set("q", q);
  if (minPrice) query.set("minPrice", minPrice);
  if (maxPrice) query.set("maxPrice", maxPrice);
  if (disponivel) query.set("disponivel", disponivel);
  if (condicao) query.set("condicao", condicao);

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
    }),
    storeGet<CatalogResult>(`${API_URL}/api/store/products?${query.toString()}`, EMPTY_RESULT),
  ]);

  const settings: CommercialSettings = home.settings;
  const products = data.items ?? [];
  const total = data.total ?? 0;
  const totalPages = Math.max(1, data.pages ?? 1);
  const facets = data.facets ?? EMPTY_RESULT.facets;

  const activeCategory = facets.categories.find((c) => c.slug === categoria || c.id === categoria);
  const activeBrand = facets.brands.find((b) => b.slug === brand || b.id === brand);
  const priceMin = facets.price?.minCents ?? 0;
  const priceMax = facets.price?.maxCents ?? 0;

  const buildHref = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const cat = patch.categoria !== undefined ? patch.categoria : categoria;
    const br = patch.brand !== undefined ? patch.brand : brand;
    const so = patch.sort ?? sort;
    const pg = patch.page ?? "1";
    const mn = patch.minPrice !== undefined ? patch.minPrice : minPrice;
    const mx = patch.maxPrice !== undefined ? patch.maxPrice : maxPrice;
    const av = patch.disponivel !== undefined ? patch.disponivel : disponivel;
    const cd = patch.condicao !== undefined ? patch.condicao : condicao;
    const term = patch.q !== undefined ? patch.q : q;
    if (cat) next.set("categoria", cat);
    if (br) next.set("brand", br);
    if (mn) next.set("minPrice", mn);
    if (mx) next.set("maxPrice", mx);
    if (av) next.set("disponivel", av);
    if (cd) next.set("condicao", cd);
    if (term) next.set("q", term);
    next.set("sort", so);
    next.set("page", pg);
    return `/catalogo?${next.toString()}`;
  };

  const hasFilter = Boolean(categoria || brand || q || minPrice || maxPrice || disponivel || condicao);

  return (
    <main className="page-shell">
      <Header departments={home.departments} />

      <nav className="crumbs" aria-label="Trilha de navegação">
        <Link href="/">Início</Link>
        <ChevronRight size={12} />
        <Link href="/catalogo">Catálogo</Link>
        {activeCategory && (
          <>
            <ChevronRight size={12} />
            <span>{activeCategory.name}</span>
          </>
        )}
        {activeBrand && (
          <>
            <ChevronRight size={12} />
            <span>{activeBrand.name}</span>
          </>
        )}
      </nav>

      <div className="catalog">
        <aside className="catalog__side">
          <div className="filters__head">
            <SlidersHorizontal size={16} />
            <span>Filtros</span>
            {hasFilter && (
              <Link href="/catalogo" className="filters__clear">
                limpar
              </Link>
            )}
          </div>

          {facets.categories.length > 0 && (
            <section className="filters__group">
              <h2 className="filters__title">Categoria</h2>
              <ul className="filters__list">
                <li>
                  <Link
                    href={buildHref({ categoria: "", page: "1" })}
                    className={`filters__item ${!categoria ? "is-active" : ""}`}
                  >
                    Todas
                    <span>{total}</span>
                  </Link>
                </li>
                {facets.categories.slice(0, 24).map((cat) => (
                  <li key={cat.id}>
                    <Link
                      href={buildHref({ categoria: cat.slug, page: "1" })}
                      className={`filters__item ${categoria === cat.slug ? "is-active" : ""}`}
                    >
                      {cat.name}
                      <span>{cat.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {facets.brands.length > 0 && (
            <section className="filters__group">
              <h2 className="filters__title">Marca</h2>
              <ul className="filters__list">
                <li>
                  <Link
                    href={buildHref({ brand: "", page: "1" })}
                    className={`filters__item ${!brand ? "is-active" : ""}`}
                  >
                    Todas
                  </Link>
                </li>
                {facets.brands.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={buildHref({ brand: b.slug, page: "1" })}
                      className={`filters__item ${brand === b.slug ? "is-active" : ""}`}
                    >
                      {b.name}
                      <span>{b.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {priceMax > priceMin && (
            <section className="filters__group">
              <h2 className="filters__title">Faixa de preço</h2>
              <ul className="filters__list">
                {[
                  { label: "Até R$ 150", min: "", max: "15000" },
                  { label: "R$ 150 a R$ 400", min: "15000", max: "40000" },
                  { label: "R$ 400 a R$ 900", min: "40000", max: "90000" },
                  { label: "Acima de R$ 900", min: "90000", max: "" },
                ].map((range) => (
                  <li key={range.label}>
                    <Link
                      href={buildHref({ minPrice: range.min, maxPrice: range.max, page: "1" })}
                      className={`filters__item ${
                        minPrice === range.min && maxPrice === range.max ? "is-active" : ""
                      }`}
                    >
                      {range.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="filters__hint">
                De {formatBRL(priceMin)} a {formatBRL(priceMax)}
              </p>
            </section>
          )}

          <section className="filters__group">
            <h2 className="filters__title">Condição</h2>
            <ul className="filters__list">
              {[
                { key: "", label: "Todas" },
                { key: "novo", label: "Novo" },
                { key: "usado", label: "Usado" },
                { key: "seminovo", label: "Seminovo revisado" },
              ].map((c) => (
                <li key={c.key || "all"}>
                  <Link
                    href={buildHref({ condicao: c.key, page: "1" })}
                    className={`filters__item ${condicao === c.key ? "is-active" : ""}`}
                  >
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="filters__group">
            <h2 className="filters__title">Disponibilidade</h2>
            <ul className="filters__list">
              <li>
                <Link
                  href={buildHref({ disponivel: disponivel === "1" ? "" : "1", page: "1" })}
                  className={`filters__item ${disponivel === "1" ? "is-active" : ""}`}
                >
                  Só em estoque
                </Link>
              </li>
            </ul>
          </section>
        </aside>

        <div className="catalog__main">
          <header className="catalog__head">
            <div>
              <h1 className="catalog__title">
                {activeCategory?.name ?? activeBrand?.name ?? (q ? `“${q}”` : "Catálogo")}
              </h1>
              <p className="catalog__count">
                {total} {total === 1 ? "produto encontrado" : "produtos encontrados"}
              </p>
            </div>

            <form className="catalog__sort" method="get">
              {categoria && <input type="hidden" name="categoria" value={categoria} />}
              {brand && <input type="hidden" name="brand" value={brand} />}
              {q && <input type="hidden" name="q" value={q} />}
              {minPrice && <input type="hidden" name="minPrice" value={minPrice} />}
              {maxPrice && <input type="hidden" name="maxPrice" value={maxPrice} />}
              {disponivel && <input type="hidden" name="disponivel" value={disponivel} />}
              {condicao && <input type="hidden" name="condicao" value={condicao} />}
              <label htmlFor="sort">Ordenar</label>
              <select id="sort" name="sort" defaultValue={sort}>
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary btn-sm">
                Aplicar
              </button>
            </form>
          </header>

          {products.length === 0 ? (
            <div className="catalog__empty">
              <p className="catalog__empty-num">0</p>
              <h2>Nenhum produto com esses filtros</h2>
              <p>Tente limpar a busca ou navegar por um departamento.</p>
              <Link href="/catalogo" className="btn-primary">
                Limpar filtros
              </Link>
            </div>
          ) : (
            <ul className="product-grid product-grid--dense">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} settings={settings} />
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <nav className="pager" aria-label="Paginação">
              {page > 1 ? (
                <Link href={buildHref({ page: String(page - 1) })} className="btn-secondary">
                  ← Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="pager__info">
                Página {page} de {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={buildHref({ page: String(page + 1) })} className="btn-secondary">
                  Próxima →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </div>

      <SiteFooter settings={settings} />
    </main>
  );
}
