import crypto from "node:crypto";
import type {
  CaptureResult,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedWebhookEvent,
  PaymentAdapter,
  RefundResult,
} from "./types.js";

const API = "https://api.mercadopago.com";

export class MercadoPagoAdapter implements PaymentAdapter {
  readonly provider = "mercadopago";
  readonly signatureHeader = "x-signature";
  constructor(private readonly accessToken: string) {}

  isConfigured(): boolean {
    return Boolean(this.accessToken);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) {
      throw new Error(`Mercado Pago ${res.status}: ${JSON.stringify(json)}`);
    }
    return json;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (input.method === "pix") {
      const data = await this.request<{
        id: string;
        point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
        date_of_expiration?: string;
      }>("POST", "/v1/payments", {
        transaction_amount: input.amountCents / 100,
        payment_method_id: "pix",
        payer: { email: input.customer.email, identification: input.customer.cpf ? { type: "CPF", number: input.customer.cpf } : undefined },
        external_reference: input.orderId,
      });
      return {
        providerTransactionId: String(data.id),
        status: "pendente",
        payload: data.point_of_interaction?.transaction_data?.qr_code_base64 ?? data.point_of_interaction?.transaction_data?.qr_code,
        expiresAt: data.date_of_expiration ? new Date(data.date_of_expiration) : new Date(Date.now() + 30 * 60 * 1000),
      };
    }
    if (input.method === "boleto") {
      const data = await this.request<{ id: string; transaction_details?: { external_resource_url?: string }; date_of_expiration?: string }>(
        "POST",
        "/v1/payments",
        {
          transaction_amount: input.amountCents / 100,
          payment_method_id: "bolbradesco",
          payer: { email: input.customer.email },
          external_reference: input.orderId,
        },
      );
      return {
        providerTransactionId: String(data.id),
        status: "pendente",
        payload: data.transaction_details?.external_resource_url,
        expiresAt: data.date_of_expiration ? new Date(data.date_of_expiration) : undefined,
      };
    }
    const data = await this.request<{ id: string; status: string }>("POST", "/v1/payments", {
      transaction_amount: input.amountCents / 100,
      token: input.cardToken,
      installments: input.installments ?? 1,
      payment_method_id: "visa",
      payer: {
        email: input.customer.email,
        identification: input.customer.cpf ? { type: "CPF", number: input.customer.cpf } : undefined,
      },
      external_reference: input.orderId,
    });
    const status = data.status === "approved" ? "aprovado" : data.status === "rejected" ? "recusado" : "autorizado";
    return { providerTransactionId: String(data.id), status };
  }

  async capture(tx: string, amountCents: number): Promise<CaptureResult> {
    const data = await this.request<{ status: string }>("PUT", `/v1/payments/${tx}/capture`, {
      amount: amountCents / 100,
    });
    return { status: data.status === "approved" ? "aprovado" : "recusado", amountCents };
  }

  async refund(tx: string, amountCents: number): Promise<RefundResult> {
    const data = await this.request<{ id: string }>("POST", `/v1/payments/${tx}/refunds`, {
      amount: amountCents / 100,
    });
    return { providerRefundId: String(data.id), status: "estornado" };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    // MP uses x-signature header (ts + v1); simplified check via body HMAC with token as secret
    if (!signature) return false;
    const expected = crypto.createHmac("sha256", this.accessToken).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    const body = JSON.parse(rawBody) as { type: string; data?: { id?: string } };
    const id = body.data?.id ?? crypto.randomUUID();
    if (body.type === "payment") {
      return { eventId: `mp:payment:${id}`, type: "payment.approved", providerTransactionId: id, raw: body };
    }
    if (body.type === "chargeback") {
      return { eventId: `mp:cb:${id}`, type: "chargeback.received", disputeId: id, raw: body };
    }
    return { eventId: `mp:${body.type}:${id}`, type: "payment.approved", raw: body };
  }
}