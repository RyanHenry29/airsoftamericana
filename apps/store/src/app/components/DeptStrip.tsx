// language: TSX, file: apps/store/src/app/components/DeptStrip.tsx, target: Next.js App Router
// Barra horizontal de departamentos (estilo Image 3): pills com seta e
// "Todos os Produtos" no final. Navegação rápida entre departamentos.
import Link from "next/link";

const departments = [
  { label: "AIRSOFT", href: "/departamento/airsoft" },
  { label: "TIRO ESPORTIVO", href: "/departamento/tiro-esportivo" },
  { label: "UPGRADES", href: "/departamento/upgrades" },
  { label: "LOADOUT", href: "/departamento/loadout" },
  { label: "LIFE STYLE", href: "/departamento/life-style" },
  { label: "AVENTURA", href: "/departamento/aventura" },
];

export function DeptStrip() {
  return (
    <nav className="dept-strip" aria-label="Departamentos rápidos">
      {departments.map((d) => (
        <Link key={d.href} href={d.href} className="dept-strip__item">
          {d.label}
          <span className="dept-strip__arrow">→</span>
        </Link>
      ))}
      <Link href="/catalogo" className="dept-strip__item dept-strip__item--all">
        TODOS OS PRODUTOS
        <span className="dept-strip__arrow">→</span>
      </Link>
    </nav>
  );
}
