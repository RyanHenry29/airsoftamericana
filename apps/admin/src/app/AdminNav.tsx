// language: TSX, file: apps/admin/src/app/AdminNav.tsx, target: Next.js App Router
// Menu lateral agrupado por módulo, recolhível, com badges e papel-based visibility.
"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Package,
  Box,
  Tag,
  Upload,
  Brain,
  Archive,
  Truck,
  ShoppingCart,
  Users,
  Ticket,
  BarChart2,
  Image,
  LayoutGrid,
  CreditCard,
  AlertTriangle,
  Shield,
  Settings,
  Key,
  Activity,
  LogOut,
  Store,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  Bell,
  AlertCircle,
  PackageCheck,
} from "lucide-react";
import { adminJson } from "../lib/api";
import { useAuth } from "./lib/useAuth";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  roles?: string[]; // papéis que podem ver (vazio = todos)
  badge?: number | "dot"; // contador ou ponto
};

type NavSection = {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Visão geral",
    defaultOpen: true,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, badge: "dot" },
    ],
  },
  {
    title: "Catálogo",
    defaultOpen: true,
    items: [
      { href: "/products", label: "Produtos", icon: Package, badge: 0 },
      { href: "/categories", label: "Categorias", icon: Box },
      { href: "/brands", label: "Marcas", icon: Tag },
      { href: "/products/import", label: "Importar CSV", icon: Upload },
      { href: "/assistente", label: "Assistente IA", icon: Brain },
    ],
  },
  {
    title: "Estoque",
    defaultOpen: true,
    items: [
      { href: "/inventory", label: "Estoque e movimentações", icon: Archive, badge: 1 },
    ],
  },
  {
    title: "Vendas",
    defaultOpen: true,
    items: [
      { href: "/orders", label: "Pedidos", icon: ShoppingCart, badge: 0 },
      { href: "/customers", label: "Clientes", icon: Users },
      { href: "/cupons", label: "Cupons", icon: Ticket },
      { href: "/tickets", label: "Atendimento", icon: Ticket, badge: 2 },
    ],
  },
  {
    title: "Loja (aparência)",
    defaultOpen: true,
    items: [
      { href: "/banners", label: "Banners e Hero", icon: Image },
      { href: "/homepage-sections", label: "Seções da Home", icon: LayoutGrid },
    ],
  },
  {
    title: "Financeiro e risco",
    defaultOpen: false,
    items: [
      { href: "/gateways", label: "Pagamentos", icon: CreditCard },
      { href: "/chargebacks", label: "Chargebacks", icon: AlertTriangle, badge: 3 },
      { href: "/fraud", label: "Antifraude", icon: Shield },
    ],
  },
  {
    title: "Sistema",
    defaultOpen: false,
    items: [
      { href: "/settings", label: "Configurações", icon: Settings },
      { href: "/users", label: "Acessos", icon: Key },
      { href: "/audit", label: "Auditoria", icon: Activity },
    ],
  },
];

const ROLE_HIERARCHY = ["operador", "gerente", "financeiro", "superadmin"];
const canAccess = (userRole: string | null, requiredRoles?: string[]) => {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (!userRole) return false;
  const userIndex = ROLE_HIERARCHY.indexOf(userRole);
  return requiredRoles.some((r) => ROLE_HIERARCHY.indexOf(r) <= userIndex);
};

