// language: TSX, file: apps/store/src/app/components/DeptStrip.tsx, target: Next.js App Router
// Barra fixa de navegação: rótulo à esquerda e itens distribuídos em uma única
// linha, de ponta a ponta — departamentos, conteúdo (guias/blog) e o CTA final.
import Link from "next/link";

const departments = [
  { label: "Airsoft", href: "/departamento/airsoft" },
  { label: "Tiro Esportivo", href: "/departamento/tiro-esportivo" },
  { label: "Upgrades", href: "/departamento/upgrades" },
  { label: "Loadout", href: "/departamento/loadout" },
  { label: "Life Style", href: "/departamento/life-style" },
  { label: "Aventura", href: "/departamento/aventura" },
];

const content = [
  { label: "Guias", href: "/guia" },
  { label: "Blog", href: "/blog" },
];

export function DeptStrip() {
  return (
    <nav className="dept-strip" aria-label="Navegação por departamento">
      <span className="dept-strip__label">Departamentos</span>
      {departments.map((d) => (
        <Link key={d.href} href={d.href} className="dept-strip__item">
          {d.label}
          <span className="dept-strip__arrow" aria-hidden>→</span>
        </Link>
      ))}
      {content.map((c) => (
        <Link key={c.href} href={c.href} className="dept-strip__item dept-strip__item--content">
          {c.label}
          <span className="dept-strip__arrow" aria-hidden>→</span>
        </Link>
      ))}
      <Link href="/catalogo" className="dept-strip__item dept-strip__item--all">
        Todos os produtos
        <span className="dept-strip__arrow" aria-hidden>→</span>
      </Link>
    </nav>
  );
}
