"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL, adminFetch } from "../../lib/api";

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
  const [unauth, setUnauth] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/products`, {
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as { items?: Product[]; error?: { message?: string } };
      if (res.status === 401) {
        setUnauth(true);
        setItems([]);
        return;
      }
      if (!res.ok) {
        setError(json.error?.message ?? "Falha ao carregar produtos.");
        return;
      }
      setItems(json.items ?? []);
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(id: string, field: "published" | "featured", value: boolean) {
    await adminFetch(`/api/admin/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ [field]: !value }),
    });
    load();
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

  if (unauth) {
    return (
      <main className="px-6 py-24 text-center">
        <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6">
          401
        </div>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-6">
          Sessão expirada
        </h1>
        <p className="text-[#666] font-mono text-xs mb-10 max-w-md mx-auto">
          Entre no painel para gerenciar produtos.
        </p>
        <a href="/login" className="btn-primary px-8 py-3">
          IR PARA O LOGIN
        </a>
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
      <header className="mb-12 border-b border-[#111] pb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
            Produtos
          </h1>
          <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
            CRUD real · {items.length} produto(s)
          </p>
        </div>
        <Link href="/products/new" className="btn-primary px-8 py-3">
          NOVO PRODUTO
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
          <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6 inline-block">
            0
          </div>
          <h2 className="font-display font-black text-3xl uppercase leading-none tracking-tighter text-white mb-4">
            Nenhum produto ainda
          </h2>
          <p className="text-[#666] font-mono text-xs max-w-md mx-auto mb-8">
            Cadastre o primeiro produto para a vitrine não ficar vazia.
          </p>
          <Link href="/products/new" className="btn-primary px-8 py-3">
            CADASTRAR PRODUTO
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table>
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
                      <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] block mt-1">{p.slug}</span>
                    </td>
                    <td className="font-mono text-sm font-bold text-white">{price}</td>
                    <td>
                      <span className={`font-mono text-[0.6rem] uppercase font-bold ${p.published ? "text-[#8bcf16]" : "text-[#666]"}`}>
                        {p.published ? "Publicado" : "Rascunho"}{p.featured ? " · Destaque" : ""}
                      </span>
                    </td>
                    <td>
                      <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${p.ageRestricted ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#333] text-[#333]"}`}>
                        {p.ageRestricted ? "Sim" : "Não"}
                      </span>
                    </td>
                    <td className="flex gap-3">
                      <button
                        type="button"
                        className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] transition-colors"
                        onClick={() => toggle(p.id, "published", p.published)}
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
