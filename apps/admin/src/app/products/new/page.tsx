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
  const [meRole, setMeRole] = useState<string|null>(null);
  const [data, setData] = useState({
    name: "",
    slug: "",
    sku: "",
    categoryId: "",
    brandId: "",
    price: "",
    promo: "",
    stock: "10",
    min: "3",
    published: true,
    featured: false,
    ageRestricted: false,
    description: "",
    condicao: "novo",
    estadoConservacao: "",
    acessoriosIncluidos: "",
    garantiaDias: "30",
    tags: "",
    seoTitle: "",
    seoDescription: "",
    costCents: "",
  });
  const canCost = meRole!=null && ["superadmin","gerente","financeiro"].includes(meRole);

  useEffect(() => {
    async function load() {
      fetch(`${API_URL}/api/admin/me`, { credentials: "include" }).then(r=>r.json()).then(j=>setMeRole(j?.user?.role??null)).catch(()=>{});
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
    if ((data.condicao==="usado"||data.condicao==="seminovo") && !data.estadoConservacao.trim()) { setError("Produtos usados/seminovos exigem estado de conservação."); return; }
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
          condicao: data.condicao,
          estadoConservacao: data.estadoConservacao,
          acessoriosIncluidos: data.acessoriosIncluidos,
          garantiaDias: Number(data.garantiaDias)||0,
          tags: data.tags,
          seoTitle: data.seoTitle,
          seoDescription: data.seoDescription,
          ...(canCost && data.costCents!=="" ? { costCents: Math.round(Number(data.costCents)) } : {}),
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
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="field"><label htmlFor="condicao">Condição</label><select id="condicao" className="select" value={data.condicao} onChange={e=>setData({...data,condicao:e.target.value})}><option value="novo">Novo</option><option value="usado">Usado</option><option value="seminovo">Seminovo</option></select></div>
          <div className="field"><label htmlFor="conserv">Conservação {(data.condicao!=="novo") && <span className="text-[#dc2626]">*</span>}</label><input id="conserv" className="input" value={data.estadoConservacao} onChange={e=>setData({...data,estadoConservacao:e.target.value})} aria-required={data.condicao!=="novo"} /></div>
          <div className="field"><label htmlFor="garantia">Garantia (dias)</label><input id="garantia" className="input" type="number" min={0} value={data.garantiaDias} onChange={e=>setData({...data,garantiaDias:e.target.value})} /></div>
        </div>
        <div className="field"><label htmlFor="acess">Acess?rios inclu?dos</label><input id="acess" className="input" value={data.acessoriosIncluidos} onChange={e=>setData({...data,acessoriosIncluidos:e.target.value})} /></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field"><label htmlFor="tags">Tags (v?rgula)</label><input id="tags" className="input" value={data.tags} onChange={e=>setData({...data,tags:e.target.value})} /></div>
          {canCost ? <div className="field"><label htmlFor="cost">Custo interno (R$)</label><input id="cost" className="input" inputMode="decimal" value={data.costCents} onChange={e=>setData({...data,costCents:e.target.value})} /><p className="font-mono text-[0.6rem] text-[#666] mt-1">Apenas pap?is autorizados; nunca p?blico.</p></div> : <p className="font-mono text-[0.6rem] text-[#666] self-end">Custo interno oculto (papel sem permiss?o).</p>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field"><label htmlFor="seot">SEO title</label><input id="seot" className="input" value={data.seoTitle} onChange={e=>setData({...data,seoTitle:e.target.value})} /></div>
          <div className="field"><label htmlFor="seod">SEO description</label><input id="seod" className="input" value={data.seoDescription} onChange={e=>setData({...data,seoDescription:e.target.value})} /></div>
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
