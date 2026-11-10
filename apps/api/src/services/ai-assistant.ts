// language: TS, file: apps/api/src/services/ai-assistant.ts, target: Fastify 5 (Node 20+)
//
// Assistente de cadastro (admin-only): fotos do produto → rascunho pré-preenchido.
// REGRAS ANTI-ALUCINAÇÃO (não negociáveis):
//   1. Todo o grounding (categorias, marcas, produtos existentes, regras comerciais)
//      vem do banco real — o modelo só escolhe dentre opções fornecidas.
//   2. O schema de saída do modelo NÃO contém preço nem estoque: esses campos são
//      sempre null no rascunho e só existem depois que o admin digita.
//   3. categoryId/brandId são conferidos contra o DB depois do parse: id inexistente
//      vira null + flag visível no painel.
//   4. Slug e SKU são gerados no servidor (derivados do nome, deduplicados no DB).
//   5. O rascunho nunca publica: o admin confirma e o produto nasce pelo
//      POST /api/admin/products já auditado.
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import type { Config } from "../config.js";
import { getCommercialSettings } from "./settings.js";
import { badRequest, serviceUnavailable } from "../lib/errors.js";

// Limites abaixo do teto de 4,5 MB de body da Vercel (base64 infla ~4/3):
// 3 × 800 KB binário ≈ 3,2 MB no JSON. Cliente comprime para ~1280px JPEG.
export const AI_MAX_IMAGES = 3;
export const AI_MAX_IMAGE_BYTES = 800 * 1024;
export const AI_MAX_BODY_BYTES = 4 * 1024 * 1024;
const GROQ_TIMEOUT_MS = 45_000;

// ------------------------------------------------------------------ imagem
/** Valida magic bytes: só jpeg/png/webp entram (o nome do arquivo nunca decide). */
export function sniffImageMime(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(pngSig)) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** base64 (com ou sem prefixo data:) → Buffer validado por magic bytes e tamanho. */
export function decodeImage(data: string): { buf: Buffer; mime: string } {
  const b64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  if (!b64 || b64.length > Math.ceil((AI_MAX_IMAGE_BYTES * 4) / 3) + 1024) {
    throw badRequest("ai_image_too_large", `Imagem excede ${Math.round(AI_MAX_IMAGE_BYTES / 1024)} KB. Comprima antes de enviar.`);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    throw badRequest("ai_image_invalid", "Imagem em base64 inválida.");
  }
  if (buf.length === 0 || buf.length > AI_MAX_IMAGE_BYTES) {
    throw badRequest("ai_image_too_large", `Imagem excede ${Math.round(AI_MAX_IMAGE_BYTES / 1024)} KB.`);
  }
  const mime = sniffImageMime(buf);
  if (!mime) throw badRequest("ai_image_type", "Formato não suportado: envie JPEG, PNG ou WebP.");
  return { buf, mime };
}

// ------------------------------------------------------------- grounding
export type Grounding = {
  categories: { id: string; name: string; path: string }[];
  brands: { id: string; name: string }[];
  recentProducts: { name: string; slug: string }[];
  commercial: Awaited<ReturnType<typeof getCommercialSettings>>;
};

/** Lê o banco real e monta o conjunto de opções válidas para o modelo. */
export async function buildGrounding(db: Db): Promise<Grounding> {
  const cats = await db
    .select({ id: schema.categories.id, name: schema.categories.name, slug: schema.categories.slug, parentId: schema.categories.parentId, active: schema.categories.active })
    .from(schema.categories)
    .orderBy(schema.categories.position, schema.categories.name);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (c: (typeof cats)[number]): string => {
    const parts = [c.name];
    let p = c.parentId ? byId.get(c.parentId) : undefined;
    let guard = 0;
    while (p && guard++ < 6) {
      parts.unshift(p.name);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return parts.join(" > ");
  };
  const categories = cats.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, path: pathOf(c) }));

  const brandRows = await db
    .select({ id: schema.brands.id, name: schema.brands.name })
    .from(schema.brands)
    .where(eq(schema.brands.active, true))
    .orderBy(schema.brands.position, schema.brands.name);

  const productRows = await db
    .select({ name: schema.products.name, slug: schema.products.slug })
    .from(schema.products)
    .orderBy(desc(schema.products.createdAt))
    .limit(300);

  const commercial = await getCommercialSettings(db);
  return { categories, brands: brandRows, recentProducts: productRows, commercial };
}

// ------------------------------------------------- schema do modelo (saída)
/** O modelo NUNCA emite preço/estoque/slug/SKU — campos ausentes por design. */
const modelDraftSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(8000).default(""),
  shortDescription: z.string().trim().max(500).default(""),
  color: z.string().trim().max(60).default(""),
  technical: z
    .record(z.string().trim().min(1).max(60), z.string().trim().max(500))
    .default({}),
  categoryId: z.string().max(64).default(""),
  brandId: z.string().max(64).default(""),
  condicao: z.enum(["novo", "usado", "seminovo"]).default("novo"),
  estadoConservacao: z.string().trim().max(120).default(""),
  tags: z.string().trim().max(500).default(""),
  seoTitle: z.string().trim().max(200).default(""),
  seoDescription: z.string().trim().max(320).default(""),
  variantName: z.string().trim().min(1).max(120).default("Padrão"),
  weightGrams: z.number().int().min(0).max(30000).default(0),
  /** Campos que o modelo não conseguiu determinar a partir das fotos/texto. */
  uncertainFields: z.array(z.string().trim().max(80)).max(20).default([]),
});

const aiTurnSchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  draft: modelDraftSchema.nullable().default(null),
});

export type AiTurn = z.infer<typeof aiTurnSchema>;

// -------------------------------------------- schema do rascunho persistido
export const draftPayloadSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(2).max(160),
  sku: z.string().trim().min(1).max(64),
  description: z.string().trim().max(20000).default(""),
  shortDescription: z.string().trim().max(500).default(""),
  color: z.string().trim().max(60).default(""),
  technical: z.record(z.string(), z.string()).default({}),
  categoryId: z.string().nullable(),
  brandId: z.string().nullable(),
  condicao: z.enum(["novo", "usado", "seminovo"]),
  estadoConservacao: z.string().trim().max(120).default(""),
  tags: z.string().trim().max(500).default(""),
  seoTitle: z.string().trim().max(200).default(""),
  seoDescription: z.string().trim().max(320).default(""),
  variantName: z.string().trim().min(1).max(120),
  weightGrams: z.number().int().min(0).max(30000),
  /** Sempre null na criação do rascunho — preço é decisão do lojista. */
  priceCents: z.number().int().nullable().default(null),
  promoPriceCents: z.number().int().nullable().default(null),
  stockPhysical: z.number().int().nullable().default(null),
  stockMin: z.number().int().default(0),
});

export type DraftPayload = z.infer<typeof draftPayloadSchema>;

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "produto";
}

/** Slug único conferindo o DB (produto publicado com slug igual não pode ser duplicado). */
async function uniqueSlug(db: Db, base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const [hit] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.slug, candidate))
      .limit(1);
    if (!hit) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** SKU derivado do slug (prefixo curto + sufixo estável do nome). */
function deriveSku(name: string, slug: string): string {
  const head = slug.replace(/-/g, "").slice(0, 16).toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 65536;
  return `${head || "PROD"}-${hash.toString(36).toUpperCase().padStart(4, "0")}`;
}

export type RepairedDraft = {
  payload: DraftPayload;
  flags: string[];
};

/**
 * Contra-bate a saída do modelo com o DB real.
 * id inválido → null + flag; slug/SKU gerados no servidor; preço/estoque fixos em null.
 */
export async function repairDraft(db: Db, raw: AiTurn["draft"]): Promise<RepairedDraft> {
  if (!raw) throw badRequest("ai_no_draft", "O modelo não retornou rascunho.");
  const flags: string[] = [];

  const validCatIds = new Set(
    (await db.select({ id: schema.categories.id }).from(schema.categories)).map((c) => c.id),
  );
  const validBrandIds = new Set(
    (await db.select({ id: schema.brands.id }).from(schema.brands)).map((b) => b.id),
  );

  let categoryId: string | null = null;
  if (raw.categoryId && validCatIds.has(raw.categoryId)) {
    categoryId = raw.categoryId;
  } else if (raw.categoryId) {
    flags.push("categoryId inválida ignorada — selecione a categoria manualmente");
  } else {
    flags.push("Categoria não identificada — selecione manualmente");
  }

  let brandId: string | null = null;
  if (raw.brandId && validBrandIds.has(raw.brandId)) {
    brandId = raw.brandId;
  } else if (raw.brandId) {
    flags.push("brandId inválida ignorada — selecione a marca manualmente");
  }

  if ((raw.condicao === "usado" || raw.condicao === "seminovo") && !raw.estadoConservacao.trim()) {
    flags.push("Condição usada/seminovo exige estado de conservação — preencha ou mude para novo");
  }
  if (raw.uncertainFields.length) {
    flags.push(`Modelo marcou como incerto: ${raw.uncertainFields.join(", ")}`);
  }

  const slug = await uniqueSlug(db, raw.name);
  const payload = draftPayloadSchema.parse({
    name: raw.name,
    slug,
    sku: deriveSku(raw.name, slug),
    description: raw.description,
    shortDescription: raw.shortDescription,
    color: raw.color,
    technical: raw.technical,
    categoryId,
    brandId,
    condicao: raw.condicao,
    estadoConservacao: raw.estadoConservacao,
    tags: raw.tags,
    seoTitle: raw.seoTitle || raw.name.slice(0, 200),
    seoDescription: raw.seoDescription,
    variantName: raw.variantName,
    weightGrams: raw.weightGrams,
    priceCents: null,
    promoPriceCents: null,
    stockPhysical: null,
    stockMin: 0,
  });
  return { payload, flags };
}

