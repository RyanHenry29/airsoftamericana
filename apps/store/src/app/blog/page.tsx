// language: TSX, file: apps/store/src/app/blog/page.tsx, target: Next.js App Router
// Blog editorial: lista com filtro de categoria e paginação. Estado vazio leva ao hub de guias —
// nenhum artigo é inventado quando o painel ainda não publicou nada.
import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../components/Header";
import { MegaMenu } from "../components/MegaMenu";
import { Footer } from "../components/Footer";
import { loadHome } from "../lib/store";
import { fetchBlogCategories, fetchBlogList, formatPostDate } from "../lib/blog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog | Airsoft Americana",
  description:
    "Artigos da Airsoft Americana sobre airsoft, equipamentos, segurança e manutenção. Guias práticos escritos pela equipe.",
  alternates: { canonical: "/blog" },
};

type Params = {
  category?: string | string[];
  page?: string | string[];
  q?: string | string[];
};

const first = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? "") : (v ?? "");

function buildHref(base: Record<string, string>): string {
  const qs = new URLSearchParams(base).toString();
  return qs ? `/blog?${qs}` : "/blog";
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const category = first(params.category).trim();
  const q = first(params.q).trim();
  const requestedPage = Math.max(1, Number.parseInt(first(params.page), 10) || 1);

  const [home, categories, initial] = await Promise.all([
    loadHome(),
    fetchBlogCategories(),
    fetchBlogList({ page: requestedPage, limit: 12, category, q }),
  ]);
  const settings = home.settings;

  const list = initial.totalPages >= requestedPage ? initial : await fetchBlogList({ page: 1, limit: 12, category, q });
  const page = Math.min(Math.max(1, list.page), Math.max(1, list.totalPages));

  const hrefWith = (patch: Record<string, string>): string =>
    buildHref({
      ...(category ? { category } : {}),
      ...(q ? { q } : {}),
      ...patch,
    });

  return (
    <main className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

      <section className="inst-hero" style={{ paddingBottom: "1.5rem" }}>
        <span className="sec-kicker">Conteúdo</span>
        <h1 className="inst-hero__title">Blog da Airsoft Americana</h1>
        <p className="inst-hero__lead">
          Artigos sobre equipamentos, segurança, manutenção e vida em campo — o mesmo conteúdo que a equipe
          explica no balcão, escrito para consultar quando precisar.
        </p>
      </section>

      {categories.length > 0 && (
        <nav className="block" aria-label="Categorias do blog" style={{ paddingBottom: 0 }}>
          <ul className="blog-cats">
            <li>
              <Link
                href={hrefWith({})}
                className={`blog-cats__chip${category === "" ? " is-active" : ""}`}
              >
                Todos
                <span>{categories.reduce((sum, c) => sum + c.total, 0)}</span>
              </Link>
            </li>
            {categories.map((c) => (
              <li key={c.name}>
                <Link
                  href={hrefWith({ category: c.name })}
                  className={`blog-cats__chip${category === c.name ? " is-active" : ""}`}
                >
                  {c.name}
                  <span>{c.total}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <section className="block" aria-labelledby="blog-list-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">{category || (q ? "Busca" : "Publicações")}</span>
            <h2 id="blog-list-title" className="sec-title">
              {q ? `Resultados para “${q}”` : category || "Artigos"}
            </h2>
          </div>
          <Link href="/guia" className="sec-link">Guias da loja</Link>
        </div>

        {list.posts.length === 0 ? (
          <div className="blog-empty">
            <h3>Nenhum artigo publicado ainda</h3>
            <p>
              O blog está começando. Enquanto isso, os guias da loja estão completos e práticos — do primeiro
              jogo à escolha da primeira réplica.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.25rem" }}>
              <Link href="/guia" className="btn-primary">Ver os guias</Link>
              <Link href="/atendimento" className="btn-secondary">Falar com a equipe</Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="blog-grid">
              {list.posts.map((post) => (
                <li key={post.id} className="blog-card">
                  <Link href={`/blog/${post.slug}`} className="blog-card__link">
                    <span className="blog-card__meta">
                      <span className="blog-card__cat">{post.category}</span>
                      <span>{formatPostDate(post.publishedAt)}</span>
                      <span>{post.readingMinutes} min</span>
                    </span>
                    <h3 className="blog-card__title">{post.title}</h3>
                    {post.excerpt ? <p className="blog-card__excerpt">{post.excerpt}</p> : null}
                    <span className="blog-card__cta">Ler artigo →</span>
                  </Link>
                </li>
              ))}
            </ul>

            {list.totalPages > 1 && (
              <nav className="blog-pagination" aria-label="Paginação do blog">
                {page > 1 ? (
                  <Link
                    href={hrefWith({ page: String(page - 1) })}
                    className="blog-pagination__btn"
                  >
                    ← Anterior
                  </Link>
                ) : (
                  <span className="blog-pagination__btn is-disabled">← Anterior</span>
                )}
                <span className="blog-pagination__info">
                  Página {page} de {list.totalPages}
                </span>
                {page < list.totalPages ? (
                  <Link
                    href={hrefWith({ page: String(page + 1) })}
                    className="blog-pagination__btn"
                  >
                    Próxima →
                  </Link>
                ) : (
                  <span className="blog-pagination__btn is-disabled">Próxima →</span>
                )}
              </nav>
            )}
          </>
        )}
      </section>

      <Footer settings={settings} />
    </main>
  );
}
