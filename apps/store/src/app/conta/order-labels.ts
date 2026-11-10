// language: TS, file: apps/store/src/app/conta/order-labels.ts
// Rótulos de pedido compartilhados entre a lista (ContaArea) e o modal.
export const STATUS_LABEL: Record<string, string> = {
  aguardando_pagamento: "Aguardando pagamento",
  pagamento_em_processamento: "Pagamento em processamento",
  em_analise_antifraude: "Em análise antifraude",
  aguardando_revisao_manual: "Aguardando revisão",
  pagamento_aprovado: "Pagamento aprovado",
  separacao: "Em separação",
  preparando_envio: "Preparando envio",
  enviado: "Enviado",
  entregue: "Entregue",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
  em_disputa: "Em disputa",
  chargeback_recebido: "Chargeback recebido",
};

export const PAY_LABEL: Record<string, string> = {
  pix: "PIX",
  cartao: "Cartão",
  boleto: "Boleto",
};

export function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dateBr(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}
