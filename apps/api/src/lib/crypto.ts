import argon2 from "argon2";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Falha ao decifrar um segredo guardado (credencial de gateway, segredo TOTP).
 *
 * Erro TIPADO e não engolido: chave divergente ou dado corrompido é
 * "gateway indisponível" — nunca "não configurado". A diferença importa:
 * "não configurado" manda o lojista preencher o formulário; "indisponível"
 * manda ele chamar o suporte.
 */
export class CredentialDecryptionError extends Error {
  readonly code = "gateway_unavailable";
  readonly status = 503;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "CredentialDecryptionError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Hashes legados (bcrypt) ainda aceitos na verificação — rehash no login. */
function isBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

/** Senha nova: argon2id (OWASP). */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export interface PasswordVerifyResult {
  ok: boolean;
  /** Hash argon2id novo quando o original era bcrypt válido — gravar no banco. */
  rehash?: string;
}

/**
 * Verifica senha aceitando bcrypt legado (rehash transparente) e argon2id.
 */
export async function verifyPasswordDetailed(plain: string, hash: string): Promise<PasswordVerifyResult> {
  if (!hash) return { ok: false };
  if (isBcryptHash(hash)) {
    const ok = await bcrypt.compare(plain, hash);
    if (!ok) return { ok: false };
    return { ok: true, rehash: await hashPassword(plain) };
  }
  try {
    const ok = await argon2.verify(hash, plain);
    return ok ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Compat: boolean simples (sem rehash). Preferir verifyPasswordDetailed no login. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return (await verifyPasswordDetailed(plain, hash)).ok;
}

function gatewayKey(): Buffer {
  if (!config.GATEWAY_SECRETS_KEY) {
    // Em dev, chave derivada do JWT_SECRET (nunca use assim em produção).
    return crypto.createHash("sha256").update(config.JWT_SECRET).digest();
  }
  return Buffer.from(config.GATEWAY_SECRETS_KEY, "base64");
}

/** AES-256-GCM — credenciais de gateway nunca em texto perto do banco. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", gatewayKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), enc.toString("base64"), cipher.getAuthTag().toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, dataB64, tagB64] = payload.split(".");
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new CredentialDecryptionError(
      "Segredo cifrado inválido — o conteúdo guardado não tem o formato iv.dados.tag.",
    );
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", gatewayKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new CredentialDecryptionError(
      "Falha ao decifrar segredo protegido — chave de criptografia divergente ou dado corrompido.",
      error,
    );
  }
}

export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}