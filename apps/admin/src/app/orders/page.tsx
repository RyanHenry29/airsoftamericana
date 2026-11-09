"use client";

import { useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Order = {
  id: string;
  number: string;
  customerName: string;
  customerEmail: string;
  status: string;
  totalCents: number;
  riskLevel: string;
  riskScore: number;
  createdAt: string;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function OrdersPage() {
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  useGateRedirect(failure);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const json = await adminJson<{ items?: Order[] }>("/api/admin/orders");
        setItems(json.items ?? []);
        setFailure(null);
        setError("");
      } catch (e) {
        setFailure(e);
        setError(messageOf(e, "Falha ao carregar pedidos."));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function transition(id: string, to: string) {
    setError("");
    try {
      await adminJson(`/api/admin/orders/${id}/transition`, {
        method: "POST",
        body: JSON.stringify({ status: to }),
      });
      setItems(items.map((o) => (o.id === id ? { ...o, status: to } : o)));
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao alterar status do pedido."));
    }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <div className="grid grid-cols-1 gap-4">
          <div className="h-20 bg-[#0a0a0a] border border-[#111]" />
          <div className="h-20 bg-[#0a0a0a] border border-[#111]" />
        </div>
      </main>
    );
  }

  if (error) {
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
      <div className="admin-section-head">
        <div>
          <span className="admin-section-head__kicker">Operação</span>
          <h1 className="admin-section-head__title">Gestão de Pedidos</h1>
          <p className="admin-section-head__subtitle">Visualizar, alterar status, reembolso</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty__num">0</div>
          <h2 className="admin-empty__title">Nenhum pedido ainda</h2>
          <p className="admin-empty__text">Os pedidos aparecem aqui à medida que os clientes finalizam a compra.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Risco</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="group">
                  <td>
                    <div className="font-mono text-sm font-bold text-white">#{o.number}</div>
                    <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mt-1">
                      {new Date(o.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </td>
                  <td>
                    <div className="font-mono text-sm text-white">{o.customerName}</div>
                    <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mt-1">
                      {o.customerEmail}
                    </span>
                  </td>
                  <td className="font-mono text-sm font-bold text-[#8bcf16]">{brl(o.totalCents)}</td>
                  <td>
                    <span className={`admin-badge ${o.status === "pagamento_aprovado" ? "admin-badge--ok" : o.status.includes("cancel") || o.status.includes("reembols") ? "admin-badge--err" : "admin-badge--warn"}`}>
                      {o.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className={`admin-badge ${o.riskLevel === "alto" ? "admin-badge--err" : o.riskLevel === "medio" ? "admin-badge--warn" : "admin-badge--ok"}`}>
                      {o.riskLevel.toUpperCase()} ({o.riskScore})
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      {o.status !== "pagamento_aprovado" && (
                        <button
                          type="button"
                          onClick={() => transition(o.id, "pagamento_aprovado")}
                          className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#8bcf16] text-[#8bcf16] hover:bg-[#8bcf16] hover:text-[#000] transition-colors"
                        >
                          Aprovar
                        </button>
                      )}
                      {o.status !== "cancelado" && (
                        <button
                          type="button"
                          onClick={() => transition(o.id, "cancelado")}
                          className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#dc2626] text-[#dc2626] hover:bg-[#dc2626] hover:text-[#fff] transition-colors"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
