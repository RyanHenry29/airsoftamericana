import crypto from "node:crypto";
import type {
  CaptureResult,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedWebhookEvent,
  PaymentAdapter,
  RefundResult,
} from "./types.js";

const API = "https://apisandbox.cieloecommerce.cielo.com.br";

export class CieloAdapter implements PaymentAdapter {
  readonly provider = "cielo";
  constructor(private readonly merchantId: string, private readonly merchantKey: string) {}

  isConfigured(): boolean {
    return Boolean(this.merchantId && this.merchantKey);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        MerchantId: this.merchantId,
        MerchantKey: this.merchantKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new Error(`Cielo ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const isPix = input.method === "pix";
    const data = await this.request<{ PaymentId: string; Status: number; ReturnCode: string; ReturnMessage: string }>(
      "POST",
      "/3.0/sales",
      {
        MerchantOrderId: input.orderId,
        Customer: { Name: input.customer.name, Identity: input.customer.cpf ?? "", Email: input.customer.email },
        Payment: {
          Type: isPix ? "Pix" : "CreditCard",
          Amount: input.amountCents,
          Provider: isPix ? "PagBank" : "Simulate",
          Installments: input.installments ?? 1,
          Capture: false,
        },
      },
    );
    return {
      providerTransactionId: data.PaymentId,
      status: data.ReturnCode === "4" ? "aprovado" : "autorizado",
    };
  }

  async capture(tx: string, amountCents: number): Promise<CaptureResult> {
    await this.request("PUT", `/3.0/sales/${tx}/capture`, { Amount: amountCents });
    return { status: "aprovado", amountCents };
  }

  async refund(tx: string, amountCents: number): Promise<RefundResult> {
    const data = await this.request<{ PaymentId: string }>("PUT", `/3.0/sales/${tx}/void`, { Amount: amountCents });
    return { providerRefundId: data.PaymentId, status: "estornado" };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = crypto.createHmac("sha256", this.merchantKey).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    const body = JSON.parse(rawBody) as { id?: string; type?: string; data?: { id?: string } };
    return {
      eventId: `cl:${body.id ?? crypto.randomUUID()}`,
      type: body.type === "chargeback" ? "chargeback.received" : "payment.approved",
      providerTransactionId: body.data?.id,
      raw: body,
    };
  }
}