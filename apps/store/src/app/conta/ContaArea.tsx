// language: TSX, file: apps/store/src/app/conta/ContaArea.tsx, target: Next.js App Router
// Minha conta: identidade, menu lateral e pedidos reais do cliente
// (GET /api/orders, escopo do próprio cliente). CPF/telefone formatados;
// status com o mesmo rótulo do rastreamento.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ClipboardList,
  Eye,
  Headset,
  IdCard,
  Lock,
  LogOut,
  Package,
  Phone,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { API_URL, fetchWithTimeout } from "../lib/store";
import { OrderDetailModal } from "./OrderDetailModal";
import { PAY_LABEL, STATUS_LABEL, brl, dateBr } from "./order-labels";

type Customer = {
  id: string;
  name: string;
  email: string;
  cpf?: string | null;
  phone?: string | null;
  createdAt?: string | null;
};

type Order = {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  paymentMethod: "pix" | "cartao" | "boleto" | null;
  createdAt: string;
};

type MenuLink = {
  kind: "link";
  label: string;
  href: string;
  icon: React.ElementType;
  active?: boolean;
};

type MenuAction = {
  kind: "action";
  label: string;
  action: "logout";
  icon: React.ElementType;
};

type MenuItem = MenuLink | MenuAction;

function menuFor(authed: boolean): MenuItem[] {
  const items: MenuItem[] = [
    { kind: "link", label: "Meus pedidos", href: "/conta", icon: ClipboardList, active: true },
    { kind: "link", label: "Rastrear pedido", href: "/rastreamento", icon: Truck },
    { kind: "link", label: "Atendimento", href: "/atendimento", icon: Headset },
  ];
  if (authed) items.push({ kind: "action", label: "Sair da conta", action: "logout", icon: LogOut });
  return items;
}

/** 000.000.000-00 — só formata quando o CPF tem os 11 dígitos. */
function formatCpf(value: string | null | undefined) {
  if (!value) return null;
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length !== 11) return value;
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

