"use client";

import { useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Metrics = {
  ordersTotal: number;
  ordersApproved: number;
  ordersToday: number;
  ordersYesterday: number;
  productsPublished: number;
  lowStock: number;
  chargebacks: number;
  chargebackAmountCents: number;
  revenueCents: number;
  revenueTodayCents: number;
  ticketCents: number;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  useGateRedirect(failure);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const json = await adminJson<Metrics>("/api/admin/metrics");
        setMetrics(json);
        setFailure(null);
        setError("");
      } catch (e) {
        setFailure(e);
        setError(messageOf(e, "Falha ao carregar métricas."));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="skel h-16" />
          <div className="skel h-16" />
          <div className="skel h-16" />
          <div className="skel h-16" />
        </div>
      </main>
    );
  }

  if (error || !metrics) {
    return (
      <main className="px-6 py-24 text-center">
        <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#dc2626] mb-6">
          ERR
        </div>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-6">
          Erro ao carregar
        </h1>
        <p className="text-[#666] font-mono text-xs mb-10 max-w-md mx-auto">{error}</p>
        <a href="/login" className="btn-primary px-8 py-3">
          IR PARA O LOGIN
        </a>
      </main>
    );
  }

  const delta = metrics.ordersToday - metrics.ordersYesterday;

  return (
    <main className="px-6 pb-24">
      <nav className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-[#666] mb-12 flex items-center gap-2">
        <span className="text-white font-bold">Painel</span>
      </nav>

      <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
        Visão geral do sistema
      </span>
      <h1 className="font-display font-black text-[clamp(3rem,8vw,5rem)] uppercase leading-none tracking-tighter text-white mb-16">
        Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
        <div className="border border-[#111] bg-[#0a0a0a] p-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">
            Pedidos hoje
          </span>
          <div className="font-display font-black text-3xl md:text-4xl text-white">
            {metrics.ordersToday}
          </div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">
            {metrics.ordersYesterday} ontem
            {delta !== 0 ? ` · ${delta > 0 ? "+" : ""}${delta}` : ""}
          </span>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">
            Receita de hoje
          </span>
          <div className="font-display font-black text-3xl md:text-4xl text-[#8bcf16]">
            {brl(metrics.revenueTodayCents)}
          </div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">
            {brl(metrics.revenueCents)} acumulados
          </span>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">
            Pedidos no total
          </span>
          <div className="font-display font-black text-3xl md:text-4xl text-white">
            {metrics.ordersTotal}
          </div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">
            {metrics.ordersApproved} com pagamento aprovado
          </span>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">
            Estoque baixo
          </span>
          <div className="font-display font-black text-3xl md:text-4xl text-white">
            {metrics.lowStock}
          </div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">
            itens em alerta
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="border border-[#111] bg-[#0a0a0a] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
            Chargebacks
          </span>
          <div className="flex items-baseline gap-2 mb-2">
            <div className="font-display font-black text-3xl text-white">
              {metrics.chargebacks}
            </div>
            <span className="font-mono text-[0.6rem] uppercase tracking-tighter text-[#333]">
              disputas
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666]">
              Valor contestado
            </span>
            <div className="font-mono text-sm text-white">
              {brl(metrics.chargebackAmountCents)}
            </div>
          </div>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
            Ticket médio
          </span>
          <div className="font-display font-black text-3xl text-white">
            {brl(metrics.ticketCents)}
          </div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">
            por pedido aprovado
          </span>
        </div>
      </div>
    </main>
  );
}
