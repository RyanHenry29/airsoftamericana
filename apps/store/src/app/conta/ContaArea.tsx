"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldCheck, User, Mail, IdCard, Phone, ArrowRight, LogOut, Clock } from "lucide-react";
import { API_URL } from "../lib/store";

type Customer = {
  id: string;
  name: string;
  email: string;
  cpf?: string | null;
  phone?: string | null;
  createdAt?: string | null;
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
    { kind: "link", label: "Meus pedidos", href: "/conta", icon: Clock, active: true },
  ];
  if (authed) items.push({ kind: "action", label: "Sair", action: "logout", icon: LogOut });
  return items;
}

export function ContaArea() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" });
        const json = (await res.json().catch(() => ({}))) as { customer?: Customer };
        if (res.ok && json.customer) setCustomer(json.customer);
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
          <div className="conta-avatar">{initialsPlaceholder()}</div>
          <div className="conta-ident">
            <p className="conta-kicker">MINHA CONTA</p>
            <h1 className="conta-name">Carregando…</h1>
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
            {menuFor(false).map((m) => (
              m.kind === "link" ? (
                <Link key={m.href} href={m.href} className="conta-menu-item conta-menu-item--off">
                  <m.icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </Link>
              ) : null
            ))}
          </aside>
          <main className="conta-main conta-main--empty">
            <div className="conta-empty">
              <div className="conta-empty-icon" aria-hidden="true">🔒</div>
              <h2 className="conta-empty-title">Entre com sua conta</h2>
              <p className="conta-empty-text">
                Veja pedidos, endereços e compre mais rápido.
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

  return (
    <div className="conta-shell">
      <div className="conta-header">
        <div className="conta-avatar">{initials}</div>
        <div className="conta-ident">
          <p className="conta-kicker">MINHA CONTA</p>
          <h1 className="conta-name">{customer.name}</h1>
          <p className="conta-email">{customer.email}</p>
        </div>
      </div>
      <div className="conta-body">
        <aside className="conta-sidebar">
          {menuFor(true).map((m) => {
            const Icon = m.icon;
            if (m.kind === "action" && m.action === "logout") {
              return (
                <button
                  key={m.label}
                  type="button"
                  onClick={logout}
                  className="conta-menu-item"
                >
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
                >
                  <Icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                  {m.active && <span className="conta-menu-dot" aria-hidden="true" />}
                </Link>
              );
            }
            return null;
          })}
        </aside>
        <main className="conta-main">
          <div className="conta-card">
            <div className="conta-card-head">
              <span className="conta-card-kicker">MEUS PEDIDOS</span>
              <Link href="/rastreamento" className="conta-card-link">
                Acompanhar pedido <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
            <div className="conta-empty">
              <div className="conta-empty-icon" aria-hidden="true">📦</div>
              <h2 className="conta-empty-title">Você ainda não fez nenhum pedido.</h2>
              <p className="conta-empty-text">Seus pedidos aparecem aqui assim que você comprar.</p>
              <div className="conta-empty-actions">
                <Link href="/catalogo" className="btn-primary">
                  Ir para a loja
                </Link>
              </div>
            </div>
          </div>

          <div className="conta-card mt-6">
            <div className="conta-card-head">
              <ShieldCheck size={14} strokeWidth={2} className="conta-card-icon" aria-hidden="true" />
              <span className="conta-card-kicker">SUA CONTA ESTÁ SEGURA</span>
            </div>
            <div className="conta-grid">
              <div className="conta-field">
                <span className="conta-field-label">E-mail</span>
                <p className="conta-field-value">{customer.email}</p>
              </div>
              <div className="conta-field">
                <span className="conta-field-label">CPF</span>
                <p className="conta-field-value">{customer.cpf ?? "—"}</p>
              </div>
              <div className="conta-field">
                <span className="conta-field-label">Telefone</span>
                <p className="conta-field-value">{customer.phone ?? "—"}</p>
              </div>
              <div className="conta-field">
                <span className="conta-field-label">Cadastro</span>
                <p className="conta-field-value">
                  {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString("pt-BR") : "—"}
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function initialsPlaceholder(): string {
  return "?";
}
