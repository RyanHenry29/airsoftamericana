// @ts-ignore - drizzle type compatibility
import { eq, sql } from "drizzle-orm";
import type { RiskLevel } from "@airsoft/shared";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export interface FraudInput {
  orderId: string;
  customerId: string;
  customerEmail: string;
  customerCpf?: string | null;
  totalCents: number;
  ip?: string | null;
  deviceFingerprint?: string | null;
  priorOrdersLast24h: number;
  failedAttemptsLast24h: number;
  addressDivergent: boolean;
}

export interface FraudResult {
  score: number;
  level: RiskLevel;
  action: "liberar" | "revisar" | "bloquear";
  reasons: { key: string; name: string; weight: number }[];
}

const DEFAULT_RULES: { key: string; name: string; weight: number; threshold: number }[] = [
  { key: "failed_attempts", name: "Múltiplas tentativas de pagamento recusadas", weight: 25, threshold: 3 },
  { key: "velocity_customer", name: "Vários pedidos do mesmo cliente em 24h", weight: 20, threshold: 3 },
  { key: "high_value", name: "Valor do pedido acima de R$ 2.000", weight: 15, threshold: 200000 },
  { key: "address_divergent", name: "Endereço de entrega divergente do histórico", weight: 15, threshold: 0 },
  { key: "watchlist_hit", name: "Cliente/e-mail na lista de monitoramento", weight: 40, threshold: 0 },
  { key: "no_cpf", name: "Compra sem CPF informado", weight: 10, threshold: 0 },
  { key: "new_customer_high_value", name: "Cliente novo com pedido de alto valor", weight: 20, threshold: 150000 },
];

export async function assessRisk(db: Db, input: FraudInput): Promise<FraudResult> {
  // @ts-ignore - drizzle type compatibility
  const ruleRows = await db.select().from(schema.fraudRules);
  const rules = ruleRows.length > 0 ? ruleRows : DEFAULT_RULES.map((r) => ({ ...r, enabled: true }));

  const reasons: FraudResult["reasons"] = [];
  let score = 0;

  const active = rules.filter((r) => r.enabled !== false);

  const failedRule = active.find((r) => r.key === "failed_attempts");
  if (failedRule && input.failedAttemptsLast24h >= (failedRule.threshold ?? 3)) {
    score += failedRule.weight;
    reasons.push({ key: failedRule.key, name: failedRule.name, weight: failedRule.weight });
  }

  const velocityRule = active.find((r) => r.key === "velocity_customer");
  if (velocityRule && input.priorOrdersLast24h >= (velocityRule.threshold ?? 3)) {
    score += velocityRule.weight;
    reasons.push({ key: velocityRule.key, name: velocityRule.name, weight: velocityRule.weight });
  }

  const highValueRule = active.find((r) => r.key === "high_value");
  if (highValueRule && input.totalCents >= (highValueRule.threshold ?? 200000)) {
    score += highValueRule.weight;
    reasons.push({ key: highValueRule.key, name: highValueRule.name, weight: highValueRule.weight });
  }

  const addrRule = active.find((r) => r.key === "address_divergent");
  if (addrRule && input.addressDivergent) {
    score += addrRule.weight;
    reasons.push({ key: addrRule.key, name: addrRule.name, weight: addrRule.weight });
  }

  // Simplified watchlist check
  let hitReason: string | null = null;
  if (active.some((r) => r.key === "watchlist_hit")) {
    const values = [input.customerEmail, input.customerCpf ?? "", input.ip ?? "", input.deviceFingerprint ?? "", input.customerId].filter(Boolean);
    if (values.length > 0) {
      const rows: any[] = await db.select({ value: schema.watchlist.value, reason: schema.watchlist.reason }).from(schema.watchlist);
      for (const row of rows) {
        if (values.includes(row.value)) {
          hitReason = row.reason;
          break;
        }
      }
    }
  }

  if (hitReason) {
    const watchRule = DEFAULT_RULES.find((r) => r.key === "watchlist_hit");
    if (watchRule) {
      score += watchRule.weight;
      reasons.push({ key: watchRule.key, name: `${watchRule.name}: ${hitReason}`, weight: watchRule.weight });
    }
  }

  const noCpfRule = active.find((r) => r.key === "no_cpf");
  if (noCpfRule && !input.customerCpf) {
    score += noCpfRule.weight;
    reasons.push({ key: noCpfRule.key, name: noCpfRule.name, weight: noCpfRule.weight });
  }

  const newHighRule = active.find((r) => r.key === "new_customer_high_value");
  if (newHighRule && input.priorOrdersLast24h === 0 && input.totalCents >= (newHighRule.threshold ?? 150000)) {
    score += newHighRule.weight;
    reasons.push({ key: newHighRule.key, name: newHighRule.name, weight: newHighRule.weight });
  }

  score = Math.min(100, score);
  const level: RiskLevel = score >= 70 ? "alto" : score >= 30 ? "medio" : "baixo";
  const action = level === "alto" ? "bloquear" : level === "medio" ? "revisar" : "liberar";

  return { score, level, action, reasons };
}

export async function saveAssessment(
  db: Db,
  input: FraudInput & FraudResult & { deviceFingerprint?: string | null },
): Promise<void> {
  // @ts-ignore - drizzle type compatibility
  await db.insert(schema.fraudAssessments).values({
    id: crypto.randomUUID(),
    orderId: input.orderId,
    score: input.score,
    level: input.level,
    action: input.action,
    reasons: input.reasons as never,
    ip: input.ip ?? null,
    deviceFingerprint: input.deviceFingerprint ?? null,
    autoDecision: true,
    createdAt: new Date(),
  });
  // @ts-ignore - drizzle type compatibility
  await db
    .update(schema.orders)
    .set({ riskLevel: input.level, riskScore: input.score, riskReasons: input.reasons as never })
    .where(eq(schema.orders.id, input.orderId));
}