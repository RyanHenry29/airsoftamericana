// language: TSX, file: apps/store/src/app/components/DeptStrip.tsx, target: Next.js App Router
// Barra de navegação + mega menu: itens de departamento abrem o painel no hover
// (100 ms de intenção, 200 ms de tolerância de saída) com chevron pequeno;
// links de conteúdo (Guias/Blog) e CTA final ficam sem painel e sem seta.
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { StoreDepartment } from "../lib/store";

const content = [
  { label: "Guias", href: "/guia" },
  { label: "Blog", href: "/blog" },
];

const OPEN_DELAY = 100;
const CLOSE_DELAY = 200;

export function DeptStrip({ departments = [] }: { departments?: StoreDepartment[] }) {
  const [open, setOpen] = useState<StoreDepartment | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }

  function scheduleOpen(dept: StoreDepartment) {
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(dept), OPEN_DELAY);
  }

  function scheduleClose() {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY);
  }

  function closeNow() {
    clearTimers();
    setOpen(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNow();
    };
    window.addEventListener("scroll", closeNow, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", closeNow);
      window.removeEventListener("keydown", onKey);
      clearTimers();
    };
  }, []);

  const panelDept = open;

  return (
    <>
      <nav className="dept-strip" aria-label="Navegação por departamento">
        <span className="dept-strip__label">Departamentos</span>

        {departments.map((dept) => (
          <div
            key={dept.id}
            className="dept-strip__slot"
            onMouseEnter={() => scheduleOpen(dept)}
            onMouseLeave={scheduleClose}
            onFocus={() => scheduleOpen(dept)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleClose();
            }}
          >
            <Link
              href={`/departamento/${dept.slug}`}
              className={`dept-strip__item ${panelDept?.id === dept.id ? "is-open" : ""}`}
              onClick={closeNow}
              aria-expanded={panelDept?.id === dept.id}
            >
              {dept.name}
              <ChevronDown size={13} strokeWidth={2.2} className="dept-strip__chev" aria-hidden="true" />
            </Link>
          </div>
        ))}

        {content.map((c) => (
          <Link key={c.href} href={c.href} className="dept-strip__item dept-strip__item--content">
            {c.label}
          </Link>
        ))}

        <Link href="/catalogo" className="dept-strip__item dept-strip__item--all">
          Todos os produtos
        </Link>
      </nav>

      {panelDept && (
        <div
          className="mega-panel"
          role="group"
          aria-label={panelDept.name}
          onMouseEnter={clearTimers}
          onMouseLeave={scheduleClose}
        >
          <div className="mega-grid">
            <div className="mega-cols">
              {panelDept.children.map((child) => (
                <div key={child.id} className="mega-col">
                  <Link href={`/departamento/${child.slug}`} className="mega-group-title">
                    {child.name}
                  </Link>
                  <ul className="mega-links">
                    {child.children.map((grand) => (
                      <li key={grand.id}>
                        <Link href={`/catalogo?categoria=${grand.slug}`}>
                          {grand.name}
                          {grand.ageRestricted && <span className="age18">18+</span>}
                        </Link>
                      </li>
                    ))}
                    {child.children.length === 0 && (
                      <li>
                        <Link href={`/departamento/${child.slug}`}>Ver todos</Link>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>

            <aside className="mega-highlight">
              {panelDept.imageUrl ? (
                <div className="mega-highlight__media">
                  <Image
                    src={panelDept.imageUrl}
                    alt={panelDept.name}
                    fill
                    sizes="320px"
                    className="mega-highlight__img"
                  />
                </div>
              ) : null}
              <div className="mega-highlight__body">
                <span className="mega-title">Departamento</span>
                <h4>{panelDept.name}</h4>
                {panelDept.description && <p>{panelDept.description}</p>}
                <Link href={`/departamento/${panelDept.slug}`} className="mega-all">
                  Ver tudo em {panelDept.name} →
                </Link>
              </div>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
