/**
 * Domínio central — status machines e regras compartilhadas entre API, loja e admin.
 * Nenhum status é transitório por acidente: toda transição passa por aqui.
 */

// ---------------------------------------------------------------- Pedidos
export const ORDER_STATUSES = [
  "aguardando_pagamento",
  "pagamento_em_processamento",
  "em_analise_antifraude",
  "aguardando_revisao_manual",
  "pagamento_aprovado",
  "separacao",
  "preparando_envio",
  "enviado",
  "entregue",
  "cancelado",
  "reembolsado",
  "em_disputa",
  "chargeback_recebido",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Transições válidas — qualquer outra combinação é 409. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  aguardando_pagamento: ["pagamento_em_processamento", "cancelado"],
  pagamento_em_processamento: [
    "em_analise_antifraude",
    "aguardando_revisao_manual",
    "pagamento_aprovado",
    "cancelado",
  ],
  em_analise_antifraude: ["aguardando_revisao_manual", "pagamento_aprovado", "cancelado"],
  aguardando_revisao_manual: ["pagamento_aprovado", "cancelado"],
  pagamento_aprovado: ["separacao", "cancelado", "reembolsado"],
  separacao: ["preparando_envio", "cancelado", "reembolsado"],
  preparando_envio: ["enviado", "cancelado", "reembolsado"],
  enviado: ["entregue", "em_disputa", "chargeback_recebido"],
  entregue: ["em_disputa", "chargeback_recebido", "reembolsado"],
  cancelado: [],
  reembolsado: [],
  em_disputa: ["chargeback_recebido", "reembolsado", "entregue"],
  chargeback_recebido: ["reembolsado"],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Status que ainda ocupam estoque reservado. */
export const RESERVED_STATUSES: readonly OrderStatus[] = [
  "aguardando_pagamento",
  "pagamento_em_processamento",
  "em_analise_antifraude",
  "aguardando_revisao_manual",
  "pagamento_aprovado",
  "separacao",
  "preparando_envio",
];

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

// ---------------------------------------------------------------- Pagamentos
export const PAYMENT_METHODS = ["pix", "cartao", "boleto"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  "pendente",
  "autorizado",
  "aprovado",
  "recusado",
  "expirado",
  "estornado",
  "chargeback",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// ---------------------------------------------------------------- Chargeback
export const CHARGEBACK_STATUSES = [
  "notificado",
  "aguardando_analise",
  "documentacao_pendente",
  "defesa_preparada",
  "defesa_enviada",
  "em_analise",
  "ganho",
  "perdido",
  "encerrado",
] as const;
export type ChargebackStatus = (typeof CHARGEBACK_STATUSES)[number];

// ---------------------------------------------------------------- Antifraude
export const RISK_LEVELS = ["baixo", "medio", "alto"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Faixa operacional → ação padrão (o lojista pode sobrescrever no admin). */
export const RISK_ACTIONS: Record<RiskLevel, "liberar" | "revisar" | "bloquear"> = {
  baixo: "liberar",
  medio: "revisar",
  alto: "bloquear",
};

// ---------------------------------------------------------------- Estoque
export const INVENTORY_MOVEMENT_TYPES = [
  "entrada",
  "saida",
  "ajuste",
  "reserva",
  "liberacao",
  "transferencia",
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

/**
 * disponível = físico - reservado. Nunca pode ficar negativo.
 */
export function availableStock(physical: number, reserved: number): number {
  return physical - reserved;
}
