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
  const deltaClass = delta > 0 ? "admin-card__delta--up" : delta < 0 ? "admin-card__delta--down" : "";

  return (
    <main className="px-6 pb-24">
      <div className="admin-section-head">
        <div>
          <span className="admin-section-head__kicker">Painel</span>
          <h1 className="admin-section-head__title">Dashboard</h1>
          <p className="admin-section-head__subtitle">Visão geral do sistema · dados em tempo real</p>
        </div>
        <a href="/orders" className="btn-primary px-6 py-2.5">Gerenciar pedidos</a>
      </div>

      <div className="admin-grid">
        <div className="admin-card">
          <span className="admin-card__kicker">Pedidos hoje</span>
          <div className="admin-card__value">{metrics.ordersToday}</div>
          <span className="admin-card__sub">{metrics.ordersYesterday} ontem</span>
          {delta !== 0 && (
            <span className={`admin-card__delta ${deltaClass}`}>
              {delta > 0 ? "+" : ""}{delta} vs ontem
            </span>
          )}
        </div>
        <div className="admin-card">
          <span className="admin-card__kicker">Receita de hoje</span>
          <div className="admin-card__value">{brl(metrics.revenueTodayCents)}</div>
          <span className="admin-card__sub">{brl(metrics.revenueCents)} acumulados</span>
        </div>
        <div className="admin-card">
          <span className="admin-card__kicker">Pedidos no total</span>
          <div className="admin-card__value">{metrics.ordersTotal}</div>
          <span className="admin-card__sub">{metrics.ordersApproved} aprovados</span>
        </div>
        <div className="admin-card">
          <span className="admin-card__kicker">Estoque baixo</span>
          <div className="admin-card__value">{metrics.lowStock}</div>
          <span className="admin-card__sub">itens em alerta</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5rem">
        <div className="admin-card">
          <span className="admin-card__kicker">Chargebacks</span>
          <div className="admin-card__value">{metrics.chargebacks}</div>
          <span className="admin-card__sub">disputas</span>
          <span className="admin-card__sub">Valor contestado: {brl(metrics.chargebackAmountCents)}</span>
        </div>
        <div className="admin-card">
          <span className="admin-card__kicker">Ticket médio</span>
          <div className="admin-card__value">{brl(metrics.ticketCents)}</div>
          <span className="admin-card__sub">por pedido aprovado</span>
        </div>
      </div>
    </main>
  );
}
