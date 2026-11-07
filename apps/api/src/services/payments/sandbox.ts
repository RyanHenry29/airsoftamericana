import crypto from "node:crypto";
import type {
  CaptureResult,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedWebhookEvent,
  PaymentAdapter,
  RefundResult,
} from "./types.js";

const SIGNATURE_HEADER_PREFIX = "sha256=";

export class SandboxAdapter implements PaymentAdapter {
  readonly provider = "sandbox";
  private secret: string;

  constructor(secret = "sandbox-secret") {
    this.secret = secret;
  }

  isConfigured(): boolean {
    return true;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerTransactionId = `sbx_${crypto.randomUUID()}`;

    if (input.method === "pix") {
      return {
        providerTransactionId,
        status: "pendente",
        payload: `00020126SANDBOX-${providerTransactionId}-${input.amountCents}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };
    }
    if (input.method === "boleto") {
      return {
        providerTransactionId,
        status: "pendente",
        payload: `34191.79001 01043.510047 91020.150008 8 ${providerTransactionId}`,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      };
    }
    if (input.cardToken === "sandbox-decline") {
      return { providerTransactionId, status: "recusado" };
    }
    return { providerTransactionId, status: "autorizado" };
  }

  async capture(_tx: string, amountCents: number): Promise<CaptureResult> {
    return { status: "aprovado", amountCents };
  }

  async refund(_tx: string, amountCents: number): Promise<RefundResult> {
    return { providerRefundId: `sbx_rf_${crypto.randomUUID()}`, status: "estornado" };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected =
      SIGNATURE_HEADER_PREFIX +
      crypto.createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    const body = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data?: {
        transactionId?: string;
        amountCents?: number;
        disputeId?: string;
        reason?: string;
        respondBy?: string;
      };
    };
    const map: Record<string, NormalizedWebhookEvent["type"]> = {
      "payment.approved": "payment.approved",
      "payment.recused": "payment.recused",
      "payment.expired": "payment.expired",
      "payment.refunded": "payment.refunded",
      "chargeback.received": "chargeback.received",
      "chargeback.resolved": "chargeback.resolved",
    };
    const type = map[body.type];
    if (!type) throw new Error(`Evento sandbox desconhecido: ${body.type}`);
    return {
      eventId: `sandbox:${body.id}`,
      type,
      providerTransactionId: body.data?.transactionId,
      amountCents: body.data?.amountCents,
      disputeId: body.data?.disputeId,
      disputeReason: body.data?.reason,
      respondBy: body.data?.respondBy ? new Date(body.data.respondBy) : undefined,
      raw: body,
    };
  }

  sign(rawBody: string): string {
    return (
      SIGNATURE_HEADER_PREFIX +
      crypto.createHmac("sha256", this.secret).update(rawBody).digest("hex")
    );
  }
}