// language: TS, file: apps/api/src/routes/admin-ai.ts, target: Fastify 5
//
// Assistente de cadastro (admin-only). Fluxo:
//   POST /api/admin/ai/messages → grounding real do banco → Groq (vision) →
//   rascunho validado (zod + conferência de ids no DB) → grava conversa/mensagem/
//   rascunho → o admin confirma no formulário → POST /api/admin/products (já existente).
// A IA NUNCA publica: publicação continua passando pela rota auditada de produtos.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import type { Config } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminGuard } from "../lib/rbac.js";
import { csrfGuard } from "../lib/csrf.js";
import { authRateLimit } from "../middleware/authRateLimit.js";
import { badRequest, notFound } from "../lib/errors.js";
import {
  AI_MAX_BODY_BYTES,
  AI_MAX_IMAGE_BYTES,
  AI_MAX_IMAGES,
  buildGrounding,
  buildSystemPrompt,
  decodeImage,
  groqTurn,
  loadHistory,
  repairDraft,
  type ChatMessage,
} from "../services/ai-assistant.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const messageBodySchema = z.object({
  conversationId: z.string().regex(UUID_RE, "Conversa inválida").optional(),
  content: z.string().trim().min(1, "Mensagem vazia").max(4000),
  images: z.array(z.string().min(1)).max(AI_MAX_IMAGES).default([]),
});

const draftPatchSchema = z.object({
  status: z.enum(["descartado", "publicado"]),
  productId: z.string().regex(UUID_RE).optional(),
});

function userIdOf(request: FastifyRequest): string {
  const user = (request as any).user as { sub?: string } | undefined;
  if (!user?.sub) throw badRequest("ai_no_user", "Sessão sem usuário.");
  return user.sub;
}

/** Conversa existe e pertence ao solicitante (superadmin não atravessa a lista do colega). */
async function ownedConversation(db: Db, id: string, userId: string) {
  const [row] = await db
    .select()
    .from(schema.aiConversations)
    .where(eq(schema.aiConversations.id, id))
    .limit(1);
  if (!row) throw notFound("Conversa não encontrada.");
  if (row.actorUserId && row.actorUserId !== userId) throw notFound("Conversa não encontrada.");
  return row;
}

