"use client";

import { useEffect, useState } from "react";
import { API_URL, adminFetch } from "../../lib/api";

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
  const [unauth, setUnauth] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/admin/orders`, {
          credentials: "include",
        });
        if (res.status === 401) {
          setUnauth(true);
          return;
        }
        if (!res.ok) {
          setError("Falha ao carregar pedidos.");
          return;
        }
        const json = (await res.json()) as { items?: Order[] };
        setItems(json.items ?? []);
      } catch {
        setError("Erro de conexão com a API.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function transition(id: string, to: string) {
    const res = await adminFetch(`/api/admin/orders/${id}/transition`, {
      method: "POST",
      body: JSON.stringify({ status: to }),
    });
    if (!res.ok) {
      setError("Falha ao alterar status do pedido.");
      return;
    }
    setItems(items.map((o) => (o.id === id ? { ...o, status: to } : o)));
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
          Entre no painel para gerenciar pedidos.
        </p>
        <a href="/login" className="btn-primary px-8 py-3">
          IR PARA O LOGIN
        </a>
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
      <header className="mb-12 border-b border-[#111] pb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
            Gestão de Pedidos
          </h1>
          <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
            Visualizar, alterar status, reembolso
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
          <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6 inline-block">
            0
          </div>
          <h2 className="font-display font-black text-3xl uppercase leading-none tracking-tighter text-white mb-4">
            Nenhum pedido ainda
          </h2>
          <p className="text-[#666] font-mono text-xs max-w-md mx-auto mb-8">
            Os pedidos aparecem aqui à medida que os clientes finalizam a compra.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table>
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
                    <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] block mt-1">
                      {new Date(o.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </td>
                  <td>
                    <div className="font-mono text-sm text-white">{o.customerName}</div>
                    <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] block mt-1">
                      {o.customerEmail}
                    </span>
                  </td>
                  <td className="font-mono text-sm font-bold text-[#8bcf16]">{brl(o.totalCents)}</td>
                  <td>
                    <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${o.status === "pagamento_aprovado" ? "border-[#8bcf16] text-[#8bcf16]" : o.status.includes("cancel") || o.status.includes("reembols") ? "border-[#dc2626] text-[#dc2626]" : "border-[#333] text-[#333]"}`}>
                      {o.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${o.riskLevel === "alto" ? "border-[#dc2626] text-[#dc2626]" : o.riskLevel === "medio" ? "border-[#8bcf16]/50 text-[#8bcf16]" : "border-[#333] text-[#333]"}`}>
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
