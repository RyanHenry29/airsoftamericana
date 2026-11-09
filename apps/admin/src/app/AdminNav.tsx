"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_URL, clearCsrfToken } from "../lib/api";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Produtos" },
  { href: "/products/import", label: "Importar CSV" },
  { href: "/banners", label: "Banners (Hero)" },
  { href: "/orders", label: "Pedidos" },
  { href: "/customers", label: "Clientes" },
  { href: "/categories", label: "Categorias" },
  { href: "/brands", label: "Marcas" },
  { href: "/cupons", label: "Cupons" },
  { href: "/users", label: "Acessos" },
  { href: "/fraud", label: "Antifraude" },
];

export function AdminNav() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch(`${API_URL}/api/auth/admin-logout`, { method: "POST", credentials: "include" });
    } catch {
      // segue para login mesmo sem resposta
    } finally {
      clearCsrfToken();
      setBusy(false);
      setOpen(false);
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <>
      <button
        type="button"
        className="admin-menu-toggle"
        aria-expanded={open}
        aria-label="Menu de navegacao"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="admin-menu-icon">{open ? "✕" : "☰"}</span>
      </button>

      <nav className={`admin-nav ${open ? "is-open" : ""}`}>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={logout}
          disabled={busy}
          className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] hover:text-[#dc2626] transition-colors text-left mt-2"
        >
          {busy ? "Saindo..." : "Sair"}
        </button>
      </nav>
    </>
  );
}