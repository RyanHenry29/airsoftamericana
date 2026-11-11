// language: TSX, file: apps/store/src/app/conta/PedidosArea.tsx, target: Next.js App Router
// Meus pedidos: lista real do cliente (GET /api/orders, escopo do próprio
// cliente) + modal de detalhe (espiar/comprar). Monta o mesmo casco da conta
// (ContaShell) com o acesso "pedidos" ativo no menu lateral.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Eye, Package, ShoppingCart } from "lucide-react";
import { API_URL, fetchWithTimeout } from "../lib/store";
import { ContaShell } from "./ContaShell";
import { logoutAccount, type Customer } from "./conta-menu";
import { OrderDetailModal } from "./OrderDetailModal";
import { PAY_LABEL, STATUS_LABEL, brl, dateBr } from "./order-labels";

type Order = {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  paymentMethod: "pix" | "cartao" | "boleto" | null;
  createdAt: string;
};

export function PedidosArea() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersFailed, setOrdersFailed] = useState(false);
  const [modal, setModal] = useState<{ number: string; mode: "espiar" | "comprar" } | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(false);
    setOrdersFailed(false);
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/auth/me`, { credentials: "include" });
      const json = (await res.json().catch(() => ({}))) as { customer?: Customer };
      if (res.ok && json.customer) {
        setCustomer(json.customer);
        try {
          const ord = await fetchWithTimeout(`${API_URL}/api/orders`, { credentials: "include" });
          const data = (await ord.json().catch(() => ({}))) as { items?: Order[] };
          if (ord.ok) {
            setOrders(data.items ?? []);
          } else {
            // conta carregada, lista fora: distingue "sem pedidos" de "sem resposta"
            setOrdersFailed(true);
          }
        } catch {
          setOrdersFailed(true);
        }
      } else if (res.status !== 401) {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await logoutAccount(router);
  }

  return (
    <ContaShell
      active="pedidos"
      kicker="MEUS PEDIDOS"
      customer={customer}
      loading={loading}
      loadError={loadError}
      onRetry={load}
      onLogout={logout}
      overlay={
        modal ? (
          <OrderDetailModal
            orderNumber={modal.number}
            mode={modal.mode}
            onClose={() => setModal(null)}
          />
        ) : undefined
      }
    >
      <section className="conta-card" aria-labelledby="pedidos-title">
        <div className="conta-card-head">
          <div>
            <span className="conta-card-kicker" id="pedidos-title">MEUS PEDIDOS</span>
            <p className="conta-card-sub">
              {ordersFailed
                ? "Não foi possível buscar agora"
                : orders.length > 0
                  ? `${orders.length} ${orders.length === 1 ? "pedido" : "pedidos"} na sua conta`
                  : "Seus pedidos aparecem aqui assim que você comprar"}
            </p>
          </div>
          <Link href="/rastreamento" className="conta-card-link">
            Acompanhar pedido <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>

        {ordersFailed ? (
          <div className="conta-empty" role="alert">
            <span className="conta-empty-icon" aria-hidden="true">
              <AlertTriangle size={26} strokeWidth={1.6} />
            </span>
            <h2 className="conta-empty-title">Não conseguimos carregar seus pedidos</h2>
            <p className="conta-empty-text">
              A lista não respondeu agora. Seus pedidos continuam salvos — tente de novo.
            </p>
            <div className="conta-empty-actions">
              <button type="button" className="btn-primary" onClick={() => load()}>
                Tentar novamente
              </button>
            </div>
          </div>
        ) : orders.length === 0 ? (
          <div className="conta-empty">
            <span className="conta-empty-icon" aria-hidden="true">
              <Package size={26} strokeWidth={1.6} />
            </span>
            <h2 className="conta-empty-title">Você ainda não fez nenhum pedido.</h2>
            <p className="conta-empty-text">Quando você comprar, o pedido e o rastreio ficam aqui.</p>
            <div className="conta-empty-actions">
              <Link href="/catalogo" className="btn-primary">
                Ir para a loja
              </Link>
            </div>
          </div>
        ) : (
          <ol className="conta-orders">
            {orders.map((o) => (
              <li key={o.id} className="conta-order">
                <div className="conta-order__id">
                  <strong>Pedido {o.number}</strong>
                  <span>{dateBr(o.createdAt)}</span>
                </div>
                <span className="conta-order__status" data-status={o.status}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
                <span className="conta-order__pay">
                  {o.paymentMethod ? (PAY_LABEL[o.paymentMethod] ?? "—") : "—"}
                </span>
                <span className="conta-order__total">{brl(o.totalCents)}</span>
                <div className="conta-order__actions">
                  <button
                    type="button"
                    className="conta-order__btn"
                    onClick={() => setModal({ number: o.number, mode: "espiar" })}
                  >
                    <Eye size={13} strokeWidth={2} aria-hidden="true" /> ESPIAR
                  </button>
                  <button
                    type="button"
                    className="conta-order__btn conta-order__btn--buy"
                    onClick={() => setModal({ number: o.number, mode: "comprar" })}
                  >
                    <ShoppingCart size={13} strokeWidth={2} aria-hidden="true" /> COMPRAR
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </ContaShell>
  );
}
