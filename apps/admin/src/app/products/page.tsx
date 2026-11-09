"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Variant = { id: string; sku: string; priceCents: number };
type Product = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  featured: boolean;
  ageRestricted: boolean;
  variants: Variant[];
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  useGateRedirect(failure);

  async function load() {
    setLoading(true);
    try {
      const json = await adminJson<{ items?: Product[] }>("/api/admin/products");
      setItems(json.items ?? []);
      setFailure(null);
      setError("");
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar produtos."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(id: string, field: "published" | "featured", value: boolean) {
    setError("");
    try {
      await adminJson(`/api/admin/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: !value }),
      });
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao atualizar o produto."));
    }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <div className="grid grid-cols-1 gap-4">
          <div className="h-20 bg-[#0a0a0a] border border-[#111]" />
          <div className="h-20 bg-[#0a0a0a] border border-[#111]" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="px-6 py-24 text-center">
        <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#dc2626] mb-6">
          ERR
        </div>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-6">
          Erro ao carregar
        </h1>
        <p className="text-[#666] font-mono text-xs mb-10 max-w-md mx-auto">{error}</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <div className="admin-section-head">
        <div>
          <span className="admin-section-head__kicker">Catálogo</span>
          <h1 className="admin-section-head__title">Produtos</h1>
          <p className="admin-section-head__subtitle">CRUD real · {items.length} produto(s) no sistema</p>
        </div>
        <Link href="/products/new" className="btn-primary px-8 py-3">
          NOVO PRODUTO
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty__num">0</div>
          <h2 className="admin-empty__title">Nenhum produto ainda</h2>
          <p className="admin-empty__text">Cadastre o primeiro produto para a vitrine não ficar vazia. Use a importação CSV para carregar o catálogo real.</p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <Link href="/products/new" className="btn-primary px-8 py-3">CADASTRAR PRODUTO</Link>
            <Link href="/products/import" className="btn-outline px-8 py-3">IMPORTAR CSV</Link>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>SKU</th>
                <th>Preço</th>
                <th>Status</th>
                <th>18+</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const price = p.variants[0] ? (p.variants[0].priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
                return (
                  <tr key={p.id} className="group">
                    <td>
                      <div className="font-display font-black text-lg text-white">{p.name}</div>
                      <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mt-1">{p.slug}</span>
                    </td>
                    <td className="font-mono text-sm font-bold text-white">{price}</td>
                    <td>
                      <span className={`font-mono text-[0.6rem] uppercase font-bold ${p.published ? "text-[#8bcf16]" : "text-[#666]"}`}>
                        {p.published ? "Publicado" : "Rascunho"}{p.featured ? " · Destaque" : ""}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-badge ${p.ageRestricted ? "admin-badge--warn" : "admin-badge--ok"}`}>
                        {p.ageRestricted ? "Sim" : "Não"}
                      </span>
                    </td>
                    <td className="flex flex-wrap gap-2">
                      <Link href={`/products/${p.id}`} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] transition-colors">Editar</Link>
                      <button
                        type="button"
                        className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] transition-colors"
                        onClick={() => { if (p.published && !confirm("Despublicar este produto?")) return; toggle(p.id, "published", p.published); }}
                      >
                        {p.published ? "Despublicar" : "Publicar"}
                      </button>
                      <button
                        type="button"
                        className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] transition-colors"
                        onClick={() => toggle(p.id, "featured", p.featured)}
                      >
                        {p.featured ? "Sem destaque" : "Destacar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-6 text-[#333] font-mono text-[0.6rem] uppercase tracking-widest">
            Preços via primeiras variantes. Edição completa de SKU/estoque em /products/new.
          </p>
        </div>
      )}
    </main>
  );
}
