"use client";

import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Metrics = {
  ordersTotal: number;
  ordersApproved: number;
  productsPublished: number;
  lowStock: number;
  chargebacks: number;
  revenueCents: number;
  ticketCents: number;
  chargebackAmountCents?: number;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauth, setUnauth] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/admin/metrics`, {
          credentials: "include",
        });
        if (res.status === 401) {
          setUnauth(true);
          return;
        }
        if (!res.ok) {
          setError("Falha ao carregar métricas.");
          return;
        }
        const json = (await res.json()) as Metrics;
        setMetrics(json);
      } catch {
        setError("Erro de conexão com a API.");
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

  if (unauth) {
    return (
      <main className="px-6 py-24 text-center">
        <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6">
          401
        </div>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-6">
          Sessão expirada
        </h1>
        <p className="text-[#666] font-mono text-xs mb-10 max-w-md mx-auto">
          Entre no painel com sua conta de operador para ver as métricas.
        </p>
        <a href="/login" className="btn-primary px-8 py-3">
          IR PARA O LOGIN
        </a>
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
      </main>
    );
  }

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
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">Pedidos Hoje</span>
          <div className="font-display font-black text-3xl md:text-4xl text-white">{metrics.ordersTotal}</div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">+0 vs ontem</span>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">Receita Aprovada</span>
          <div className="font-display font-black text-3xl md:text-4xl text-[#8bcf16]">{brl(metrics.revenueCents)}</div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">aprovado</span>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">Produtos Publicados</span>
          <div className="font-display font-black text-3xl md:text-4xl text-white">{metrics.productsPublished}</div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">no catálogo</span>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#dc2626] block mb-3">Estoque Baixo</span>
          <div className="font-display font-black text-3xl md:text-4xl text-white">{metrics.lowStock}</div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">itens alerta</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="border border-[#111] bg-[#0a0a0a] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">Chargebacks</span>
          <div className="flex items-baseline gap-2 mb-2">
            <div className="font-display font-black text-3xl text-white">{metrics.chargebacks}</div>
            <span className="font-mono text-[0.6rem] uppercase tracking-tighter text-[#333]">disputas</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666]">Valor contestado</span>
            <div className="font-mono text-sm text-white">{brl(metrics.chargebackAmountCents ?? 0)}</div>
          </div>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">Ticket Médio</span>
          <div className="font-display font-black text-3xl text-white">{brl(metrics.ticketCents)}</div>
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] mt-2 block">por pedido aprovado</span>
        </div>
      </div>
    </main>
  );
}
