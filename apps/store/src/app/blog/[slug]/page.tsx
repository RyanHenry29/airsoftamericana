// language: TSX, file: apps/store/src/app/blog/[slug]/page.tsx, target: Next.js App Router
// Artigo do blog: conteúdo em parágrafos, metadados de publicação e leitura relacionada.
// Slug inexistente ou não publicado responde notFound() — nunca um artigo fabricado.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "../../components/Header";
import { MegaMenu } from "../../components/MegaMenu";
import { SiteFooter } from "../../components/SiteFooter";
import { loadHome } from "../../lib/store";
import { fetchBlogPost, formatPostDate, paragraphs } from "../../lib/blog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const detail = await fetchBlogPost(slug);
  if (!detail) return { title: "Artigo não encontrado | Airsoft Americana" };
  const { post } = detail;
  return {
    title: post.seoTitle || `${post.title} | Airsoft Americana`,
    description: post.seoDescription || post.excerpt || undefined,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt || undefined,
      type: "article",
      publishedTime: post.publishedAt ?? undefined,
      authors: [post.author],
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const [home, detail] = await Promise.all([loadHome(), fetchBlogPost(slug)]);
  if (!detail) notFound();

  const settings = home.settings;
  const { post, related } = detail;
  const body = paragraphs(post.content);
  const published = formatPostDate(post.publishedAt);

  return (
    <main className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

      <article className="blog-article">
        <nav className="blog-article__crumbs" aria-label="Navegação estrutural">
          <Link href="/blog">Blog</Link>
          <span aria-hidden>/</span>
          {post.category ? (
            <>
              <Link href={`/blog?category=${encodeURIComponent(post.category)}`}>{post.category}</Link>
              <span aria-hidden>/</span>
            </>
          ) : null}
          <span className="is-current">{post.title}</span>
        </nav>

        <header className="blog-article__head">
          <span className="sec-kicker">{post.category}</span>
          <h1 className="blog-article__title">{post.title}</h1>
          <div className="blog-article__meta">
            <span>{post.author}</span>
            {published ? <span>{published}</span> : null}
            <span>{post.readingMinutes} min de leitura</span>
          </div>
          {post.excerpt ? <p className="blog-article__lead">{post.excerpt}</p> : null}
        </header>

        {post.coverImage ? (
          <div className="blog-article__cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.coverImage} alt="" />
          </div>
        ) : null}

        <div className="blog-article__body">
          {body.map((para, i) => (
            <p key={`${i}-${para.slice(0, 24)}`}>{para}</p>
          ))}
        </div>

        {post.tags.length > 0 && (
          <ul className="blog-article__tags" aria-label="Marcadores do artigo">
            {post.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
      </article>

      {related.length > 0 && (
        <section className="block block--border" aria-labelledby="relacionados-title">
          <div className="sec-head">
            <div>
              <span className="sec-kicker">Continue lendo</span>
              <h2 id="relacionados-title" className="sec-title">Artigos relacionados</h2>
            </div>
            <Link href="/blog" className="sec-link">Todos os artigos</Link>
          </div>
          <ul className="blog-grid">
            {related.map((r) => (
              <li key={r.id} className="blog-card">
                <Link href={`/blog/${r.slug}`} className="blog-card__link">
                  <span className="blog-card__meta">
                    <span className="blog-card__cat">{r.category}</span>
                    <span>{formatPostDate(r.publishedAt)}</span>
                    <span>{r.readingMinutes} min</span>
                  </span>
                  <h3 className="blog-card__title">{r.title}</h3>
                  {r.excerpt ? <p className="blog-card__excerpt">{r.excerpt}</p> : null}
                  <span className="blog-card__cta">Ler artigo →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SiteFooter settings={settings} />
    </main>
  );
}
