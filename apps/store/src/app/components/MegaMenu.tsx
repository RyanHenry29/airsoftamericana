// language: TSX, file: apps/store/src/app/components/MegaMenu.tsx, target: Next.js App Router
// Mega menu por departamentos: três níveis, foto do departamento e links de catálogo.
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { StoreDepartment } from "../lib/store";
import { API_URL } from "../lib/store";

export function MegaMenu({ departments }: { departments: StoreDepartment[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState<string | null>(null);

  useEffect(() => {
    const close = () => setOpen(null);
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, []);

  if (departments.length === 0) return null;

  return (
    <nav className="dept-bar" aria-label="Departamentos">
      <div className="dept-inner">
        <span className="dept-label">Departamentos</span>

        {departments.map((dept) => (
          <div
            key={dept.id}
            className="dept-slot"
            onMouseEnter={() => setOpen(dept.id)}
            onMouseLeave={() => setOpen(null)}
          >
            <button
              type="button"
              className={`dept-btn ${open === dept.id ? "is-open" : ""}`}
              aria-expanded={open === dept.id}
              onClick={() => setOpen(open === dept.id ? null : dept.id)}
            >
              {dept.name}
            </button>

            {open === dept.id && (
              <div className="mega-panel" role="menu" aria-label={dept.name}>
                <div className="mega-grid">
                  <div className="mega-cols">
                    {dept.children.map((child) => (
                      <div key={child.id} className="mega-col">
                        <Link
                          href={`/departamento/${child.slug}`}
                          className="mega-group-title"
                          role="menuitem"
                        >
                          {child.name}
                        </Link>
                        <ul className="mega-links">
                          {child.children.map((grand) => (
                            <li key={grand.id}>
                              <Link href={`/catalogo?categoria=${grand.slug}`} role="menuitem">
                                <span>
                                  {grand.name}
                                  {grand.ageRestricted && <span className="age18">18+</span>}
                                </span>
                                <ChevronRight size={13} />
                              </Link>
                            </li>
                          ))}
                          {child.children.length === 0 && (
                            <li>
                              <Link href={`/departamento/${child.slug}`} role="menuitem">
                                <span>Ver todos</span>
                                <ChevronRight size={13} />
                              </Link>
                            </li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <aside className="mega-highlight">
                    {dept.imageUrl ? (
                      <div className="mega-highlight__media">
                        <Image
                          src={dept.imageUrl}
                          alt={dept.name}
                          fill
                          sizes="320px"
                          className="mega-highlight__img"
                        />
                      </div>
                    ) : null}
                    <div className="mega-highlight__body">
                      <span className="mega-title">Departamento</span>
                      <h4>{dept.name}</h4>
                      {dept.description && <p>{dept.description}</p>}
                      <Link href={`/departamento/${dept.slug}`} className="mega-all">
                        Ver {dept.name}
                        <ArrowRight size={14} />
                      </Link>
                    </div>
                  </aside>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Navegação por departamento no mobile */}
      <div className="dept-mobile">
        {departments.map((dept) => {
          const expanded = mobileOpen === dept.id;
          return (
            <div key={dept.id} className="dept-mobile__row">
              <Link href={`/departamento/${dept.slug}`} className="dept-mobile__link">
                {dept.name}
              </Link>
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`Abrir ${dept.name}`}
                onClick={() => setMobileOpen(expanded ? null : dept.id)}
                className="dept-mobile__toggle"
              >
                <ChevronRight size={16} className={expanded ? "rotate-90" : ""} />
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export function MegaMenuLoader() {
  const [departments, setDepartments] = useState<StoreDepartment[]>([]);
  useEffect(() => {
    fetch(`${API_URL}/api/store/home`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && Array.isArray(json.departments)) {
          setDepartments(json.departments as StoreDepartment[]);
        }
      })
      .catch(() => setDepartments([]));
  }, []);
  return <MegaMenu departments={departments} />;
}
