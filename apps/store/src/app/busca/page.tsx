// language: TSX, file: apps/store/src/app/busca/page.tsx, target: Next.js App Router
// Busca de produtos (server-side): q + autocomplete no Header, filtros (marca/categoria/condição/disponibilidade/preço/especificações técnicas configuráveis por dados reais), ordenação, paginação, breadcrumbs e estados.
import Link from "next/link";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { Header } from "../components/Header";
import { MegaMenu } from "../components/MegaMenu";
import { ProductCard } from "../components/ProductCard";
import { Footer } from "../components/Footer";
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
  facets: { brands: [], categories: [], price: { minCents: 0, maxCents: 0 }, conditions: [], specs: [] },
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

type Params = {
  q?: string;
  categoria?: string;
  brand?: string;
  sort?: string;
  page?: string;
  minPrice?: string;
  maxPrice?: string;
  disponivel?: string;
  condicao?: string;
  specKey?: string;
  specValue?: string;
};

const CONDICOES = [
  { key: "", label: "Todas" },
  { key: "novo", label: "Novo" },
  { key: "usado", label: "Usado" },
  { key: "seminovo", label: "Seminovo revisado" },
];

async function fetchCatalog(qs: string): Promise<{ data: CatalogResult; ok: boolean }> {
  const url = API_URL + "/api/store/products?" + qs;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { data: EMPTY_RESULT, ok: false };
    return { data: (await res.json()) as CatalogResult, ok: true };
  } catch {
    return { data: EMPTY_RESULT, ok: false };
  }
}

