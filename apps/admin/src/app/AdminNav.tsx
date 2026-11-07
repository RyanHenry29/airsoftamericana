"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Produtos" },
  { href: "/orders", label: "Pedidos" },
  { href: "/customers", label: "Clientes" },
  { href: "/categories", label: "Categorias" },
  { href: "/cupons", label: "Cupons" },
  { href: "/users", label: "Usuários" },
  { href: "/fraud", label: "Antifraude" },
];

export function AdminNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="admin-menu-toggle"
        aria-expanded={open}
        aria-label="Menu de navegacao"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="admin-menu-icon">
          {open ? "✕" : "☰"}
        </span>
      </button>

      <nav className={`admin-nav ${open ? "is-open" : ""}`}>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}