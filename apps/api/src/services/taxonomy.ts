// language: TS, file: apps/api/src/services/taxonomy.ts, target: Fastify 5
/**
 * Taxonomia de categorias.
 *
 * O espelho da loja tem três níveis (departamento → categoria → subcategoria)
 * e os slugs são hierárquicos ("airsoft-acessorios-para-airsoft-anpeq").
 * O menu navega por qualquer um desses níveis — então a resolução de
 * departamento precisa aceitar QUALQUER categoria, não só a raiz, e os
 * produtos de um departamento são os da subárvore inteira.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export interface TaxonomyNode {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  ageRestricted: boolean;
  active: boolean;
  position: number;
}

/** Todas as categorias ativas, ordenadas como o menu espera. */
export async function loadTaxonomy(db: Db): Promise<TaxonomyNode[]> {
  const rows = await db
    .select({
      id: schema.categories.id,
      parentId: schema.categories.parentId,
      slug: schema.categories.slug,
      name: schema.categories.name,
      description: schema.categories.description,
      imageUrl: schema.categories.imageUrl,
      ageRestricted: schema.categories.ageRestricted,
      active: schema.categories.active,
      position: schema.categories.position,
    })
    .from(schema.categories)
    .where(eq(schema.categories.active, true))
    .orderBy(asc(schema.categories.position), asc(schema.categories.name));
  return rows.map((r) => ({ ...r, description: r.description ?? "" }));
}

export function findBySlug(nodes: TaxonomyNode[], slug: string): TaxonomyNode | undefined {
  return nodes.find((n) => n.slug === slug);
}

export function childrenOf(nodes: TaxonomyNode[], parentId: string): TaxonomyNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

/** A própria categoria + todos os descendentes (qualquer nível). */
export function subtreeOf(nodes: TaxonomyNode[], node: TaxonomyNode): TaxonomyNode[] {
  const collected: TaxonomyNode[] = [node];
  const queue: string[] = [node.id];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const child of childrenOf(nodes, currentId)) {
      collected.push(child);
      queue.push(child.id);
    }
  }
  return collected;
}

/** Ids de toda a subárvore (a categoria e os descendentes). */
export function subtreeIds(nodes: TaxonomyNode[], node: TaxonomyNode): string[] {
  return subtreeOf(nodes, node).map((n) => n.id);
}

/**
 * Produtos publicados por categoria — contagem no banco, uma consulta só.
 * O produto pertence a UMA categoria (a folha), então a contagem de um
 * departamento é a soma das contagens da subárvore.
 */
export async function countProductsByCategory(
  db: Db,
  categoryIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (categoryIds.length === 0) return counts;
  const rows = await db
    .select({ categoryId: schema.products.categoryId, total: sql`count(*)::int` })
    .from(schema.products)
    .where(
      and(
        inArray(schema.products.categoryId, categoryIds),
        // Contagem exibida ao cliente: só publicado, nunca soma rascunho.
        eq(schema.products.published, true),
      ),
    )
    .groupBy(schema.products.categoryId);
  for (const row of rows) counts.set(row.categoryId, Number(row.total));
  return counts;
}
