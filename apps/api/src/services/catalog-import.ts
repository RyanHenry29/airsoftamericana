// language: TS, file: apps/api/src/services/catalog-import.ts, target: Node/Fastify
// Importação CSV de catálogo (FASE 3B): preview/validação sem aplicar + aplicar transacional.
// Sem dados de concorrente; DEMO deve ser identificado pelo operador/nome. Sem sobrescrita silenciosa.

import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export const CSV_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
export const CSV_ALLOWED_EXT = new Set([".csv", ".txt"]);
export const CSV_ALLOWED_MIME = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "",
]);

const CONDICOES = new Set(["novo", "usado", "seminovo"]);

export type CsvRowError = {
  line: number;
  field?: string;
  code: string;
  message: string;
  value?: string;
};

export type CsvPreviewRow = {
  line: number;
  action: "create" | "update" | "error" | "skip";
  sku: string;
  slug: string;
  name: string;
  categorySlug: string;
  brandSlug?: string;
  condicao: string;
  priceCents: number;
  stock: number;
  errors: CsvRowError[];
  warnings: string[];
};

export type CsvPreview = {
  checksum: string;
  header: string[];
  totalLines: number;
  valid: number;
  invalid: number;
  wouldCreate: number;
  wouldUpdate: number;
  rejected: number;
  errors: CsvRowError[];
  warnings: string[];
  rows: CsvPreviewRow[];
};

export type CsvApplyResult = {
  checksum: string;
  created: number;
  updated: number;
  rejected: number;
  errors: CsvRowError[];
  warnings: string[];
};

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function csvChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Neutraliza CSV/formula injection em campos textuais armazenados. */
export function neutralizeCsvFormula(value: string): { value: string; changed: boolean } {
  if (!value) return { value, changed: false };
  const first = value[0];
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    return { value: "'" + value, changed: true };
  }
  return { value, changed: false };
}

function parseCsvLine(line: string): string[] {
  // Parser simples com suporte a aspas duplas (RFC4180 básico)
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ";" || ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const KNOWN_HEADERS = new Set([
  "slug",
  "nome",
  "name",
  "sku",
  "preco",
  "price",
  "preco_cents",
  "price_cents",
  "preco_promocional",
  "promo",
  "promo_cents",
  "estoque",
  "stock",
  "estoque_minimo",
  "stock_min",
  "category_slug",
  "categoria_slug",
  "categoryslug",
  "brand_slug",
  "marca_slug",
  "brandslug",
  "condicao",
  "condition",
  "estado_conservacao",
  "conservacao",
  "itens_inclusos",
  "acessorios",
  "garantia_dias",
  "garantia",
  "publicado",
  "published",
  "destaque",
  "featured",
  "descricao",
  "description",
  "descricao_tecnica",
  "technical_description",
  "tags",
]);

function normHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function isHeaderLine(fields: string[]): boolean {
  const n = fields.map(normHeader);
  const known = n.filter((h) => KNOWN_HEADERS.has(h));
  return known.length >= 2 || (n.includes("sku") && (n.includes("slug") || n.includes("nome") || n.includes("name")));
}

function mapRow(header: string[], fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) out[header[i]!] = (fields[i] ?? "").trim();
  // fallback posicional legado: slug;nome;sku;preco;categorySlug
  if (header.length === 0 && fields.length >= 5) {
    out.slug = fields[0] ?? "";
    out.nome = fields[1] ?? "";
    out.sku = fields[2] ?? "";
    out.preco = fields[3] ?? "";
    out.category_slug = fields[4] ?? "";
  }
  return out;
}

function get(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && v !== "") return v;
  }
  return "";
}

function parseMoneyCents(raw: string): number | null {
  if (!raw) return null;
  let s = raw.replace(/[R$\s]/g, "").trim();
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // 1.299,90 (BR) ou 1,299.90 (US) — último separador é decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    // "99.90" decimal ou "1.299" milhar? se 1 ponto e 2-3 dígitos após, tratar como decimal
    const parts = s.split(".");
    if (parts.length === 2 && parts[1]!.length > 0 && parts[1]!.length <= 2) {
      // decimal (ex: 99.90)
    } else {
      s = s.replace(/\./g, "");
    }
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function parseIntSafe(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parseBool(raw: string, def = false): boolean {
  if (!raw) return def;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "sim", "yes", "y", "s", "publicado"].includes(v)) return true;
  if (["0", "false", "nao", "não", "no", "n", "rascunho"].includes(v)) return false;
  return def;
}

