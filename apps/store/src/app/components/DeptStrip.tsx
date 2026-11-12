// language: TSX, file: apps/store/src/app/components/DeptStrip.tsx, target: Next.js App Router
// Barra de categorias + mega menu: item abre o painel no hover (100 ms de
// intenção, 200 ms de tolerância de saída) com chevron; links de conteúdo
// (Guias/Blog) e CTA final ficam sem painel e sem seta. Árvore real de
// /api/store/categories — tudo aponta para /catalogo?categoria=:slug.
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { StoreCategoryNode } from "../lib/store";

const content = [
  { label: "Guias", href: "/guia" },
  { label: "Blog", href: "/blog" },
];

const OPEN_DELAY = 100;
const CLOSE_DELAY = 200;

export function DeptStrip({ categories = [] }: { categories?: StoreCategoryNode[] }) {
  const [open, setOpen] = useState<StoreCategoryNode | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }

  function scheduleOpen(cat: StoreCategoryNode) {
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(cat), OPEN_DELAY);
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

  if (categories.length === 0) return null;

  const panel = open;

  return (
    <>
      <nav className="dept-strip" aria-label="Categorias de produto">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="dept-strip__slot"
            onMouseEnter={() => scheduleOpen(cat)}
            onMouseLeave={scheduleClose}
            onFocus={() => scheduleOpen(cat)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleClose();
            }}
          >
            <Link
              href={`/catalogo?categoria=${cat.slug}`}
              className={`dept-strip__item ${panel?.id === cat.id ? "is-open" : ""}`}
              onClick={closeNow}
              aria-expanded={panel?.id === cat.id}
            >
              {cat.name}
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

      {panel && (
        <div
          className="mega-panel"
          role="group"
          aria-label={panel.name}
          onMouseEnter={clearTimers}
          onMouseLeave={scheduleClose}
        >
          <div className="mega-grid">
            <div className="mega-cols">
              {panel.children?.map((child) => (
                <div key={child.id} className="mega-col">
                  <Link href={`/catalogo?categoria=${child.slug}`} className="mega-group-title">
                    {child.name}
                  </Link>
                  <ul className="mega-links">
                    {child.children?.map((grand) => (
                      <li key={grand.id}>
                        <Link href={`/catalogo?categoria=${grand.slug}`}>
                          {grand.name}
                          {grand.ageRestricted && <span className="age18">18+</span>}
                        </Link>
                      </li>
                    ))}
                    {!child.children?.length && (
                      <li>
                        <Link href={`/catalogo?categoria=${child.slug}`}>Ver todos</Link>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
              {!panel.children?.length && (
                <div className="mega-col">
                  <ul className="mega-links">
                    <li>
                      <Link href={`/catalogo?categoria=${panel.slug}`}>
                        Ver tudo em {panel.name}
                        {panel.ageRestricted && <span className="age18">18+</span>}
                      </Link>
                    </li>
                  </ul>
                </div>
              )}
            </div>

            <aside className="mega-highlight">
              {panel.imageUrl ? (
                <div className="mega-highlight__media">
                  <Image
                    src={panel.imageUrl}
                    alt={panel.name}
                    fill
                    sizes="320px"
                    className="mega-highlight__img"
                  />
                </div>
              ) : null}
              <div className="mega-highlight__body">
                <span className="mega-title">Categoria</span>
                <h4>{panel.name}</h4>
                {panel.description && <p>{panel.description}</p>}
                <Link href={`/catalogo?categoria=${panel.slug}`} className="mega-all">
                  Ver tudo em {panel.name} →
                </Link>
              </div>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
