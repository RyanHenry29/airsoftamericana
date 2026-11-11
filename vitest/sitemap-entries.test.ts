// language: TS, file: vitest/sitemap-entries.test.ts, target: vitest (suite da raiz)
// Montador puro do sitemap da loja: dedupe, normalização de base, lastmod real,
// slug vazio, árvore de departamento, marca sem produto. Nada de rede aqui —
// a integração com a API (paginação/clamps) é exercitada no smoke do /sitemap.xml.
import { describe, it, expect } from "vitest";
import { STATIC_ROUTES, buildSitemapEntries } from "../apps/store/src/app/lib/sitemap-entries";

describe("STATIC_ROUTES", () => {
  it("sem path duplicado e todos começando com /", () => {
    const paths = STATIC_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
  });

  it("prioridade decrescente só no topo: raiz = 1.0", () => {
    expect(STATIC_ROUTES[0]?.path).toBe("/");
    expect(STATIC_ROUTES[0]?.priority).toBe(1);
  });
});

describe("buildSitemapEntries", () => {
  const base = "https://loja.test";

  it("normaliza base com barra final — nenhuma URL sai com //", () => {
    const out = buildSitemapEntries({ base: "https://loja.test///" });
    for (const e of out) expect(e.url.startsWith("https://loja.test//")).toBe(false);
    expect(out[0]?.url).toBe("https://loja.test/");
  });

  it("estático vence duplicata vinda do catálogo (produto chamado 'catalogo')", () => {
    const out = buildSitemapEntries({
      base,
      products: [{ slug: "catalogo" }, { slug: "/catalogo" }],
    });
    const catalogo = out.filter((e) => e.url === `${base}/catalogo`);
    expect(catalogo).toHaveLength(1);
  });

  it("slug vazio não vira rota (colidiria com a raiz)", () => {
    const out = buildSitemapEntries({ base, products: [{ slug: "" }, { slug: "   " }, { slug: "/" }] });
    expect(out.filter((e) => e.url === `${base}/`)).toHaveLength(1); // só a raiz do estático
  });

  it("lastmod: updatedAt > publishedAt > createdAt; data inválida cai para a próxima", () => {
    const out = buildSitemapEntries({
      base,
      statics: [],
      products: [
        { slug: "a", updatedAt: "2026-01-05T10:00:00Z", publishedAt: "2025-01-01T00:00:00Z" },
        { slug: "b", updatedAt: "data-invalida", publishedAt: "2025-02-01T00:00:00Z" },
        { slug: "c", publishedAt: null, createdAt: "2024-06-01T00:00:00Z" },
      ],
    });
    const get = (s: string) => out.find((e) => e.url === `${base}/${s}`);
    expect(get("a")?.lastModified?.toISOString()).toBe("2026-01-05T10:00:00.000Z");
    expect(get("b")?.lastModified?.toISOString()).toBe("2025-02-01T00:00:00.000Z");
    expect(get("c")?.lastModified?.toISOString()).toBe("2024-06-01T00:00:00.000Z");
  });

  it("sem data alguma → entrada sem lastModified (nada de 'agora' inventado)", () => {
    const out = buildSitemapEntries({ base, statics: [], products: [{ slug: "x" }] });
    expect(out[0]).toBeDefined();
    expect("lastModified" in out[0]!).toBe(false);
  });

  it("árvore de departamentos inteira vira /departamento/<slug> com prioridade por nível", () => {
    const out = buildSitemapEntries({
      base,
      departments: [
        {
          slug: "armas",
          children: [{ slug: "pistolas", children: [{ slug: "gbb" }] }],
        },
      ],
    });
    const urls = out.map((e) => e.url);
    expect(urls).toContain(`${base}/departamento/armas`);
    expect(urls).toContain(`${base}/departamento/pistolas`);
    expect(urls).toContain(`${base}/departamento/gbb`);
    expect(out.find((e) => e.url === `${base}/departamento/armas`)?.priority).toBe(0.8);
    expect(out.find((e) => e.url === `${base}/departamento/pistolas`)?.priority).toBe(0.6);
  });

  it("profundidade malufa (>5) para de descer em vez de estourar", () => {
    let deep: { slug: string; children?: unknown[] } = { slug: "n6" };
    for (let i = 5; i >= 1; i--) deep = { slug: `n${i}`, children: [deep] };
    const out = buildSitemapEntries({ base, departments: [deep as never] });
    const deptos = out.filter((e) => e.url.includes("/departamento/"));
    // n1..n5 entram (profundidade 0..4); n6 estouraria o teto → fica de fora.
    expect(deptos.map((e) => e.url)).not.toContain(`${base}/departamento/n6`);
    expect(deptos).toHaveLength(5);
  });

  it("marca com zero produto fica fora; sem informação de contagem entra", () => {
    const out = buildSitemapEntries({
      base,
      brands: [
        { slug: "com-produto", productCount: 3 },
        { slug: "sem-produto", productCount: 0 },
        { slug: "sem-info" },
      ],
    });
    const urls = out.map((e) => e.url);
    expect(urls).toContain(`${base}/marca/com-produto`);
    expect(urls).not.toContain(`${base}/marca/sem-produto`);
    expect(urls).toContain(`${base}/marca/sem-info`);
  });

  it("posts publicados entram com lastmod de publishedAt", () => {
    const out = buildSitemapEntries({
      base,
      posts: [{ slug: "primeiro-jogo", publishedAt: "2026-02-01T12:00:00Z", createdAt: "2026-01-01T00:00:00Z" }],
    });
    const post = out.find((e) => e.url === `${base}/blog/primeiro-jogo`);
    expect(post?.lastModified?.toISOString()).toBe("2026-02-01T12:00:00.000Z");
    expect(post?.changeFrequency).toBe("monthly");
  });

  it("fluxo completo: todas as fontes somam, sem duplicata em nenhuma URL", () => {
    const out = buildSitemapEntries({
      base,
      products: [{ slug: "aeg-x" }, { slug: "aeg-x" }],
      departments: [{ slug: "armas", children: [{ slug: "armas" }] }],
      brands: [{ slug: "ak", productCount: 1 }],
      posts: [{ slug: "p1", createdAt: "2026-01-01T00:00:00Z" }],
    });
    const urls = out.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    // 14 estáticos + 1 produto (dup deduplica) + 1 departamento (filho == raiz,
    // deduplica) + 1 marca + 1 post
    expect(urls).toHaveLength(14 + 1 + 1 + 1 + 1);
  });
});