export default async function BuscaPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const categoria = (params.categoria ?? "").trim();
  const brand = (params.brand ?? "").trim();
  const sort = params.sort ?? "featured_first";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const minPrice = (params.minPrice ?? "").trim();
  const maxPrice = (params.maxPrice ?? "").trim();
  const disponivel = params.disponivel ?? "";
  const condicao = (params.condicao ?? "").trim();
  const specKey = (params.specKey ?? "").trim();
  const specValue = (params.specValue ?? "").trim();

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (categoria) qs.set("categoria", categoria);
  if (brand) qs.set("brand", brand);
  if (sort) qs.set("sort", sort);
  qs.set("page", String(page));
  qs.set("limit", "24");
  if (minPrice) qs.set("minPrice", minPrice);
  if (maxPrice) qs.set("maxPrice", maxPrice);
  if (disponivel) qs.set("disponivel", disponivel);
  if (condicao) qs.set("condicao", condicao);
  if (specKey) qs.set("specKey", specKey);
  if (specValue) qs.set("specValue", specValue);

  const [catalogRes, home] = await Promise.all([
    fetchCatalog(qs.toString()),
    storeGet<StoreHome>(API_URL + "/api/store/home", {
      banners: [], sections: [], departments: [], brands: [], featured: [], news: [], sale: [], bestsellers: [],
      settings: EMPTY_SETTINGS, totals: { products: 0 },
    }),
  ]);

  const result = catalogRes.data;
  const loadError = !catalogRes.ok;
  const settings = home.settings ?? EMPTY_SETTINGS;
  const products = result.items ?? [];
  const facets = result.facets ?? EMPTY_RESULT.facets;
  const total = result.total ?? 0;
  const totalPages = Math.max(1, result.pages ?? (Math.ceil(total / 24) || 1));
  const priceMin = facets.price?.minCents ?? 0;
  const priceMax = facets.price?.maxCents ?? 0;
  const condCounts = new Map((facets.conditions ?? []).map((c) => [c.key, c.count]));
  const specGroups = facets.specs ?? [];

  function buildHref(overrides: Record<string, string>): string {
    const next = new URLSearchParams(qs);
    for (const [key, value] of Object.entries(overrides)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    return "/busca?" + next.toString();
  }

  const activeBrand = facets.brands.find((b) => b.slug === brand);
  const activeCategory = facets.categories.find((c) => c.slug === categoria);
  const hasFilters = Boolean(categoria || brand || minPrice || maxPrice || disponivel || condicao || specKey || specValue);
  const title = q ? "Busca: " + q : activeCategory?.name ?? activeBrand?.name ?? "Busca no catálogo";

  return (
    <main id="conteudo">
      <Header />
      <MegaMenu departments={home.departments ?? []} />

      <div className="container catalog-page">
        <nav className="breadcrumbs" aria-label="Navegação">
          <Link href="/">Início</Link>
          <ChevronRight size={13} strokeWidth={1.8} aria-hidden="true" />
          <Link href="/busca">Busca</Link>
          {(q || activeCategory || activeBrand) && (
            <>
              <ChevronRight size={13} strokeWidth={1.8} aria-hidden="true" />
              <span aria-current="page">
                {q ? `\u201C${q}\u201D` : activeCategory?.name ?? activeBrand?.name}
              </span>
            </>
          )}
        </nav>

        <div className="catalog">
          <aside className="catalog__filters filters" aria-label="Filtros">
            <div className="filters__head">
              <span className="filters__head-title">
                <SlidersHorizontal size={15} strokeWidth={1.8} aria-hidden="true" /> Filtros
              </span>
              {(hasFilters || q) && (
                <Link href={q ? "/busca?q=" + encodeURIComponent(q) : "/busca"} className="filters__clear">
                  Limpar filtros
                </Link>
              )}
            </div>

            <form className="filters__group" action="/busca" method="get" role="search" aria-label="Refinar busca">
              <h2 className="filters__title">Termo</h2>
              {categoria && <input type="hidden" name="categoria" value={categoria} />}
              {brand && <input type="hidden" name="brand" value={brand} />}
              {sort && <input type="hidden" name="sort" value={sort} />}
              {minPrice && <input type="hidden" name="minPrice" value={minPrice} />}
              {maxPrice && <input type="hidden" name="maxPrice" value={maxPrice} />}
              {disponivel && <input type="hidden" name="disponivel" value={disponivel} />}
              {condicao && <input type="hidden" name="condicao" value={condicao} />}
              {specKey && <input type="hidden" name="specKey" value={specKey} />}
              {specValue && <input type="hidden" name="specValue" value={specValue} />}
              <label htmlFor="q" className="sr-only">Buscar produtos</label>
              <input id="q" name="q" defaultValue={q} placeholder="Ex.: pistola, colete, BBs" className="filters__input" />
              <button type="submit" className="btn-primary btn-sm" style={{ marginTop: 8, width: "100%" }}>Buscar</button>
            </form>

            {facets.categories.length > 0 && (
              <section className="filters__group">
                <h2 className="filters__title">Departamento</h2>
                <ul className="filters__list">
                  <li>
                    <Link href={buildHref({ categoria: "", page: "1" })} className={"filters__item " + (!categoria ? "is-active" : "")}>
                      Todos <span>{total}</span>
                    </Link>
                  </li>
                  {facets.categories.slice(0, 24).map((cat) => (
                    <li key={cat.id}>
                      <Link href={buildHref({ categoria: cat.slug, page: "1" })} className={"filters__item " + (categoria === cat.slug ? "is-active" : "")}>
                        {cat.name} <span>{cat.count}</span>
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
                    <Link href={buildHref({ brand: "", page: "1" })} className={"filters__item " + (!brand ? "is-active" : "")}>
                      Todas
                    </Link>
                  </li>
                  {facets.brands.map((b) => (
                    <li key={b.id}>
                      <Link href={buildHref({ brand: b.slug, page: "1" })} className={"filters__item " + (brand === b.slug ? "is-active" : "")}>
                        {b.name} <span>{b.count}</span>
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
                        className={"filters__item " + (minPrice === range.min && maxPrice === range.max ? "is-active" : "")}
                      >
                        {range.label}
                      </Link>
                    </li>
                  ))}
                  {(minPrice || maxPrice) && (
                    <li>
                      <Link href={buildHref({ minPrice: "", maxPrice: "", page: "1" })} className="filters__item">Qualquer preço</Link>
                    </li>
                  )}
                </ul>
                <p className="filters__hint">No resultado: {formatBRL(priceMin)} a {formatBRL(priceMax)}</p>
              </section>
            )}

            <section className="filters__group">
              <h2 className="filters__title">Condição</h2>
              <ul className="filters__list">
                {CONDICOES.map((c) => {
                  const count = c.key ? condCounts.get(c.key) : undefined;
                  return (
                    <li key={c.key || "all"}>
                      <Link href={buildHref({ condicao: c.key, page: "1" })} className={"filters__item " + (condicao === c.key ? "is-active" : "")}>
                        {c.label}{typeof count === "number" ? <> <span>{count}</span></> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="filters__group">
              <h2 className="filters__title">Disponibilidade</h2>
              <ul className="filters__list">
                <li>
                  <Link href={buildHref({ disponivel: "", page: "1" })} className={"filters__item " + (!disponivel ? "is-active" : "")}>Todos</Link>
                </li>
                <li>
                  <Link href={buildHref({ disponivel: "1", page: "1" })} className={"filters__item " + (disponivel === "1" ? "is-active" : "")}>Somente em estoque</Link>
                </li>
              </ul>
            </section>

            {specGroups.length > 0 && (
              <section className="filters__group">
                <h2 className="filters__title">Especificações técnicas</h2>
                {specKey && specValue && (
                  <p className="filters__hint" style={{ marginBottom: 8 }}>
                    Filtro ativo: <strong>{specValue}</strong>{" "}
                    <Link href={buildHref({ specKey: "", specValue: "", page: "1" })} className="filters__clear">remover</Link>
                  </p>
                )}
                {specGroups.map((g) => (
                  <div key={g.key} style={{ marginTop: 10 }}>
                    <h3 style={{ fontSize: 12, fontWeight: 700, margin: "0 0 4px", opacity: 0.9 }}>{g.label || g.key}</h3>
                    <ul className="filters__list">
                      {g.values.map((v) => {
                        const active = specKey === g.key && specValue === v.value;
                        return (
                          <li key={g.key + ":" + v.value}>
                            <Link
                              href={buildHref({ specKey: active ? "" : g.key, specValue: active ? "" : v.value, page: "1" })}
                              className={"filters__item " + (active ? "is-active" : "")}
                            >
                              {v.value} <span>{v.count}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            )}
          </aside>

          <div className="catalog__main">
            <header className="catalog__head">
              <div>
                <h1 className="catalog__title">{title}</h1>
                <p className="catalog__count">
                  {loadError ? "Não foi possível carregar os resultados agora." : `${total} ${total === 1 ? "produto encontrado" : "produtos encontrados"}`}
                </p>
              </div>

              <form className="catalog__sort" method="get" action="/busca">
                {q && <input type="hidden" name="q" value={q} />}
                {categoria && <input type="hidden" name="categoria" value={categoria} />}
                {brand && <input type="hidden" name="brand" value={brand} />}
                {minPrice && <input type="hidden" name="minPrice" value={minPrice} />}
                {maxPrice && <input type="hidden" name="maxPrice" value={maxPrice} />}
                {disponivel && <input type="hidden" name="disponivel" value={disponivel} />}
                {condicao && <input type="hidden" name="condicao" value={condicao} />}
                {specKey && <input type="hidden" name="specKey" value={specKey} />}
                {specValue && <input type="hidden" name="specValue" value={specValue} />}
                <label htmlFor="sort">Ordenar</label>
                <select id="sort" name="sort" defaultValue={sort}>
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <button type="submit" className="btn-primary btn-sm">Aplicar</button>
              </form>
            </header>

            {loadError ? (
              <div className="catalog__empty" role="alert">
                <p className="catalog__empty-num">!</p>
                <h2>Não foi possível carregar a busca</h2>
                <p>Verifique sua conexão e tente novamente em instantes.</p>
                <Link href={q ? "/busca?q=" + encodeURIComponent(q) : "/busca"} className="btn-primary">Tentar novamente</Link>
              </div>
            ) : products.length === 0 ? (
              <div className="catalog__empty">
                <p className="catalog__empty-num">0</p>
                <h2>{q || hasFilters ? "Nenhum produto encontrado" : "Busque no catálogo"}</h2>
                <p>
                  {q || hasFilters
                    ? "Tente outro termo, ajuste os filtros ou navegue por um departamento."
                    : "Digite um termo na busca para encontrar produtos por nome ou categoria."}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {(hasFilters || q) && <Link href="/busca" className="btn-primary">Limpar busca e filtros</Link>}
                  <Link href="/catalogo" className="btn-secondary">Ver catálogo</Link>
                </div>
              </div>
            ) : (
              <ul className="product-grid product-grid--dense">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} settings={settings} />
                ))}
              </ul>
            )}

            {!loadError && totalPages > 1 && (
              <nav className="pager" aria-label="Paginação">
                {page > 1 ? (
                  <Link href={buildHref({ page: String(page - 1) })} className="btn-secondary">{"\u2190"} Anterior</Link>
                ) : (
                  <span />
                )}
                <span className="pager__info">Página {page} de {totalPages}</span>
                {page < totalPages ? (
                  <Link href={buildHref({ page: String(page + 1) })} className="btn-secondary">Próxima {"\u2192"}</Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </div>
        </div>
      </div>

      <Footer settings={settings} />
    </main>
  );
}
