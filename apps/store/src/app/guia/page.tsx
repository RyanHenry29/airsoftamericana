// language: TSX, file: apps/store/src/app/guia/page.tsx, target: Next.js App Router
// Hub de guias: índice dos guias da loja + artigos recentes do blog.
import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../components/Header";
import { MegaMenu } from "../components/MegaMenu";
import { SiteFooter } from "../components/SiteFooter";
import { loadHome } from "../lib/store";
import { fetchBlogList, formatPostDate } from "../lib/blog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guias de airsoft | Airsoft Americana",
  description:
    "Guias práticos da Airsoft Americana: primeiro jogo, escolha da primeira AEG e comparativo GBB vs HPA.",
  alternates: { canonical: "/guia" },
};

const GUIDES = [
  {
    href: "/guia/primeiro-jogo",
    title: "Checklist de primeiro jogo",
    desc: "Proteção ocular, réplica, BBs, bateria, manutenção e loadout: o que levar e o que priorizar na primeira partida.",
  },
  {
    href: "/guia/escolher-primeira-aeg",
    title: "Como escolher sua primeira AEG",
    desc: "Sistemas de propulsão, gearbox, bateria, orçamento e o que verificar antes de fechar a compra.",
  },
  {
    href: "/guia/gbb-vs-hpa",
    title: "GBB vs HPA: qual vale a pena?",
    desc: "Realismo, manutenção, custo por partida e consistência de FPS comparados lado a lado.",
  },
];

export default async function GuiaIndexPage() {
  const [home, blog] = await Promise.all([loadHome(), fetchBlogList({ limit: 3 })]);
  const settings = home.settings;

  return (
    <main className="page-shell">
      <Header />
      <MegaMenu departments={home.departments} />

      <section className="inst-hero" style={{ paddingBottom: "1.5rem" }}>
        <span className="sec-kicker">Conteúdo</span>
        <h1 className="inst-hero__title">Guias da Airsoft Americana</h1>
        <p className="inst-hero__lead">
          Material prático escrito pela equipe: por onde começar, o que comprar e como evoluir sem gastar à toa.
          Em dúvida de compatibilidade, fale com a gente antes de fechar o pedido.
        </p>
      </section>

      <section className="block" aria-labelledby="guias-list-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Guias</span>
            <h2 id="guias-list-title" className="sec-title">Comece por aqui</h2>
          </div>
          <Link href="/atendimento" className="sec-link">Falar com especialista</Link>
        </div>
        <ul className="guias-grid">
          {GUIDES.map((g) => (
            <li key={g.href} className="guia-card">
              <h3>{g.title}</h3>
              <p>{g.desc}</p>
              <Link href={g.href} className="guia-link">
                Ler o guia →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {blog.posts.length > 0 && (
        <section className="block block--border" aria-labelledby="guias-blog-title">
          <div className="sec-head">
            <div>
              <span className="sec-kicker">Blog</span>
              <h2 id="guias-blog-title" className="sec-title">Artigos recentes</h2>
            </div>
            <Link href="/blog" className="sec-link">Ver o blog</Link>
          </div>
          <ul className="blog-grid">
            {blog.posts.map((post) => (
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
        </section>
      )}

      <SiteFooter settings={settings} />
    </main>
  );
}
