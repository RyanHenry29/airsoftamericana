import crypto from "node:crypto";
import type {
  CaptureResult,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedWebhookEvent,
  PaymentAdapter,
  QueryPaymentResult,
  RefundResult,
} from "./types.js";

const SIGNATURE_HEADER_PREFIX = "sha256=";

interface SandboxCharge {
  providerTransactionId: string;
  orderId: string;
  amountCents: number;
  status: "pendente" | "autorizado" | "aprovado" | "recusado" | "expirado" | "estornado";
}

/** Registro em memória — dá a queryPayment/queryPaymentByOrder para testes. */
const charges = new Map<string, SandboxCharge>();

export function resetSandboxCharges(): void {
  charges.clear();
}

export class SandboxAdapter implements PaymentAdapter {
  readonly provider = "sandbox";
  readonly signatureHeader = "x-signature";
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
      charges.set(input.orderId, {
        providerTransactionId,
        orderId: input.orderId,
        amountCents: input.amountCents,
        status: "pendente",
      });
      return {
        providerTransactionId,
        status: "pendente",
        payload: `00020126SANDBOX-${providerTransactionId}-${input.amountCents}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };
    }
    if (input.method === "boleto") {
      charges.set(input.orderId, {
        providerTransactionId,
        orderId: input.orderId,
        amountCents: input.amountCents,
        status: "pendente",
      });
      return {
        providerTransactionId,
        status: "pendente",
        payload: `34191.79001 01043.510047 91020.150008 8 ${providerTransactionId}`,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      };
    }
    if (input.cardToken === "sandbox-decline") {
      charges.set(input.orderId, {
        providerTransactionId,
        orderId: input.orderId,
        amountCents: input.amountCents,
        status: "recusado",
      });
      return { providerTransactionId, status: "recusado" };
    }
    charges.set(input.orderId, {
      providerTransactionId,
      orderId: input.orderId,
      amountCents: input.amountCents,
      status: "autorizado",
    });
    return { providerTransactionId, status: "autorizado" };
  }

  async capture(_tx: string, amountCents: number): Promise<CaptureResult> {
    return { status: "aprovado", amountCents };
  }

  async refund(_tx: string, amountCents: number): Promise<RefundResult> {
    return { providerRefundId: `sbx_rf_${crypto.randomUUID()}`, status: "estornado" };
  }

  async queryPayment(providerTransactionId: string): Promise<QueryPaymentResult> {
    const charge = [...charges.values()].find((c) => c.providerTransactionId === providerTransactionId);
    if (!charge) throw new Error(`Sandbox: cobrança ${providerTransactionId} não encontrada`);
    return { status: charge.status, amountCents: charge.amountCents, currency: "BRL" };
  }

  async queryPaymentByOrder(orderId: string): Promise<QueryPaymentResult | null> {
    const charge = charges.get(orderId);
    if (!charge) return null;
    return { status: charge.status, amountCents: charge.amountCents, currency: "BRL" };
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
        currency?: string;
        externalReference?: string;
        accountId?: string;
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
      currency: body.data?.currency,
      externalReference: body.data?.externalReference,
      accountId: body.data?.accountId,
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