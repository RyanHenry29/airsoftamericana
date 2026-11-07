"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL, adminFetch } from "../../../lib/api";

type Category = { id: string; name: string; slug: string };
type Brand = { id: string; name: string; slug: string };

export default function NewProductPage() {
  const router = useRouter();
  const [cats, setCats] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({
    name: "",
    slug: "",
    categoryId: "",
    brandId: "",
    sku: "",
    price: "",
    promo: "",
    stock: "10",
    min: "3",
    published: true,
    featured: false,
    ageRestricted: false,
    description: "",
  });

  useEffect(() => {
    async function load() {
      const [c, b] = await Promise.all([
        fetch(`${API_URL}/api/store/categories`, { credentials: "include" }).then((r) => r.json().catch(() => [])),
        fetch(`${API_URL}/api/store/brands`, { credentials: "include" }).then((r) => r.json().catch(() => [])),
      ]);
      setCats(Array.isArray(c) ? c : []);
      setBrands(Array.isArray(b) ? b : []);
      if (Array.isArray(c) && c[0]) setData((d) => ({ ...d, categoryId: c[0].id }));
    }
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name: data.name.trim(),
          slug: data.slug.trim() || data.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          description: data.description.trim(),
          categoryId: data.categoryId,
          brandId: data.brandId || undefined,
          ageRestricted: data.ageRestricted,
          featured: data.featured,
          published: data.published,
          variants: [
            {
              sku: data.sku.trim(),
              name: data.name.trim(),
              priceCents: Math.round(Number(data.price) * 100),
              promoPriceCents: data.promo ? Math.round(Number(data.promo) * 100) : null,
              stockPhysical: Number(data.stock) || 0,
              stockMin: Number(data.min) || 0,
              weightGrams: 500,
              active: true,
            },
          ],
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "Falha ao cadastrar produto.");
        return;
      }
      router.push("/products");
      router.refresh();
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-12 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Novo produto
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Variação única com SKU + estoque inicial
        </p>
      </header>

      <form onSubmit={onSubmit} className="border border-[#111] bg-[#0a0a0a] p-8 max-w-2xl grid grid-cols-1 gap-6" noValidate>
        <div className="field">
          <label htmlFor="name">Nome</label>
          <input id="name" className="input" required value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field">
            <label htmlFor="slug">Slug</label>
            <input id="slug" className="input" value={data.slug} onChange={(e) => setData({ ...data, slug: e.target.value })} placeholder="auto se vazio" />
          </div>
          <div className="field">
            <label htmlFor="sku">SKU</label>
            <input id="sku" className="input" required value={data.sku} onChange={(e) => setData({ ...data, sku: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field">
            <label htmlFor="categoryId">Categoria</label>
            <select id="categoryId" className="select" value={data.categoryId} onChange={(e) => setData({ ...data, categoryId: e.target.value })}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="brandId">Marca</label>
            <select id="brandId" className="select" value={data.brandId} onChange={(e) => setData({ ...data, brandId: e.target.value })}>
              <option value="">Sem marca</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field">
            <label htmlFor="price">Preço (R$)</label>
            <input id="price" className="input" inputMode="decimal" required value={data.price} onChange={(e) => setData({ ...data, price: e.target.value })} placeholder="299.90" />
          </div>
          <div className="field">
            <label htmlFor="promo">Promoção (R$, opcional)</label>
            <input id="promo" className="input" inputMode="decimal" value={data.promo} onChange={(e) => setData({ ...data, promo: e.target.value })} placeholder="279.90" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field">
            <label htmlFor="stock">Estoque inicial</label>
            <input id="stock" className="input" inputMode="numeric" value={data.stock} onChange={(e) => setData({ ...data, stock: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="min">Estoque mínimo</label>
            <input id="min" className="input" inputMode="numeric" value={data.min} onChange={(e) => setData({ ...data, min: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-6 text-sm font-bold">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={data.published} onChange={(e) => setData({ ...data, published: e.target.checked })} className="accent-[#8bcf16]" /> Publicado
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={data.featured} onChange={(e) => setData({ ...data, featured: e.target.checked })} className="accent-[#8bcf16]" /> Destaque
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={data.ageRestricted} onChange={(e) => setData({ ...data, ageRestricted: e.target.checked })} className="accent-[#8bcf16]" /> 18+
          </label>
        </div>
        <div className="field">
          <label htmlFor="description">Descrição</label>
          <input id="description" className="input" value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} />
        </div>
        {error && (
          <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-4">{error}</p>
        )}
        <div className="flex gap-4">
          <button type="submit" className="btn-primary px-8 py-3" disabled={busy}>
            {busy ? "Cadastrando..." : "Cadastrar produto"}
          </button>
          <Link href="/products" className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] hover:text-[#8bcf16] transition-colors underline underline-offset-4">
            Cancelar
          </Link>
        </div>
      </form>
    </main>
  );
}
