import crypto from "node:crypto";
import type {
  CaptureResult,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedWebhookEvent,
  PaymentAdapter,
  RefundResult,
} from "./types.js";

const API = "https://api.pagseguro.com";

export class PagBankAdapter implements PaymentAdapter {
  readonly provider = "pagbank";
  readonly signatureHeader = "x-authenticity-token";
  constructor(private readonly apiKey: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new Error(`PagBank ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (input.method === "pix") {
      const data = await this.request<{ id: string; qr_codes?: { id: string; content?: string }[] }>(
        "POST",
        `/orders/`,
        {
          customer: { email: input.customer.email, name: input.customer.name },
          items: [{ name: `Order ${input.orderId}`, amount: input.amountCents, quantity: 1 }],
          reference_id: input.orderId,
          charges: [{ amount: { value: input.amountCents, currency: "BRL" }, payment_method: { type: "PIX" } }],
        },
      );
      return {
        providerTransactionId: data.id,
        status: "pendente",
        payload: data.qr_codes?.[0]?.content,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };
    }
    if (input.method === "boleto") {
      const data = await this.request<{ id: string }>("POST", `/orders/`, {
        customer: { email: input.customer.email, name: input.customer.name },
        items: [{ name: `Order ${input.orderId}`, amount: input.amountCents, quantity: 1 }],
        reference_id: input.orderId,
        charges: [{ amount: { value: input.amountCents, currency: "BRL" }, payment_method: { type: "BOLETO" } }],
      });
      return { providerTransactionId: data.id, status: "pendente" };
    }
    const data = await this.request<{ id: string }>("POST", `/orders/`, {
      customer: { email: input.customer.email, name: input.customer.name },
      items: [{ name: `Order ${input.orderId}`, amount: input.amountCents, quantity: 1 }],
      reference_id: input.orderId,
      charges: [
        {
          amount: { value: input.amountCents, currency: "BRL" },
          payment_method: { type: "CREDIT_CARD", installments: input.installments ?? 1 },
        },
      ],
    });
    return { providerTransactionId: data.id, status: "autorizado" };
  }

  async capture(tx: string, amountCents: number): Promise<CaptureResult> {
    await this.request("POST", `/orders/${tx}/capture`, { amount: { value: amountCents, currency: "BRL" } });
    return { status: "aprovado", amountCents };
  }

  async refund(tx: string, amountCents: number): Promise<RefundResult> {
    const data = await this.request<{ id: string }>("POST", `/orders/${tx}/refunds`, {
      amount: { value: amountCents, currency: "BRL" },
    });
    return { providerRefundId: data.id, status: "estornado" };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const hex = Buffer.from(signature, "utf8").toString("hex");
    const expected = crypto.createHmac("sha256", this.apiKey).update(rawBody).digest("hex");
    const a = Buffer.from(hex);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    const body = JSON.parse(rawBody) as { id: string; type: string; data?: { id?: string } };
    return {
      eventId: `pg:${body.id}`,
      type: body.type === "chargeback" ? "chargeback.received" : "payment.approved",
      providerTransactionId: body.data?.id,
      raw: body,
    };
  }
}