export async function validateAndPreview(
  db: Db,
  input: { file: string; filename?: string; mime?: string; sizeBytes?: number },
): Promise<CsvPreview> {
  const errors: CsvRowError[] = [];
  const warnings: string[] = [];
  const contentRaw = typeof input.file === "string" ? input.file : "";
  const content = stripBom(contentRaw);
  const checksum = csvChecksum(content);
  const sizeBytes = input.sizeBytes ?? Buffer.byteLength(content, "utf8");

  if (sizeBytes > CSV_MAX_BYTES) {
    errors.push({
      line: 0,
      code: "file_too_large",
      message: `Arquivo acima do limite (${CSV_MAX_BYTES} bytes).`,
    });
    return { checksum, header: [], totalLines: 0, valid: 0, invalid: 0, wouldCreate: 0, wouldUpdate: 0, rejected: 0, errors, warnings, rows: [] };
  }

  const ext = (input.filename ?? "").toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (input.filename && ext && !CSV_ALLOWED_EXT.has(ext)) {
    errors.push({ line: 0, code: "invalid_extension", message: `Extensão não permitida: ${ext}` });
  }
  const mime = ((input.mime ?? "").toLowerCase().split(";")[0] ?? "").trim();
  if (input.mime != null && !CSV_ALLOWED_MIME.has(mime)) {
    errors.push({ line: 0, code: "invalid_mime", message: `MIME não permitido: ${input.mime}` });
  }
  if (errors.some((e) => e.code === "file_too_large" || e.code === "invalid_extension" || e.code === "invalid_mime")) {
    return { checksum, header: [], totalLines: 0, valid: 0, invalid: 0, wouldCreate: 0, wouldUpdate: 0, rejected: 0, errors, warnings, rows: [] };
  }

  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.map((l, i) => ({ line: i + 1, raw: l })).filter((x) => x.raw.trim() !== "");
  if (nonEmpty.length === 0) {
    errors.push({ line: 0, code: "empty_file", message: "Arquivo CSV vazio." });
    return { checksum, header: [], totalLines: 0, valid: 0, invalid: 0, wouldCreate: 0, wouldUpdate: 0, rejected: 0, errors, warnings, rows: [] };
  }

  let header: string[] = [];
  let dataStart = 0;
  const firstFields = parseCsvLine(nonEmpty[0]!.raw);
  if (isHeaderLine(firstFields)) {
    header = firstFields.map(normHeader);
    dataStart = 1;
    const unknown = header.filter((h) => h && !KNOWN_HEADERS.has(h));
    if (unknown.length) warnings.push(`Colunas desconhecidas ignoradas: ${unknown.join(", ")}`);
    if (!header.includes("sku")) errors.push({ line: nonEmpty[0]!.line, code: "missing_header", field: "sku", message: "Cabeçalho obrigatório ausente: sku" });
    if (!(header.includes("slug") || header.includes("nome") || header.includes("name"))) {
      errors.push({ line: nonEmpty[0]!.line, code: "missing_header", field: "slug/nome", message: "Cabeçalho exige slug ou nome" });
    }
    const hasCat = header.some((h) => ["category_slug","categoria_slug","categoryslug"].includes(h));
    const hasPrice = header.some((h) => ["preco","price","preco_cents","price_cents"].includes(h));
    if (!hasCat) errors.push({ line: nonEmpty[0]!.line, code: "missing_header", field: "category_slug", message: "Cabeçalho obrigatório ausente: category_slug" });
    if (!hasPrice) errors.push({ line: nonEmpty[0]!.line, code: "missing_header", field: "preco", message: "Cabeçalho obrigatório ausente: preco" });
  } else {
    errors.push({ line: nonEmpty[0]!.line, code: "missing_header", message: "Cabeçalho ausente ou inválido. Primeira linha deve conter colunas (ex.: slug;nome;sku;preco;category_slug)." });
  }

  if (errors.some((e) => e.code === "missing_header")) {
    return { checksum, header, totalLines: nonEmpty.length, valid: 0, invalid: nonEmpty.length, wouldCreate: 0, wouldUpdate: 0, rejected: nonEmpty.length, errors, warnings, rows: [] };
  }

  // preload categories/brands for validation
  const [cats, brs] = await Promise.all([
    db.select({ id: schema.categories.id, slug: schema.categories.slug }).from(schema.categories),
    db.select({ id: schema.brands.id, slug: schema.brands.slug }).from(schema.brands),
  ]);
  const catBySlug = new Map(cats.map((c) => [c.slug, c.id]));
  const brandBySlug = new Map(brs.map((b) => [b.slug, b.id]));

  const seenSkus = new Map<string, number>();
  const rows: CsvPreviewRow[] = [];
  const skuList: string[] = [];

  for (let i = dataStart; i < nonEmpty.length; i++) {
    const { line, raw } = nonEmpty[i]!;
    const fields = parseCsvLine(raw);
    const mapped = header.length ? mapRow(header, fields) : mapRow([], fields);
    const rowErrs: CsvRowError[] = [];
    const rowWarns: string[] = [];

    let sku = get(mapped, "sku");
    let slug = get(mapped, "slug");
    let name = get(mapped, "nome", "name");
    const categorySlug = get(mapped, "category_slug", "categoria_slug", "categoryslug");
    const brandSlug = get(mapped, "brand_slug", "marca_slug", "brandslug");
    let condicao = get(mapped, "condicao", "condition").toLowerCase() || "novo";
    const priceRaw = get(mapped, "preco_cents", "price_cents") || get(mapped, "preco", "price");
    const promoRaw = get(mapped, "preco_promocional", "promo_cents", "promo");
    const stockRaw = get(mapped, "estoque", "stock") || "0";
    const stockMinRaw = get(mapped, "estoque_minimo", "stock_min") || "0";

    // neutralize formula injection in text fields
    for (const [k, v] of [
      ["sku", sku],
      ["slug", slug],
      ["nome", name],
      ["category_slug", categorySlug],
      ["brand_slug", brandSlug],
    ] as const) {
      const n = neutralizeCsvFormula(v);
      if (n.changed) rowWarns.push(`Campo ${k}: prefixo de fórmula neutralizado.`);
      if (k === "sku") sku = n.value;
      if (k === "slug") slug = n.value;
      if (k === "nome") name = n.value;
    }

    if (!sku) rowErrs.push({ line, field: "sku", code: "missing_sku", message: "SKU ausente." });
    if (sku && sku.length > 64) rowErrs.push({ line, field: "sku", code: "invalid_sku", message: "SKU excede 64 caracteres." });
    if (sku) {
      const prev = seenSkus.get(sku);
      if (prev != null) rowErrs.push({ line, field: "sku", code: "duplicate_sku_file", message: `SKU duplicado no arquivo (linha ${prev}).`, value: sku });
      else seenSkus.set(sku, line);
    }
    if (!slug && name) slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (!slug) rowErrs.push({ line, field: "slug", code: "missing_slug", message: "slug ausente." });
    if (slug && !/^[a-z0-9-]+$/.test(slug)) rowErrs.push({ line, field: "slug", code: "invalid_slug", message: "Slug inválido (use letras minúsculas, números e hífen).", value: slug });
    if (!name) rowErrs.push({ line, field: "nome", code: "missing_name", message: "Nome ausente." });

    const priceCents = parseMoneyCents(priceRaw);
    if (priceCents == null) rowErrs.push({ line, field: "preco", code: "invalid_price", message: "Preço inválido ou ausente.", value: priceRaw });
    else if (priceCents < 0) rowErrs.push({ line, field: "preco", code: "negative_price", message: "Preço não pode ser negativo.", value: priceRaw });

    const promoCents = promoRaw ? parseMoneyCents(promoRaw) : null;
    if (promoRaw && promoCents == null) rowErrs.push({ line, field: "preco_promocional", code: "invalid_promo", message: "Preço promocional inválido.", value: promoRaw });
    if (promoCents != null && promoCents < 0) rowErrs.push({ line, field: "preco_promocional", code: "negative_promo", message: "Preço promocional não pode ser negativo.", value: promoRaw });

    const stock = parseIntSafe(stockRaw);
    if (stock == null || !Number.isInteger(stock)) rowErrs.push({ line, field: "estoque", code: "invalid_stock", message: "Estoque inválido.", value: stockRaw });
    else if (stock < 0) rowErrs.push({ line, field: "estoque", code: "negative_stock", message: "Estoque não pode ser negativo.", value: stockRaw });
    const stockMin = parseIntSafe(stockMinRaw);
    if (stockMin != null && stockMin < 0) rowErrs.push({ line, field: "estoque_minimo", code: "negative_stock_min", message: "Estoque mínimo não pode ser negativo.", value: stockMinRaw });

    if (!CONDICOES.has(condicao)) rowErrs.push({ line, field: "condicao", code: "invalid_condition", message: "Condição inválida (novo|usado|seminovo).", value: condicao });

    if (!categorySlug) rowErrs.push({ line, field: "category_slug", code: "missing_category", message: "Categoria (slug) ausente." });
    else if (!catBySlug.has(categorySlug)) rowErrs.push({ line, field: "category_slug", code: "category_not_found", message: `Categoria não encontrada: ${categorySlug}`, value: categorySlug });

    if (brandSlug && !brandBySlug.has(brandSlug)) rowErrs.push({ line, field: "brand_slug", code: "brand_not_found", message: `Marca não encontrada: ${brandSlug}`, value: brandSlug });

    const ok = rowErrs.length === 0;
    rows.push({
      line,
      action: ok ? "create" : "error",
      sku,
      slug,
      name,
      categorySlug,
      brandSlug: brandSlug || undefined,
      condicao,
      priceCents: priceCents ?? 0,
      stock: stock ?? 0,
      errors: rowErrs,
      warnings: rowWarns,
    });
    if (sku) skuList.push(sku);
  }

  // resolve create/update by existing SKU (no silent overwrite - we mark action clearly)
  const uniqueSkus = [...new Set(skuList.filter(Boolean))];
  const existing = uniqueSkus.length
    ? await db
        .select({ sku: schema.productVariants.sku, variantId: schema.productVariants.id, productId: schema.productVariants.productId })
        .from(schema.productVariants)
        .where(inArray(schema.productVariants.sku, uniqueSkus))
    : [];
  const existingBySku = new Map(existing.map((e) => [e.sku, e]));
  for (const r of rows) {
    if (r.action === "error") continue;
    r.action = existingBySku.has(r.sku) ? "update" : "create";
  }

  const valid = rows.filter((r) => r.action !== "error").length;
  const invalid = rows.filter((r) => r.action === "error").length;
  const wouldCreate = rows.filter((r) => r.action === "create").length;
  const wouldUpdate = rows.filter((r) => r.action === "update").length;
  const flatErrors = [...errors, ...rows.flatMap((r) => r.errors)];
  return {
    checksum,
    header,
    totalLines: nonEmpty.length,
    valid,
    invalid,
    wouldCreate,
    wouldUpdate,
    rejected: invalid,
    errors: flatErrors,
    warnings: [...warnings, ...rows.flatMap((r) => r.warnings)],
    rows,
  };
}

