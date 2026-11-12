"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { adminJson, adminFetch, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";
import { useToast, useConfirm } from "@/components/ui";
import { Field, Input, Select } from "@/components/ui";
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Eye,
  Copy,
  Trash2,
  Check,
  X,
  MoreHorizontal,
  Download,
  Upload,
  Plus,
} from "lucide-react";

export const dynamic = "force-dynamic";

type Variant = { id: string; sku: string; priceCents: number };
type Product = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  featured: boolean;
  ageRestricted: boolean;
  condicao: string;
  variants: Variant[];
  categoryId?: string;
  brandId?: string;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const CONDICAO_LABELS: Record<string, string> = { novo: "Novo", usado: "Usado", seminovo: "Seminovo" };
const STATUS_OPTIONS = ["todos", "publicado", "rascunho", "destaque", "sem_foto", "estoque_baixo", "condicao_usado", "condicao_seminovo"] as const;

export default function ProductsPage() {
  const { showToast } = useToast();
  const { open, title, message, onConfirm, close, variant, confirmLabel, cancelLabel, loading: confirmLoading } = useConfirm();

  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_OPTIONS[number]>("todos");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [condicaoFilter, setCondicaoFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  useGateRedirect(failure);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (search) params.set("q", search);
      if (statusFilter !== "todos") params.set("status", statusFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (brandFilter) params.set("brand", brandFilter);
      if (condicaoFilter) params.set("condicao", condicaoFilter);

      const [json, cats, brs] = await Promise.all([
        adminJson<{ items: Product[]; total: number }>(`/api/admin/products?${params}`),
        adminJson<{ id: string; name: string }[]>(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/store/categories`).catch(() => []),
        adminJson<{ id: string; name: string }[]>(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/store/brands`).catch(() => []),
      ]);
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
      setCategories(Array.isArray(cats) ? cats : []);
      setBrands(Array.isArray(brs) ? brs : []);
      setSelectedIds([]);
      setSelectAll(false);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar produtos."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [page, pageSize, search, statusFilter, categoryFilter, brandFilter, condicaoFilter]);

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedIds([]);
      setSelectAll(false);
    } else {
      setSelectedIds(items.map((p) => p.id));
      setSelectAll(true);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Bulk actions
  async function bulkAction(action: "publish" | "unpublish" | "delete") {
    if (selectedIds.length === 0) return;
    const label = action === "publish" ? "publicar" : action === "unpublish" ? "despublicar" : "excluir";
    const confirm = await new Promise<boolean>((resolve) => {
      // Using useConfirm would be better but inline for simplicity
      resolve(window.confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} ${selectedIds.length} produto(s)?`));
    });
    if (!confirm) return;

    setError("");
    try {
      for (const id of selectedIds) {
        if (action === "delete") {
          await adminFetch(`/api/admin/products/${id}`, { method: "DELETE" });
        } else {
          await adminFetch(`/api/admin/products/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ published: action === "publish" }),
          });
        }
      }
      showToast({ type: "success", title: `${label.charAt(0).toUpperCase() + label.slice(1)} concluído` });
      load();
    } catch (e) {
      showToast({ type: "error", title: "Erro", message: messageOf(e, "Falha na ação em massa") });
    }
  }

  async function togglePublished(id: string, current: boolean) {
    setError("");
    try {
      await adminFetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ published: !current }),
      });
      showToast({ type: "success", title: current ? "Despublicado" : "Publicado" });
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao atualizar."));
    }
  }

  async function duplicateProduct(id: string) {
    if (!confirm("Duplicar este produto?")) return;
    try {
      const detail = await adminJson<any>(`/api/admin/products/${id}`);
      const p = detail.product;
      const v = detail.variants || [];
      const createRes = await adminFetch("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name: `${p.name} (cópia)`,
          slug: `${p.slug}-copia-${Date.now()}`,
          description: p.description,
          shortDescription: p.shortDescription ?? "",
          categoryId: p.categoryId,
          brandId: p.brandId ?? null,
          ageRestricted: p.ageRestricted,
          featured: false,
          published: false,
          condicao: p.condicao,
          estadoConservacao: p.estadoConservacao,
          acessoriosIncluidos: p.acessoriosIncluidos,
          garantiaDias: p.garantiaDias,
          tags: p.tags,
          seoTitle: p.seoTitle,
          seoDescription: p.seoDescription,
          technical: p.technical ?? {},
          videos: p.videos ?? [],
          variants: v.map((variant: any) => ({
            sku: `${variant.sku}-COPY-${Date.now()}`,
            name: variant.name,
            priceCents: variant.priceCents,
            promoPriceCents: variant.promoPriceCents,
            weightGrams: variant.weightGrams,
            active: variant.active,
            stockPhysical: variant.inventory?.physical ?? 0,
            stockMin: variant.inventory?.minQuantity ?? 0,
          })),
        }),
      });
      const created = await createRes.json();
      showToast({ type: "success", title: "Produto duplicado" });
      load();
      // Navigate to edit
      window.location.href = `/products/${created.product?.id}`;
    } catch (e) {
      showToast({ type: "error", title: "Erro", message: messageOf(e, "Falha ao duplicar") });
    }
  }

  function formatCondicao(c: string) {
    return CONDICAO_LABELS[c] ?? c;
  }

  function getStatusBadge(p: Product) {
    if (p.published && p.featured) return <span className="admin-badge admin-badge--ok">Publicado · Destaque</span>;
    if (p.published) return <span className="admin-badge admin-badge--ok">Publicado</span>;
    return <span className="admin-badge admin-badge--warn">Rascunho</span>;
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <div className="admin-section-head">
          <div>
            <span className="admin-section-head__kicker">Catálogo</span>
            <h1 className="admin-section-head__title">Produtos</h1>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4">
          <div className="skel skel-title" />
          <div className="skel skel-card" />
          <div className="skel skel-card" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="px-6 py-24 text-center">
        <p role="alert" className="text-[#dc2626] font-mono text-xs mb-4">{error}</p>
        <button className="btn-primary px-8 py-3" onClick={load}>Tentar novamente</button>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <div className="admin-section-head flex-wrap">
        <div>
          <span className="admin-section-head__kicker">Catálogo</span>
          <h1 className="admin-section-head__title">Produtos</h1>
          <p className="admin-section-head__subtitle">{total} produto(s) no sistema</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/products/new" className="btn-primary px-6 py-2.5">
            <Plus size={16} strokeWidth={2} /> NOVO PRODUTO
          </Link>
        </div>
      </div>

      {/* Filters */}
      <section className="admin-form mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <Field style={{ minWidth: 280, flex: 1 }} label="Busca">
            <div className="relative">
              <Search size={16} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
              <Input
                value={search}
                onChange={(v) => { setSearch(v); setPage(1); }}
                placeholder="Nome, SKU, slug..."
                className="pl-10"
              />
            </div>
          </Field>
          <Field label="Status">
            <Select
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v as typeof STATUS_OPTIONS[number]); setPage(1); }}
              options={[
                { value: "todos", label: "Todos" },
                { value: "publicado", label: "Publicados" },
                { value: "rascunho", label: "Rascunhos" },
                { value: "destaque", label: "Destaque" },
                { value: "sem_foto", label: "Sem foto" },
                { value: "estoque_baixo", label: "Estoque baixo" },
                { value: "condicao_usado", label: "Condição: Usado" },
                { value: "condicao_seminovo", label: "Condição: Seminovo" },
              ]}
            />
          </Field>
          <Field label="Categoria">
            <Select
              value={categoryFilter}
              onChange={(v) => { setCategoryFilter(v); setPage(1); }}
              options={[{ value: "", label: "Todas" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              placeholder="Todas"
            />
          </Field>
          <Field label="Marca">
            <Select
              value={brandFilter}
              onChange={(v) => { setBrandFilter(v); setPage(1); }}
              options={[{ value: "", label: "Todas" }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
              placeholder="Todas"
            />
          </Field>
          <Field label="Condição">
            <Select
              value={condicaoFilter}
              onChange={(v) => { setCondicaoFilter(v); setPage(1); }}
              options={[
                { value: "", label: "Todas" },
                { value: "novo", label: "Novo" },
                { value: "usado", label: "Usado" },
                { value: "seminovo", label: "Seminovo" },
              ]}
              placeholder="Todas"
            />
          </Field>
          <Field label="Por página">
            <Select
              value={String(pageSize)}
              onChange={(v) => { setPageSize(Number(v)); setPage(1); }}
              options={["10", "20", "50", "100"].map((n) => ({ value: n, label: n }))}
            />
          </Field>
        </div>
      </section>

      {/* Bulk actions bar */}
      {selectedIds.length > 0 && (
        <div className="admin-notice admin-notice--warn mb-4 flex items-center justify-between">
          <span className="font-mono text-xs">{selectedIds.length} selecionado(s)</span>
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm px-3 py-1.5" onClick={() => bulkAction("publish")}>Publicar</button>
            <button className="btn-secondary btn-sm px-3 py-1.5" onClick={() => bulkAction("unpublish")}>Despublicar</button>
            <button className="btn-secondary btn-sm px-3 py-1.5 text-[#dc2626] border-[#dc2626] hover:bg-[#dc2626]/10" onClick={() => bulkAction("delete")}>Excluir</button>
            <button className="btn-secondary btn-sm px-3 py-1.5" onClick={() => { setSelectedIds([]); setSelectAll(false); }}>Limpar</button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty__num">0</div>
          <h2 className="admin-empty__title">Nenhum produto encontrado</h2>
          <p className="admin-empty__text">Ajuste os filtros ou cadastre o primeiro produto.</p>
          <Link href="/products/new" className="btn-primary px-8 py-3">CADASTRAR PRODUTO</Link>
        </div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: "40px" }}>
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={toggleSelectAll}
                      className="checkbox"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Categoria</th>
                  <th>Condição</th>
                  <th>Preço</th>
                  <th>Estoque</th>
                  <th>Status</th>
                  <th style={{ width: "180px" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const price = p.variants[0] ? brl(p.variants[0].priceCents) : "—";
                  const stock = p.variants[0] ? p.variants[0].sku : "—";
                  const cat = categories.find((c) => c.id === p.categoryId);
                  return (
                    <tr key={p.id} className="group">
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          className="checkbox"
                        />
                      </td>
                      <td>
                        <div className="font-display font-black text-lg text-white">{p.name}</div>
                        <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mt-1">{p.slug}</span>
                      </td>
                      <td className="font-mono text-sm font-bold text-white">{p.variants[0]?.sku ?? "—"}</td>
                      <td>{cat?.name ?? "—"}</td>
                      <td>
                        <span className={`admin-badge ${p.condicao === "usado" ? "admin-badge--warn" : p.condicao === "seminovo" ? "admin-badge admin-badge--warn" : "admin-badge--ok"}`}>
                          {formatCondicao(p.condicao)}
                        </span>
                      </td>
                      <td className="font-bold text-white">{price}</td>
                      <td className="font-mono text-sm text-white">{stock}</td>
                      <td>{getStatusBadge(p)}</td>
                      <td className="flex flex-wrap gap-1">
                        <Link href={`/products/${p.id}`} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-2 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] transition-colors" title="Editar">
                          Editar
                        </Link>
                        <button
                          type="button"
                          className="font-mono text-[0.6rem] uppercase font-bold py-1 px-2 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] transition-colors"
                          onClick={() => togglePublished(p.id, p.published)}
                          title={p.published ? "Despublicar" : "Publicar"}
                        >
                          {p.published ? "Despublicar" : "Publicar"}
                        </button>
                        <button
                          type="button"
                          className="font-mono text-[0.6rem] uppercase font-bold py-1 px-2 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] transition-colors"
                          onClick={() => duplicateProduct(p.id)}
                          title="Duplicar"
                        >
                          <Copy size={10} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          className="font-mono text-[0.6rem] uppercase font-bold py-1 px-2 border border-[#dc2626]/40 text-[#dc2626] hover:border-[#dc2626] hover:bg-[#dc2626]/10"
                          onClick={() => {
                            if (confirm("Excluir este produto?")) bulkAction("delete");
                          }}
                          title="Excluir"
                        >
                          <Trash2 size={10} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-2 mt-6" aria-label="Paginação">
              <button
                className="btn-secondary btn-sm px-3 py-1.5"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Página anterior"
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
              <span className="font-mono text-sm text-white px-2">
                Página {page} de {totalPages}
              </span>
              <button
                className="btn-secondary btn-sm px-3 py-1.5"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Próxima página"
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </nav>
          )}
        </>
      )}
    </main>
  );
}