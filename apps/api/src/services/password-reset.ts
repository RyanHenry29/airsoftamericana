// language: TS, file: apps/api/src/services/password-reset.ts, target: Fastify 5 + Node 20
/**
 * Redefinição de senha do cliente ("esqueci a senha").
 *
 * Segredos do fluxo:
 * - o token cru existe só no e-mail; a tabela guarda sha256 hex (igual sessions);
 * - TTL de 60 min, um token ativo por cliente (criar queima os anteriores);
 * - consumo atômico: UPDATE ... WHERE used_at IS NULL — dois cliques no link
 *   viram um 400, não duas trocas de senha;
 * - resposta da rota é sempre genérica (anti-enumeration): a existência do
 *   e-mail nunca muda o que o cliente vê.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { hashPassword, randomToken, sha256 } from "../lib/crypto.js";
import { outboxNotify } from "./outbox.js";

const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutos

/** Falha de envio rotulada — a rota decide o que responder (nunca silêncio). */
export class MailNotConfiguredError extends Error {
  constructor() {
    super("E-mail transacional não configurado: defina RESEND_API_KEY na API (resend.com → API Keys) e verifique MAIL_FROM.");
    this.name = "MailNotConfiguredError";
  }
}

export class MailSendError extends Error {
  constructor(reason: string) {
    super(`Falha ao enviar e-mail de redefinição: ${reason}`);
    this.name = "MailSendError";
  }
}

/** Chave presente? Pré-condição da rota — sem ela nada é enviado. */
export function mailConfigured(config: Config): boolean {
  return Boolean(config.RESEND_API_KEY?.trim());
}

/** Cria o token, queima ativos anteriores e devolve o valor cru (só pro e-mail). */
export async function createPasswordReset(
  db: Db,
  input: { customerId: string; ip?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32); // 256 bits de entropia, base64url
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await db.transaction(async (tx) => {
    // um ativo por cliente: pedir de novo invalida o link anterior
    await tx
      .update(schema.passwordResets)
      .set({ usedAt: new Date() })
      .where(and(
        eq(schema.passwordResets.customerId, input.customerId),
        isNull(schema.passwordResets.usedAt),
      ));
    await tx.insert(schema.passwordResets).values({
      customerId: input.customerId,
      tokenHash: sha256(token),
      expiresAt,
      requestedIp: input.ip ?? null,
    });
    // higiene: remove consumidos/expirados com mais de 7 dias (auditoria recente fica)
    await tx
      .delete(schema.passwordResets)
      .where(lt(schema.passwordResets.expiresAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  });

  return { token, expiresAt };
}

/** Link absoluto da tela de redefinição — aponta para a loja, nunca para a API. */
export function resetUrl(config: Config, token: string): string {
  return `${config.STORE_URL.replace(/\/$/, "")}/redefinir-senha?token=${encodeURIComponent(token)}`;
}

/**
 * Envia o e-mail via Resend (API REST). Lança MailSendError em qualquer
 * falha — o chamador nunca fica com "enviado" na mão sem ter enviado.
 */
export async function sendResetEmail(
  config: Config,
  input: { to: string; name: string; url: string },
): Promise<void> {
  const key = config.RESEND_API_KEY?.trim();
  if (!key) throw new MailNotConfiguredError();

  const minutes = Math.round(RESET_TTL_MS / 60_000);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.MAIL_FROM,
      to: [input.to],
      subject: "Redefinição de senha — Airsoft Americana",
      text: [
        `Olá, ${input.name}.`,
        "",
        "Recebemos um pedido para redefinir a senha da sua conta na Airsoft Americana.",
        `Abra o link abaixo em até ${minutes} minutos:`,
        input.url,
        "",
        "Se não foi você, ignore este e-mail — sua senha continua a mesma.",
      ].join("\n"),
      html: [
        `<p>Olá, ${input.name}.</p>`,
        `<p>Recebemos um pedido para redefinir a senha da sua conta na Airsoft Americana.</p>`,
        `<p><a href="${input.url}">Clique aqui para criar uma nova senha</a> (válido por ${minutes} minutos).</p>`,
        `<p>Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>`,
      ].join(""),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MailSendError(`${res.status} ${body.slice(0, 200)}`);
  }
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Consome o token e grava a senha nova em uma transação.
 * O consumo é atômico (used_at is null no WHERE): o segundo request com o
 * mesmo token devolve invalid, sem tocar na senha.
 */
export async function consumePasswordReset(
  db: Db,
  input: { token: string; newPassword: string },
): Promise<ConsumeResult> {
  const tokenHash = sha256(input.token);

  // Checagem barata antes do argon2: token desconhecido/expirado não paga
  // custo de hashing. Autoridade continua sendo o UPDATE atômico abaixo.
  const peek = await db
    .select({ expiresAt: schema.passwordResets.expiresAt, usedAt: schema.passwordResets.usedAt })
    .from(schema.passwordResets)
    .where(eq(schema.passwordResets.tokenHash, tokenHash))
    .limit(1);
  const seen = peek[0];
  if (!seen) return { ok: false, reason: "invalid" };
  if (seen.usedAt) return { ok: false, reason: "invalid" };
  if (seen.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const passwordHash = await hashPassword(input.newPassword); // argon2id

  const consumed = await db.transaction(async (tx) => {
    const found = await tx
      .select({ id: schema.passwordResets.id, customerId: schema.passwordResets.customerId, expiresAt: schema.passwordResets.expiresAt, usedAt: schema.passwordResets.usedAt })
      .from(schema.passwordResets)
      .where(eq(schema.passwordResets.tokenHash, tokenHash))
      .limit(1);
    const row = found[0];
    if (!row) return { outcome: "invalid" as const };
    if (row.usedAt) return { outcome: "invalid" as const };
    if (row.expiresAt.getTime() < Date.now()) return { outcome: "expired" as const };

    const burned = await tx
      .update(schema.passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.passwordResets.id, row.id), isNull(schema.passwordResets.usedAt)))
      .returning();
    if (burned.length === 0) return { outcome: "invalid" as const }; // outra requisição chegou antes

    await tx
      .update(schema.customers)
      .set({ passwordHash })
      .where(eq(schema.customers.id, row.customerId));

    // guarda recente para auditoria (sem dado sensível)
    await tx.insert(schema.auditLogs).values({
      action: "customer.password.reset",
      entity: "customer",
      entityId: row.customerId,
      actorLabel: null,
      ip: null,
      correlationId: randomUUID(),
    });

    return { outcome: "ok" as const, customerId: row.customerId };
  });

  if (consumed.outcome === "ok") return { ok: true };
  return { ok: false, reason: consumed.outcome === "expired" ? "expired" : "invalid" };
}

/**
 * Falha de envio não pode vazar se o e-mail existe (enumeração), mas também
 * não pode sumir: registra na outbox para o painel mostrar ao lojista.
 */
export async function reportMailFailure(db: Db, reason: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await outboxNotify(tx, {
        kind: "mail.password_reset_failed",
        title: "Falha ao enviar redefinição de senha",
        body: reason.slice(0, 300),
        severity: "warning",
      });
    });
  } catch {
    // outbox fora do ar não derruba a rota — o log do servidor cobre
  }
}
