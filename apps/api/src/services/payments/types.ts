import { CredentialDecryptionError, decryptSecret, encryptSecret } from "../../lib/crypto.js";
import type { PaymentMethod } from "@airsoft/shared";
import type { Db } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

export interface CreatePaymentInput {
  orderId: string;
  amountCents: number;
  method: PaymentMethod;
  customer: { name: string; email: string; cpf?: string | null; phone?: string | null };
  cardToken?: string;
  installments?: number;
}

export interface CreatePaymentResult {
  providerTransactionId: string;
  status: "pendente" | "autorizado" | "aprovado" | "recusado";
  payload?: string;
  expiresAt?: Date;
}

export interface CaptureResult {
  status: "aprovado" | "recusado";
  amountCents: number;
}

export interface RefundResult {
  providerRefundId: string;
  status: "estornado" | "recusado";
}

export interface NormalizedWebhookEvent {
  eventId: string;
  type: "payment.approved" | "payment.recused" | "payment.expired" | "payment.refunded" | "chargeback.received" | "chargeback.resolved";
  providerTransactionId?: string;
  amountCents?: number;
  disputeId?: string;
  disputeReason?: string;
  respondBy?: Date;
  raw: unknown;
}

/** Estado real do pagamento no provedor (consulta de reconciliação). */
export interface QueryPaymentResult {
  status: "pendente" | "autorizado" | "aprovado" | "recusado" | "expirado" | "estornado";
  amountCents?: number;
  raw?: unknown;
}

export interface PaymentAdapter {
  readonly provider: string;
  /** Cabeçalho HTTP que carrega a assinatura do webhook deste provedor. */
  readonly signatureHeader: string;
  isConfigured(): boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  capture(providerTransactionId: string, amountCents: number): Promise<CaptureResult>;
  refund(providerTransactionId: string, amountCents: number): Promise<RefundResult>;
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean;
  parseWebhook(rawBody: string): NormalizedWebhookEvent;
  /** Consulta o estado no provedor — base da reconciliação de pagamentos. */
  queryPayment?(providerTransactionId: string): Promise<QueryPaymentResult>;
}

const registry = new Map<string, PaymentAdapter>();

export function registerAdapter(adapter: PaymentAdapter): void {
  registry.set(adapter.provider, adapter);
}

export function getAdapter(provider: string): PaymentAdapter | undefined {
  return registry.get(provider);
}

export function listAdapters(): PaymentAdapter[] {
  return [...registry.values()];
}

interface GatewayRow {
  provider: string;
  credentialsEncrypted: string | null;
  enabled: boolean;
  isDefault: boolean;
  methods: unknown;
  captureAfterReview: boolean;
  require3ds: boolean;
  pixDiscountPercent: number;
}

export async function loadGatewayConfig(
  db: Db,
  provider: string,
): Promise<GatewayRow | undefined> {
  const rows = await db
    .select()
    .from(schema.gatewayConfigs)
    .where(eq(schema.gatewayConfigs.provider, provider));
  const row = rows[0];
  if (!row) return undefined;
  return row as unknown as GatewayRow;
}

/**
 * Credenciais cifradas que não puderam ser lidas.
 *
 * Provider → motivo. O registro sobrevive à reinicialização do processo
 * porque a falha é detected de novo no boot (initAdapters), mas entre uma
 * leitura e outra o mapa evita reprocessar o mesmo erro.
 */
const credentialFailures = new Map<string, string>();

export function markCredentialFailure(provider: string, reason: string): void {
  credentialFailures.set(provider, reason);
}

export function clearCredentialFailure(provider: string): void {
  credentialFailures.delete(provider);
}

export function getCredentialFailure(provider: string): string | undefined {
  return credentialFailures.get(provider);
}

/**
 * Decifra as credenciais do gateway.
 *
 * NÃO engole erro: credencial ilegível é "gateway indisponível" (503) e
 * precisa aparecer na auditoria — devolveu {} em silêncio, o lojista via
 * "gateway não configurado" e nenhuma pista do que aconteceu.
 */
export function decryptCredentials(row: GatewayRow): Record<string, string> {
  if (!row.credentialsEncrypted) return {};
  const parsed = JSON.parse(decryptSecret(row.credentialsEncrypted)) as Record<string, string>;
  if (!parsed || typeof parsed !== "object") {
    throw new CredentialDecryptionError(
      `Credenciais do gateway ${row.provider} não são um objeto de chave/valor.`,
    );
  }
  return parsed;
}

export function encryptCredentials(creds: Record<string, string>): string {
  return encryptSecret(JSON.stringify(creds));
}

export async function resolveActiveAdapter(db: Db): Promise<PaymentAdapter | undefined> {
  const rows = await db.select().from(schema.gatewayConfigs);
  const def =
    rows.find((r) => r.isDefault && r.enabled) ??
    rows.find((r) => r.enabled && r.provider === process.env.GATEWAY_ACTIVE) ??
    rows.find((r) => r.enabled);
  if (!def) return registry.get("sandbox");

  // Credencial ilegível no provedor escolhido = gateway indisponível.
  // "Não configurado" (sem credencial nenhuma) é outro caso: o adapter
  // simplesmente não existe e o checkout diz que falta configuração.
  const failure = credentialFailures.get(def.provider);
  if (failure) {
    throw new CredentialDecryptionError(
      `Gateway indisponível: as credenciais de ${def.provider} não puderam ser lidas (${failure}).`,
    );
  }

  return registry.get(def.provider);
}