export function registerAdminAiRoutes(app: FastifyInstance, db: Db, config: Config): void {
  const A = authMiddleware;
  // Balde por registro: em produção há um; na suíte (isolate:false) cada app
  // ganha seu próprio balde e os testes não se contaminam entre si.
  const aiRateLimit = authRateLimit({
    scope: `ai:${Math.random().toString(36).slice(2)}`,
    max: 12,
    windowMs: 60_000,
    blockMs: 60_000,
    message: "Muitas mensagens ao assistente em um minuto. Aguarde um instante e tente de novo.",
  });
  // Cada rota declara adminGuard inline (teste B.6 exige o guard visível na declaração).

  // ------------------------------------------------------------ conversas
  app.get("/api/admin/ai/conversations", { preHandler: [A, adminGuard("products", "read")] }, async (request, reply) => {
    const userId = userIdOf(request);
    const rows = await db
      .select({
        id: schema.aiConversations.id,
        title: schema.aiConversations.title,
        createdAt: schema.aiConversations.createdAt,
        updatedAt: schema.aiConversations.updatedAt,
      })
      .from(schema.aiConversations)
      .where(eq(schema.aiConversations.actorUserId, userId))
      .orderBy(desc(schema.aiConversations.updatedAt))
      .limit(50);
    reply.send({ conversations: rows });
  });

  app.get("/api/admin/ai/conversations/:id", { preHandler: [A, adminGuard("products", "read")] }, async (request, reply) => {
    const userId = userIdOf(request);
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) throw notFound("Conversa não encontrada.");
    const conversation = await ownedConversation(db, id, userId);
    const messages = await db
      .select({
        id: schema.aiMessages.id,
        role: schema.aiMessages.role,
        content: schema.aiMessages.content,
        uploadIds: schema.aiMessages.uploadIds,
        createdAt: schema.aiMessages.createdAt,
      })
      .from(schema.aiMessages)
      .where(eq(schema.aiMessages.conversationId, id))
      .orderBy(schema.aiMessages.createdAt)
      .limit(200);
    const drafts = await db
      .select({
        id: schema.aiDrafts.id,
        status: schema.aiDrafts.status,
        payload: schema.aiDrafts.payload,
        flags: schema.aiDrafts.flags,
        uploadIds: schema.aiDrafts.uploadIds,
        productId: schema.aiDrafts.productId,
        createdAt: schema.aiDrafts.createdAt,
      })
      .from(schema.aiDrafts)
      .where(eq(schema.aiDrafts.conversationId, id))
      .orderBy(desc(schema.aiDrafts.createdAt))
      .limit(50);
    reply.send({ conversation, messages, drafts });
  });

  app.delete("/api/admin/ai/conversations/:id", { preHandler: [aiRateLimit, A, csrfGuard, adminGuard("products", "create")] }, async (request, reply) => {
    const userId = userIdOf(request);
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) throw notFound("Conversa não encontrada.");
    await ownedConversation(db, id, userId);
    await db.delete(schema.aiConversations).where(eq(schema.aiConversations.id, id));
    reply.send({ ok: true });
  });

  // ------------------------------------------------------------ mensagem
  app.post("/api/admin/ai/messages", { bodyLimit: AI_MAX_BODY_BYTES, preHandler: [aiRateLimit, A, csrfGuard, adminGuard("products", "create")] }, async (request, reply) => {
      const userId = userIdOf(request);
      const parsedBody = messageBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        throw badRequest("ai_invalid_body", parsedBody.error.issues[0]?.message ?? "Dados inválidos");
      }
      const body = parsedBody.data;
      if (body.images.length > AI_MAX_IMAGES) {
        throw badRequest("ai_too_many_images", `No máximo ${AI_MAX_IMAGES} imagens por mensagem.`);
      }

      // 1) Imagens: base64 → Buffer, magic bytes, limite de tamanho → bytea.
      const uploads: { id: string; mime: string; b64: string }[] = [];
      for (const data of body.images) {
        const { buf, mime } = decodeImage(data); // lança 400 cedo, antes de qualquer escrita
        const [row] = await db
          .insert(schema.aiUploads)
          .values({
            actorUserId: userId,
            filename: `foto-${uploads.length + 1}`,
            mime,
            bytes: buf,
            sizeBytes: buf.length,
          })
          .returning();
        const b64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
        uploads.push({ id: row!.id, mime: row!.mime, b64 });
      }

      // 2) Conversa: valida posse quando informada; cria só após sucesso do Groq.
      let conversationId = body.conversationId ?? null;
      if (conversationId) await ownedConversation(db, conversationId, userId);
      const prior = conversationId ? await loadHistory(db, conversationId, 11) : [];

      // 3) Grounding real + turno atual (texto + imagens como data URLs).
      const grounding = await buildGrounding(db);
      const systemPrompt = buildSystemPrompt(grounding);
      const turnContent: Array<Record<string, unknown>> = [{ type: "text", text: body.content }];
      for (const u of uploads) {
        turnContent.push({ type: "image_url", image_url: { url: `data:${u.mime};base64,${u.b64}` } });
      }
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...prior,
        { role: "user", content: turnContent },
      ];

      // 4) Groq → contrato zod → conferência de ids no DB. Falha = 503 rotulado.
      const turn = await groqTurn(config, messages);

      // 5) Persistência (só depois da resposta válida — nada fica meio-feito).
      if (!conversationId) {
        const [conv] = await db
          .insert(schema.aiConversations)
          .values({ actorUserId: userId, title: body.content.slice(0, 80) || "Nova conversa" })
          .returning();
        conversationId = conv!.id;
      } else {
        await db
          .update(schema.aiConversations)
          .set({ updatedAt: new Date() })
          .where(eq(schema.aiConversations.id, conversationId));
      }

      const uploadIds = uploads.map((u) => u.id);
      const [userMsg] = await db
        .insert(schema.aiMessages)
        .values({ conversationId, role: "user", content: body.content, uploadIds })
        .returning();
      const [aiMsg] = await db
        .insert(schema.aiMessages)
        .values({ conversationId, role: "assistant", content: turn.reply, uploadIds: [] })
        .returning();

      let draft: { id: string; status: string; payload: unknown; flags: string[]; uploadIds: string[] } | null = null;
      if (turn.draft) {
        const { payload, flags } = await repairDraft(db, turn.draft);
        const [d] = await db
          .insert(schema.aiDrafts)
          .values({
            conversationId,
            actorUserId: userId,
            status: "pendente",
            payload,
            flags,
            uploadIds,
          })
          .returning();
        draft = { id: d!.id, status: d!.status, payload, flags, uploadIds };
      }

      reply.send({
        conversationId,
        userMessage: { id: userMsg!.id, content: body.content, uploadIds, createdAt: userMsg!.createdAt },
        assistantMessage: { id: aiMsg!.id, content: turn.reply, createdAt: aiMsg!.createdAt },
        draft,
      });
  });

  // ------------------------------------------------------------ rascunho
  app.patch("/api/admin/ai/drafts/:id", { preHandler: [aiRateLimit, A, csrfGuard, adminGuard("products", "create")] }, async (request, reply) => {
    const userId = userIdOf(request);
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) throw notFound("Rascunho não encontrado.");
    const parsedBody = draftPatchSchema.safeParse(request.body);
    if (!parsedBody.success) {
      throw badRequest("ai_invalid_body", parsedBody.error.issues[0]?.message ?? "Dados inválidos");
    }
    const body = parsedBody.data;

    const [draft] = await db.select().from(schema.aiDrafts).where(eq(schema.aiDrafts.id, id)).limit(1);
    if (!draft || (draft.actorUserId && draft.actorUserId !== userId)) {
      throw notFound("Rascunho não encontrado.");
    }
    if (draft.status === "publicado") throw badRequest("ai_draft_locked", "Rascunho já publicado.");

    if (body.status === "publicado") {
      if (!body.productId) throw badRequest("ai_product_required", "Informe o productId criado ao publicar.");
      const [product] = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.id, body.productId))
        .limit(1);
      if (!product) throw notFound("Produto informado não existe.");
    }

    await db
      .update(schema.aiDrafts)
      .set({
        status: body.status,
        productId: body.status === "publicado" ? body.productId! : draft.productId,
        updatedAt: new Date(),
      })
      .where(eq(schema.aiDrafts.id, id));
    reply.send({ ok: true, id, status: body.status });
  });

  // ------------------------------------------------------------ upload (bytes)
  app.get("/api/admin/ai/uploads/:id", { preHandler: [A, adminGuard("products", "read")] }, async (request, reply) => {
    const userId = userIdOf(request);
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) throw notFound("Imagem não encontrada.");
    const [row] = await db
      .select({ mime: schema.aiUploads.mime, bytes: schema.aiUploads.bytes, actorUserId: schema.aiUploads.actorUserId })
      .from(schema.aiUploads)
      .where(eq(schema.aiUploads.id, id))
      .limit(1);
    if (!row || (row.actorUserId && row.actorUserId !== userId)) throw notFound("Imagem não encontrada.");
    reply
      .header("content-type", row.mime)
      .header("cache-control", "private, max-age=86400")
      .send(Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes as unknown as Uint8Array));
  });
}