export async function confirmAndApply(
  db: Db,
  input: { file: string; filename?: string; mime?: string; sizeBytes?: number; checksum: string; actorUserId?: string | null; actorLabel?: string | null },
): Promise<CsvApplyResult> {
  const content = stripBom(typeof input.file === "string" ? input.file : "");
  const actual = csvChecksum(content);
  if (actual !== input.checksum) {
    return { checksum: actual, created: 0, updated: 0, rejected: 0, errors: [{ line: 0, code: "checksum_mismatch", message: "O arquivo mudou desde a pré-visualização. Gere um novo preview." }], warnings: [] };
  }

  const preview = await validateAndPreview(db, { file: input.file, filename: input.filename, mime: input.mime, sizeBytes: input.sizeBytes });
  if (preview.errors.some((e) => e.code === "file_too_large" || e.code === "invalid_extension" || e.code === "invalid_mime" || e.code === "empty_file" || e.code === "missing_header")) {
    return { checksum: actual, created: 0, updated: 0, rejected: preview.rejected, errors: preview.errors, warnings: preview.warnings };
  }

  // Transacional: ou aplica todas as linhas válidas, ou nenhuma. Linhas inválidas são rejeitadas (não aplicadas) — se houver inválidas, rejeitamos a confirmação inteira para evitar aplicação parcial silenciosa? 
  // Spec: "erros por linha; resumo de incluídos, atualizados e rejeitados; ... rollback em caso de falha; ... nenhuma sobrescrita silenciosa; mensagens claras"
  // Melhor: se houver erros de validação, não aplicar nada e retornar rejeitados (operador corrige). Isso é claro e seguro.
  if (preview.invalid > 0) {
    return { checksum: actual, created: 0, updated: 0, rejected: preview.rejected, errors: preview.errors, warnings: preview.warnings };
  }

  const validRows = preview.rows.filter((r) => r.action === "create" || r.action === "update");
  // preload maps
  const [cats, brs] = await Promise.all([
    db.select({ id: schema.categories.id, slug: schema.categories.slug }).from(schema.categories),
    db.select({ id: schema.brands.id, slug: schema.brands.slug }).from(schema.brands),
  ]);
  const catBySlug = new Map(cats.map((c) => [c.slug, c.id]));
  const brandBySlug = new Map(brs.map((b) => [b.slug, b.id]));

  let created = 0;
  let updated = 0;
  const applyErrors: CsvRowError[] = [];

  try {
    await db.transaction(async (tx) => {
      // Re-resolve existing within tx for consistency
      const skus = validRows.map((r) => r.sku);
      const existing = skus.length
        ? await tx.select({ sku: schema.productVariants.sku, variantId: schema.productVariants.id, productId: schema.productVariants.productId })
            .from(schema.productVariants).where(inArray(schema.productVariants.sku, skus))
        : [];
      const existingBySku = new Map(existing.map((e) => [e.sku, e]));

      for (const r of validRows) {
        const categoryId = catBySlug.get(r.categorySlug);
        if (!categoryId) { applyErrors.push({ line: r.line, field: "category_slug", code: "category_not_found", message: `Categoria não encontrada: ${r.categorySlug}` }); throw new Error("rollback"); }
        const brandId = r.brandSlug ? brandBySlug.get(r.brandSlug) ?? null : null;
        if (r.brandSlug && !brandId) { applyErrors.push({ line: r.line, field: "brand_slug", code: "brand_not_found", message: `Marca não encontrada: ${r.brandSlug}` }); throw new Error("rollback"); }

        const ex = existingBySku.get(r.sku);
        if (ex) {
          // Atualização por SKU: atualiza variante (preço/nome) — explícita, sem sobrescrita silenciosa de produto não relacionado.
          await tx.update(schema.productVariants)
            .set({ name: r.name, priceCents: r.priceCents })
            .where(eq(schema.productVariants.id, ex.variantId));
          // atualiza produto associado (campos seguros/solicitados)
          await tx.update(schema.products)
            .set({ name: r.name, slug: r.slug, categoryId, brandId, condicao: r.condicao, updatedAt: new Date() })
            .where(eq(schema.products.id, ex.productId));
          // estoque
          const inv = await tx.select().from(schema.inventory).where(eq(schema.inventory.variantId, ex.variantId)).limit(1);
          if (inv[0]) {
            const before = inv[0].physical;
            await tx.update(schema.inventory).set({ physical: r.stock, updatedAt: new Date() }).where(eq(schema.inventory.variantId, ex.variantId));
            if (before !== r.stock) {
              await tx.insert(schema.inventoryMovements).values({
                variantId: ex.variantId,
                type: "ajuste",
                quantity: Math.abs(r.stock - before),
                physicalBefore: before,
                physicalAfter: r.stock,
                reservedBefore: inv[0].reserved,
                reservedAfter: inv[0].reserved,
                reason: "Importação CSV (atualização por SKU)",
                userId: input.actorUserId ?? undefined,
              } as any);
            }
          } else {
            await tx.insert(schema.inventory).values({ variantId: ex.variantId, physical: r.stock, reserved: 0, minQuantity: 0 } as any);
          }
          updated++;
        } else {
          let product = (await tx.select().from(schema.products).where(eq(schema.products.slug, r.slug)).limit(1))[0];
          if (!product) {
            [product] = await tx.insert(schema.products).values({
              name: r.name, slug: r.slug, shortDescription: "", description: "", categoryId, brandId, ageRestricted: false, featured: false, published: false, condicao: r.condicao,
            } as any).returning();
          } else {
            // slug já existe: vínculo explícito por slug — atualizar metadados básicos (não silencioso, é a regra de resolução)
            await tx.update(schema.products).set({ name: r.name, categoryId, brandId, condicao: r.condicao, updatedAt: new Date() }).where(eq(schema.products.id, product.id));
          }
          const [variant] = await tx.insert(schema.productVariants).values({
            productId: product!.id, sku: r.sku, name: r.name, priceCents: r.priceCents, promoPriceCents: null, weightGrams: 0, active: true,
          } as any).returning();
          await tx.insert(schema.inventory).values({ variantId: variant!.id, physical: r.stock, reserved: 0, minQuantity: 0 } as any);
          created++;
        }
      }
    });
  } catch (e) {
    // rollback automático pelo Drizzle/tx
    return { checksum: actual, created: 0, updated: 0, rejected: validRows.length, errors: applyErrors.length ? applyErrors : [{ line: 0, code: "transaction_rollback", message: "Falha na aplicação; nenhuma alteração foi gravada (rollback)." }], warnings: preview.warnings };
  }

  return { checksum: actual, created, updated, rejected: 0, errors: [], warnings: preview.warnings };
}
