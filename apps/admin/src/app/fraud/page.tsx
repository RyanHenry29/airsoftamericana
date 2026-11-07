export default function FraudPage() {
  return (
    <main className="px-6 py-24">
      <header className="mb-12 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Central de Antifraude
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Score de risco, 3DS, chargebacks e evidências
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
        <div className="border border-[#111] bg-[#0a0a0a] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">Score de risco</span>
          <p className="text-[#666] font-mono text-xs">
            Calculado automaticamente em cada checkout (motor de regras, 7 regras default).
          </p>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">3 faixas</span>
          <p className="text-[#666] font-mono text-xs">
            Baixo → fluxo normal · Médio → revisão manual · Alto → bloqueio preventivo.
          </p>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">Chargebacks</span>
          <p className="text-[#666] font-mono text-xs">
            Central de disputas com exportação de evidências em PDF para envio ao banco.
          </p>
        </div>
      </div>

      <div className="border border-[#111] bg-[#0a0a0a] p-12">
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">Regras default</span>
        <ul className="space-y-3 text-[#666] font-mono text-xs">
          <li>Múltiplas tentativas de pagamento recusadas (peso 25)</li>
          <li>Vários pedidos do mesmo cliente em 24h (peso 20)</li>
          <li>Valor do pedido acima de R$ 2.000 (peso 15)</li>
          <li>Endereço de entrega divergente do histórico (peso 15)</li>
          <li>Cliente/e-mail na lista de monitoramento (peso 40)</li>
          <li>Compra sem CPF informado (peso 10)</li>
          <li>Cliente novo com pedido de alto valor (peso 20)</li>
        </ul>
        <p className="mt-8 text-[#333] font-mono text-[0.6rem] uppercase tracking-widest">
          Edição das regras via banco (tabela fraud_rules). Sem endpoint de admin dedicado no backend.
        </p>
      </div>
    </main>
  );
}
