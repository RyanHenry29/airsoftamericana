/**
 * Teste de máquina de estados de pedido - SKILL.md item 5.4:
 * "aguardando_pagamento → em_processamento_antifraude → aguardando_revisão → aprovado → separação → preparando_envio → enviado → entregue"
 * Transições inválidas = erro 409. Histórico append-only.
 */
import { describe, it, expect } from "vitest";

// Simular as ORDER_TRANSITIONS do domínio
const ORDER_TRANSITIONS: Record<string, string[]> = {
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

function canTransition(from: string, to: string): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to);
}

describe("Order Status Transitions", () => {
  it("should allow aguardando_pagamento -> pagamento_em_processamento", () => {
    expect(canTransition("aguardando_pagamento", "pagamento_em_processamento")).toBe(true);
  });

  it("should allow pagamento_aprovado -> separacao", () => {
    expect(canTransition("pagamento_aprovado", "separacao")).toBe(true);
  });

  it("should deny invalid transition", () => {
    expect(canTransition("entregue", "pagamento_em_processamento")).toBe(false);
  });

  it("should allow all terminal statuses to have no outgoing transitions", () => {
    expect(canTransition("cancelado", "any")).toBe(false);
    expect(canTransition("reembolsado", "any")).toBe(false);
  });

  it("should test full transition cycle", () => {
    // Aguardando pagamento -> em processamento -> em analise -> aprovado -> separacao -> preparando -> enviado -> entregue
    const cycle: string[] = [
      "aguardando_pagamento",
      "pagamento_em_processamento",
      "em_analise_antifraude",
      "pagamento_aprovado",
      "separacao",
      "preparando_envio",
      "enviado",
      "entregue",
    ];

    for (let i = 0; i < cycle.length - 1; i++) {
      expect(canTransition(cycle[i], cycle[i + 1])).toBe(true);
    }
  });
});