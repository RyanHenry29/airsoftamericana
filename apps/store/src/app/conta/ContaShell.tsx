// language: TSX, file: apps/store/src/app/conta/ContaShell.tsx, target: Next.js App Router
// Casco compartilhado das telas da conta: identidade (com foto de perfil e
// fallback de iniciais), menu lateral e os três estados de carga (carregando,
// falha, deslogado). /conta e /conta/pedidos montam este mesmo casco — só o
// acesso ativo e o conteúdo mudam.
"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";
import { API_URL } from "../lib/store";
import { dateBr } from "./order-labels";
import { initialsOf, menuFor, type ContaActiveKey, type Customer } from "./conta-menu";

/**
 * Foto de perfil com fallback de iniciais: o <img> aponta pra rota da conta e,
 * se não houver foto (404) ou falhar, mostra as iniciais no lugar. `version`
 * força o recarregamento depois de um upload/remoção.
 */
export function AvatarFace({ version, fallback }: { version: number; fallback: string }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setMissing(false);
  }, [version]);

  if (missing) return <>{fallback}</>;
  return (
    <img
      className="conta-avatar__img"
      src={`${API_URL}/api/customer/avatar?v=${version}`}
      alt=""
      onError={() => setMissing(true)}
    />
  );
}

export function ContaShell({
  active,
  kicker,
  customer,
  loading,
  loadError,
  onRetry,
  onLogout,
  avatarVersion = 0,
  overlay,
  children,
}: {
  active: ContaActiveKey;
  kicker: string;
  customer: Customer | null;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  onLogout: () => void;
  /** Muda depois de upload/remoção de foto — o cabeçalho recarrega a imagem. */
  avatarVersion?: number;
  overlay?: ReactNode;
  children?: ReactNode;
}) {
  if (loading) {
    return (
      <div className="conta-shell">
        <div className="conta-header">
          <div className="conta-avatar">?</div>
          <div className="conta-ident">
            <p className="conta-kicker">{kicker}</p>
            <h1 className="conta-name conta-name--skeleton">Carregando…</h1>
          </div>
        </div>
        <div className="conta-body">
          <aside className="conta-sidebar">
            {menuFor(active, false).map((m) => (
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

  if (loadError) {
    return (
      <div className="conta-shell">
        <div className="conta-header">
          <div className="conta-avatar" aria-hidden="true">!</div>
          <div className="conta-ident">
            <p className="conta-kicker">{kicker}</p>
            <h1 className="conta-name">Falha ao carregar</h1>
          </div>
        </div>
        <div className="conta-body">
          <aside className="conta-sidebar">
            {menuFor(active, false).map((m) =>
              m.kind === "link" ? (
                <Link key={m.href} href={m.href} className="conta-menu-item conta-menu-item--off">
                  <m.icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </Link>
              ) : null
            )}
          </aside>
          <main className="conta-main">
            <div className="conta-empty" role="alert">
              <span className="conta-empty-icon" aria-hidden="true">
                <AlertTriangle size={26} strokeWidth={1.6} />
              </span>
              <h2 className="conta-empty-title">Não conseguimos carregar sua conta</h2>
              <p className="conta-empty-text">
                A conexão com a loja falhou. Nada do seu histórico se perdeu — tente de novo.
              </p>
              <div className="conta-empty-actions">
                <button type="button" className="btn-primary" onClick={onRetry}>
                  <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
                  Tentar novamente
                </button>
              </div>
            </div>
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
            <p className="conta-kicker">{kicker}</p>
            <h1 className="conta-name">Você ainda não entrou</h1>
          </div>
        </div>
        <div className="conta-body">
          <aside className="conta-sidebar">
            {menuFor(active, false).map((m) =>
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

  const initials = initialsOf(customer.name);

  return (
    <div className="conta-shell">
      <div className="conta-header">
        <div className="conta-avatar" aria-hidden="true">
          <AvatarFace version={avatarVersion} fallback={initials} />
        </div>
        <div className="conta-ident">
          <p className="conta-kicker">{kicker}</p>
          <h1 className="conta-name">{customer.name}</h1>
          <p className="conta-meta">
            {customer.email}
            {customer.createdAt && <> · cliente desde {dateBr(customer.createdAt)}</>}
          </p>
        </div>
      </div>

      <div className="conta-body">
        <aside className="conta-sidebar" aria-label="Menu da conta">
          {menuFor(active, true).map((m) => {
            const Icon = m.icon;
            if (m.kind === "action" && m.action === "logout") {
              return (
                <button key={m.label} type="button" onClick={onLogout} className="conta-menu-item conta-menu-item--action">
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

        <main className="conta-main">{children}</main>
      </div>

      {overlay}
    </div>
  );
}