// ------------------------------------------------------------------ prompt
function groundingText(g: Grounding): string {
  const catLines = g.categories.map((c) => `- ${c.id} | ${c.path}`).join("\n") || "(nenhuma)";
  const brandLines = g.brands.map((b) => `- ${b.id} | ${b.name}`).join("\n") || "(nenhuma)";
  const productLines = g.recentProducts.map((p) => `- ${p.name} (${p.slug})`).join("\n") || "(nenhum)";
  const c = g.commercial;
  return [
    "CATEGORIAS VÁLIDAS (use exatamente o id, nunca invente outro):",
    catLines,
    "",
    "MARCAS VÁLIDAS (use exatamente o id ou \"\" se nenhuma):",
    brandLines,
    "",
    "PRODUTOS JÁ CADASTRADOS (não repita nem crie slug parecido):",
    productLines,
    "",
    "REGRAS COMERCIAIS DA LOJA (só para texto de venda; NUNCA invente preço):",
    `- desconto PIX: ${c.pix_discount_percent}%`,
    `- parcelamento: ${c.installments}x${c.installment_interest_free ? " sem juros" : " com juros"} (mínimo R$ ${(c.min_installment_cents / 100).toFixed(2)})`,
    `- frete grátis acima de R$ ${(c.free_shipping_from_cents / 100).toFixed(2)}`,
  ].join("\n");
}

export function buildSystemPrompt(g: Grounding): string {
  return [
    "Você é o especialista de cadastro de produtos da loja Airsoft Americana (armas e equipamentos de airsoft).",
    "Sua tarefa: ler as fotos e o texto do administrador e devolver um rascunho de cadastro completo e fiel ao que existe no material.",
    "",
    "REGRAS RÍGIDAS (violação = alucinação):",
    "1. categoryId e brandId DEVEM ser ids copiados exatamente da lista de grounding. Se não houver correspondência clara, devolva \"\".",
    "2. PROIBIDO inventar preço, promoção, estoque ou prazo de entrega — esses campos não existem no seu schema.",
    "3. PROIBIDO inventar especificação que não esteja visível na foto ou escrita no texto. Especificações duvidosas entram em uncertainFields.",
    "4. Nunca repita o nome/slug de um produto já cadastrado (lista fornecida).",
    "5. description em português do Brasil, direto ao ponto, sem promessas falsas; technical só com atributos reais (ex.: \"Cor\", \"Material\", \"Capacidade\").",
    "6. condicao: \"novo\" salvo evidência clara de uso; usado/seminovo exige estadoConservacao.",
    "",
    "RESPOSTA (sempre JSON puro, sem markdown):",
    '{"reply": "<mensagem curta em pt-BR para o administrador>", "draft": <objeto do rascunho> | null}',
    "draft só quando houver material suficiente para um cadastro; conversa pura → draft null.",
    "",
    "GROUNDING (banco real da loja):",
    groundingText(g),
  ].join("\n");
}

// ------------------------------------------------------------------ Groq
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user" | "assistant"; content: string | Array<Record<string, unknown>> };

/**
 * Chamada única ao Groq (OpenAI-compatible) com JSON Object Mode.
 * Falha vira 503 rotulado — nunca silêncio, nunca resposta inventada.
 */
export async function groqTurn(config: Config, messages: ChatMessage[]): Promise<AiTurn> {
  if (!config.GROQ_API_KEY) {
    throw serviceUnavailable(
      "ai_not_configured",
      "Assistente de IA não configurado: defina a variável GROQ_API_KEY na API (console.groq.com → API Keys).",
    );
  }
  let res: Response;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.GROQ_MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_completion_tokens: 6000,
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw serviceUnavailable(
      timedOut ? "ai_timeout" : "ai_unreachable",
      timedOut ? "O serviço de IA não respondeu a tempo. Tente novamente." : "Falha ao contatar o serviço de IA.",
    );
  }
  if (!res.ok) {
    const detail = res.status === 401 ? "chave GROQ_API_KEY inválida" : `HTTP ${res.status}`;
    throw serviceUnavailable("ai_upstream_error", `Serviço de IA recusou a chamada (${detail}).`);
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw serviceUnavailable("ai_empty_response", "Serviço de IA retornou resposta vazia.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw serviceUnavailable("ai_bad_response", "Serviço de IA retornou JSON inválido. Tente novamente.");
  }
  const turn = aiTurnSchema.safeParse(parsed);
  if (!turn.success) {
    throw serviceUnavailable("ai_bad_response", "Resposta do serviço de IA fora do contrato esperado.");
  }
  return turn.data;
}

// ------------------------------------------------------- histórico p/ Groq
/** Últimas N mensagens em texto (imagens antigas não reenviam — economia de tokens). */
export async function loadHistory(db: Db, conversationId: string, limit = 12): Promise<ChatMessage[]> {
  const rows = await db
    .select({ role: schema.aiMessages.role, content: schema.aiMessages.content, createdAt: schema.aiMessages.createdAt })
    .from(schema.aiMessages)
    .where(eq(schema.aiMessages.conversationId, conversationId))
    .orderBy(desc(schema.aiMessages.createdAt))
    .limit(limit);
  return rows
    .reverse()
    .map((r) => ({ role: (r.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: r.content }));
}
