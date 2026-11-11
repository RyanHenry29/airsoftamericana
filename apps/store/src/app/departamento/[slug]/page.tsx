// language: TSX, file: apps/store/src/app/departamento/[slug]/page.tsx, target: Next.js App Router
// Página de departamento: hero com foto, subcategorias e grade de produtos do departamento.
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { Header } from "../../components/Header";
import { ProductCard } from "../../components/ProductCard";
import { SiteFooter } from "../../components/SiteFooter";
import {
  API_URL,
  storeGet,
  type CommercialSettings,
  type StoreHome,
  type StoreProduct,
} from "../../lib/store";
import { OG_IMAGE } from "../../lib/seo";

export const dynamic = "force-dynamic";

type Department = {
  id: string;
  name: string;
  slug: string;
  description: string;
  imageUrl: string | null;
  ageRestricted: boolean;
  parent: { id: string; name: string; slug: string; imageUrl: string | null } | null;
  children: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    ageRestricted: boolean;
    productCount: number;
  }[];
  products: StoreProduct[];
  total: number;
};

const EMPTY_SETTINGS: CommercialSettings = {
  pix_discount_percent: 0,
  installments: 1,
  installment_interest_free: false,
  min_installment_cents: 0,
  free_shipping_from_cents: 0,
  shipping_carriers: [],
  whatsapp: "",
  email: "",
  address: { street: "", district: "", city: "", state: "", zip: "" },
  service_hours: "",
  social: { instagram: "", whatsapp: "" },
  announcement: "",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dept = await storeGet<Department | null>(
    `${API_URL}/api/store/departments/${encodeURIComponent(slug)}`,
    null,
  );
  if (!dept) return { title: "Departamento não encontrado" };
  const description =
    dept.description || `${dept.name} na Airsoft Americana — ${dept.total} produtos com frete para todo o Brasil.`;
  // Termos derivados do nome real, sem repetição ("Airsoft airsoft") —
  // dedupe case-insensitive no fim.
  const rawKeywords = [
    dept.name,
    `${dept.name} réplicas`,
    ...(dept.parent?.name ? [dept.parent.name] : []),
    ...(dept.name.toLowerCase().includes("airsoft") ? [] : [`${dept.name} airsoft`, "airsoft"]),
    "equipamento tático",
  ];
  return {
    title: dept.name,
    description,
    keywords: rawKeywords.filter((k, i) => rawKeywords.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i),
    alternates: { canonical: `/departamento/${dept.slug}` },
    openGraph: {
      type: "website",
      title: `${dept.name} | Airsoft Americana`,
      description,
      url: `/departamento/${dept.slug}`,
      // Override de openGraph precisa reapontar a arte da convenção opengraph-image.
      images: [OG_IMAGE],
    },
  };
}

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [dept, home] = await Promise.all([
    storeGet<Department | null>(
      `${API_URL}/api/store/departments/${encodeURIComponent(slug)}`,
      null,
    ),
    storeGet<StoreHome>(`${API_URL}/api/store/home`, {
      banners: [],
      sections: [],
      departments: [],
      brands: [],
      featured: [],
      news: [],
      sale: [],
      bestsellers: [],
      settings: EMPTY_SETTINGS,
      totals: { products: 0 },
    }),
  ]);

  if (!dept) {
    return (
      <main className="page-shell">
        <Header departments={home.departments} />
        <div className="notfound">
          <p className="notfound__num">404</p>
          <h1>Departamento não encontrado</h1>
          <Link href="/catalogo" className="btn-primary">
            Ver catálogo
          </Link>
        </div>
        <SiteFooter settings={home.settings} />
      </main>
    );
  }

  const settings = home.settings;

  return (
    <main className="page-shell">
      <Header departments={home.departments} />

      <nav className="crumbs" aria-label="Trilha de navegação">
        <Link href="/">Início</Link>
        <ChevronRight size={12} />
        <Link href="/catalogo">Catálogo</Link>
        {dept.parent && (
          <>
            <ChevronRight size={12} />
            <Link href={`/departamento/${dept.parent.slug}`}>{dept.parent.name}</Link>
          </>
        )}
        <ChevronRight size={12} />
        <span>{dept.name}</span>
      </nav>

      <section className="dept-hero">
        {dept.imageUrl && (
          <Image
            src={dept.imageUrl}
            alt={dept.name}
            fill
            priority
            sizes="100vw"
            className="dept-hero__img"
          />
        )}
        <div className="dept-hero__scrim" />
        <div className="dept-hero__body">
          <h1 className="dept-hero__title">{dept.name}</h1>
          <p className="dept-hero__count">{dept.total} produtos neste departamento</p>
          {dept.description && <p className="dept-hero__desc">{dept.description}</p>}
        </div>
      </section>

      {dept.children.length > 0 && (
        <section className="block">
          <div className="sec-head">
            <div>
              <span className="sec-kicker">Navegue por</span>
              <h2 className="sec-title">Categorias de {dept.name}</h2>
            </div>
          </div>
          <ul className="cat-chips">
            {dept.children.map((cat) => (
              <li key={cat.id}>
                <Link href={`/catalogo?categoria=${cat.slug}`} className="cat-chip">
                  {cat.name}
                  <span>{cat.productCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dept.products.length > 0 && (
        <section className="block">
          <div className="sec-head">
            <div>
              <span className="sec-kicker">Vitrine</span>
              <h2 className="sec-title">Destaques em {dept.name}</h2>
            </div>
            <Link href={`/catalogo?categoria=${dept.slug}`} className="sec-link">
              Ver tudo <ChevronRight size={14} />
            </Link>
          </div>
          <ul className="product-grid">
            {dept.products.map((product) => (
              <ProductCard key={product.id} product={product} settings={settings} />
            ))}
          </ul>
        </section>
      )}

      <SiteFooter settings={settings} />
    </main>
  );
}