export function AdminNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    Object.fromEntries(NAV_SECTIONS.map((s) => [s.title, s.defaultOpen ?? true]))
  );
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Carrega badges (contadores)
  useEffect(() => {
    async function loadBadges() {
      try {
        const [orders, inventory, tickets, chargebacks] = await Promise.all([
          adminJson<{ pending_count?: number }>("/api/admin/orders/stats/pending").catch(() => ({ pending_count: 0 })),
          adminJson<{ low_stock_count?: number }>("/api/admin/inventory/stats/low").catch(() => ({ low_stock_count: 0 })),
          adminJson<{ open_count?: number }>("/api/admin/tickets/stats/open").catch(() => ({ open_count: 0 })),
          adminJson<{ pending_count?: number }>("/api/admin/chargebacks/stats/pending").catch(() => ({ pending_count: 0 })),
        ]);
        setBadges({
          orders: orders.pending_count ?? 0,
          inventory: inventory.low_stock_count ?? 0,
          tickets: tickets.open_count ?? 0,
          chargebacks: chargebacks.pending_count ?? 0,
        });
      } catch {
        // silencioso
      }
    }
    if (!authLoading && user) loadBadges();
  }, [user, authLoading]);

  const toggleSection = (title: string) => {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/admin-logout", { method: "POST", credentials: "include" });
    } catch {
      // segue para login mesmo sem resposta
    } finally {
      setBusy(false);
      setMobileOpen(false);
      router.replace("/login");
      router.refresh();
    }
  }

  if (authLoading) {
    return (
      <nav className="admin-nav" aria-label="Navegação principal">
        <div className="admin-nav__loading" role="status" aria-busy="true">
          <div className="admin-nav__skeleton" />
          <div className="admin-nav__skeleton" />
          <div className="admin-nav__skeleton" />
        </div>
      </nav>
    );
  }

  return (
    <>
      <button
        type="button"
        className="admin-menu-toggle"
        aria-expanded={mobileOpen}
        aria-label="Menu de navegação"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <span className="admin-menu-icon">{mobileOpen ? <X size={24} strokeWidth={2.5} /> : <Menu size={24} strokeWidth={2.5} />}</span>
      </button>

      <nav className={`admin-nav ${mobileOpen ? "is-open" : ""}`} aria-label="Navegação principal">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) =>
            canAccess(user?.role ?? null, item.roles)
          );
          if (visibleItems.length === 0) return null;

          const isOpen = openSections[section.title] ?? true;
          const hasActive = visibleItems.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"));

          return (
            <section key={section.title} className="admin-nav__section">
              <button
                type="button"
                className="admin-nav__section-toggle"
                onClick={() => toggleSection(section.title)}
                aria-expanded={isOpen}
              >
                <span className="admin-nav__section-title">{section.title}</span>
                {isOpen ? <ChevronDown size={14} strokeWidth={2.5} /> : <ChevronRight size={14} strokeWidth={2.5} />}
              </button>

              <ul className={`admin-nav__section-items ${isOpen ? "is-open" : ""}`}>
                {visibleItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  let badgeContent: React.ReactNode = null;
                  if (item.badge === "dot") {
                    badgeContent = <span className="admin-nav__badge admin-nav__badge--dot" aria-hidden="true" />;
                  } else if (typeof item.badge === "number") {
                    const badgeKeys = ["orders", "inventory", "tickets", "chargebacks"];
                    const key = badgeKeys[item.badge];
                    if (key) {
                      const count = badges[key] ?? 0;
                      if (count > 0) badgeContent = <span className="admin-nav__badge">{count > 99 ? "99+" : count}</span>;
                    }
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`admin-nav__item ${isActive ? "is-active" : ""}`}
                        onClick={() => setMobileOpen(false)}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <item.icon size={16} strokeWidth={2} aria-hidden="true" />
                        <span>{item.label}</span>
                        {badgeContent}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <div className="admin-nav__footer">
          <div className="admin-nav__user">
            {user && (
              <>
                <div className="admin-nav__user-name">{user.name}</div>
                <div className="admin-nav__user-role">{user.role}</div>
              </>
            )}
          </div>
          <div className="admin-nav__actions">
            <a
              href="https://airsoftamericana.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-nav__store-link"
              title="Ver loja pública"
            >
              <Store size={16} strokeWidth={2} /> Ver loja
            </a>
            <button
              type="button"
              onClick={logout}
              disabled={busy}
              className="admin-nav__logout"
            >
              {busy ? "Saindo..." : "Sair"}
              <LogOut size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}