/** (00) 00000-0000 — fixo 10 dígitos, celular 11. */
function formatPhone(value: string | null | undefined) {
  if (!value) return null;
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length < 10) return value;
  if (d.length === 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

export function ContaArea() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [modal, setModal] = useState<{ number: string; mode: "espiar" | "comprar" } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetchWithTimeout(`${API_URL}/api/auth/me`, { credentials: "include" });
        const json = (await res.json().catch(() => ({}))) as { customer?: Customer };
        if (res.ok && json.customer) {
          setCustomer(json.customer);
          try {
            const ord = await fetchWithTimeout(`${API_URL}/api/orders`, { credentials: "include" });
            const data = (await ord.json().catch(() => ({}))) as { items?: Order[] };
            if (ord.ok) setOrders(data.items ?? []);
          } catch {
            /* offline */
          }
        }
      } catch {
        /* offline */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function logout() {
    await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="conta-shell">
        <div className="conta-header">
          <div className="conta-avatar">?</div>
          <div className="conta-ident">
            <p className="conta-kicker">MINHA CONTA</p>
            <h1 className="conta-name conta-name--skeleton">Carregando…</h1>
          </div>
        </div>
        <div className="conta-body">
          <aside className="conta-sidebar">
            {menuFor(false).map((m) => (
              <span key={m.label} className="conta-menu-item conta-menu-item--skeleton">
                <span className="conta-menu-icon" aria-hidden="true" />
                <span className="conta-menu-label">—</span>
              </span>
            ))}
          </aside>
          <main className="conta-main">
            <div className="conta-card conta-card--skeleton" />
            <div className="conta-card conta-card--skeleton" />
          </main>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="conta-shell">
        <div className="conta-header">
          <div className="conta-avatar">?</div>
          <div className="conta-ident">
            <p className="conta-kicker">MINHA CONTA</p>
            <h1 className="conta-name">Você ainda não entrou</h1>
          </div>
        </div>
        <div className="conta-body">
          <aside className="conta-sidebar">
            {menuFor(false).map((m) =>
              m.kind === "link" ? (
                <Link key={m.href} href={m.href} className="conta-menu-item conta-menu-item--off">
                  <m.icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </Link>
              ) : null
            )}
          </aside>
          <main className="conta-main">
            <div className="conta-empty">
              <span className="conta-empty-icon" aria-hidden="true">
                <Lock size={26} strokeWidth={1.6} />
              </span>
              <h2 className="conta-empty-title">Entre com sua conta</h2>
              <p className="conta-empty-text">
                Veja seus pedidos, acompanhe a entrega e compre mais rápido.
              </p>
              <div className="conta-empty-actions">
                <Link href="/entrar" className="btn-primary">
                  Entrar
                </Link>
                <Link href="/cadastro" className="btn-ghost">
                  Criar conta
                </Link>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const initials = customer.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const cpf = formatCpf(customer.cpf);
  const phone = formatPhone(customer.phone);

  return (
    <div className="conta-shell">
      <div className="conta-header">
        <div className="conta-avatar" aria-hidden="true">{initials}</div>
        <div className="conta-ident">
          <p className="conta-kicker">MINHA CONTA</p>
          <h1 className="conta-name">{customer.name}</h1>
          <p className="conta-meta">
            {customer.email}
            {customer.createdAt && <> · cliente desde {dateBr(customer.createdAt)}</>}
          </p>
        </div>
      </div>

      <div className="conta-body">
        <aside className="conta-sidebar" aria-label="Menu da conta">
          {menuFor(true).map((m) => {
            const Icon = m.icon;
            if (m.kind === "action" && m.action === "logout") {
              return (
                <button key={m.label} type="button" onClick={logout} className="conta-menu-item conta-menu-item--action">
                  <Icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </button>
              );
            }
            if (m.kind === "link") {
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  className={`conta-menu-item ${m.active ? "conta-menu-item--active" : ""}`}
                  aria-current={m.active ? "page" : undefined}
                >
                  <Icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </Link>
              );
            }
            return null;
          })}
        </aside>

        <main className="conta-main">
          <section className="conta-card" aria-labelledby="pedidos-title">
            <div className="conta-card-head">
              <div>
                <span className="conta-card-kicker" id="pedidos-title">MEUS PEDIDOS</span>
                <p className="conta-card-sub">
                  {orders.length > 0
                    ? `${orders.length} ${orders.length === 1 ? "pedido" : "pedidos"} na sua conta`
                    : "Seus pedidos aparecem aqui assim que você comprar"}
                </p>
              </div>
              <Link href="/rastreamento" className="conta-card-link">
                Acompanhar pedido <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>

            {orders.length === 0 ? (
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
                    <span className="conta-order__pay">{o.paymentMethod ? (PAY_LABEL[o.paymentMethod] ?? "—") : "—"}</span>
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

          <section className="conta-card conta-card--data" aria-labelledby="dados-title">
            <div className="conta-card-head">
              <div>
                <span className="conta-card-kicker conta-card-kicker--secure" id="dados-title">
                  <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
                  DADOS DA CONTA
                </span>
                <p className="conta-card-sub">Informações do seu cadastro na loja</p>
              </div>
            </div>
            <div className="conta-grid">
              <div className="conta-field">
                <span className="conta-field-label">
                  <IdCard size={13} strokeWidth={2} aria-hidden="true" /> E-mail
                </span>
                <p className="conta-field-value">{customer.email}</p>
              </div>
              <div className="conta-field">
                <span className="conta-field-label">
                  <IdCard size={13} strokeWidth={2} aria-hidden="true" /> CPF
                </span>
                <p className="conta-field-value">{cpf ?? "—"}</p>
              </div>
              <div className="conta-field">
                <span className="conta-field-label">
                  <Phone size={13} strokeWidth={2} aria-hidden="true" /> Telefone
                </span>
                <p className="conta-field-value">{phone ?? "—"}</p>
              </div>
              <div className="conta-field">
                <span className="conta-field-label">
                  <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" /> Cadastro
                </span>
                <p className="conta-field-value">
                  {customer.createdAt ? dateBr(customer.createdAt) : "—"}
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>

      {modal && (
        <OrderDetailModal
          orderNumber={modal.number}
          mode={modal.mode}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
