"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  active: boolean;
  ageRestricted: boolean;
  position: number;
  children?: CategoryNode[];
};

type FlatCategory = CategoryNode & { depth: number };

function flatten(nodes: CategoryNode[], depth = 0): FlatCategory[] {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flatten(node.children ?? [], depth + 1),
  ]);
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CategoriesPage() {
  const [items, setItems] = useState<FlatCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", parentId: "", ageRestricted: false });
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await adminJson<{ items?: CategoryNode[] }>(
        "/api/admin/categories",
      );
      setItems(flatten(payload.items ?? []));
      setFailure(null);
      setError("");
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar categorias."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const parents = useMemo(() => items.filter((c) => c.depth === 0), [items]);

  async function patch(id: string, body: Record<string, unknown>) {
    setError("");
    setNotice("");
    try {
      await adminJson(`/api/admin/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao atualizar a categoria."));
    }
  }

  async function remove(c: FlatCategory) {
    if (!confirm(`Excluir a categoria "${c.name}"? A exclusao e bloqueada se houver subcategorias ou produtos vinculados.`)) return;
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/categories/${c.id}`, { method: "DELETE" });
      setNotice("Categoria excluida.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao excluir categoria."));
    } finally { setBusy(false); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await adminJson("/api/admin/categories", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          slug: (form.slug.trim() || slugify(form.name)).trim(),
          parentId: form.parentId || null,
          ageRestricted: form.ageRestricted,
          active: true,
          position: 0,
        }),
      });
      setForm({ name: "", slug: "", parentId: "", ageRestricted: false });
      setNotice("Categoria criada.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao criar a categoria."));
    } finally {
      setBusy(false);
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

  return (
    <main className="px-6 pb-24">
      <div className="admin-section-head">
        <div>
          <span className="admin-section-head__kicker">Catálogo</span>
          <h1 className="admin-section-head__title">Gestão de Categorias</h1>
          <p className="admin-section-head__subtitle">Árvore do catálogo · restrição de idade 18+ · {items.length} categoria(s)</p>
        </div>
      </div>

      {error ? (
        <p className="admin-notice admin-notice--err" role="alert">{error}</p>
      ) : null}
      {notice ? (
        <p className="admin-notice admin-notice--ok">{notice}</p>
      ) : null}

      <form
        onSubmit={create}
        className="admin-form grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-12"
      >
        <div className="field">
          <label htmlFor="cat-name">Nome</label>
          <input
            id="cat-name"
            className="input w-full"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="cat-slug">Slug</label>
          <input
            id="cat-slug"
            className="input w-full"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="gerado pelo nome"
          />
        </div>
        <div className="field">
          <label htmlFor="cat-parent">Departamento</label>
          <select
            id="cat-parent"
            className="select w-full"
            value={form.parentId}
            onChange={(e) => setForm({ ...form, parentId: e.target.value })}
          >
            <option value="">— raiz —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-4">
          <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.ageRestricted}
              onChange={(e) =>
                setForm({ ...form, ageRestricted: e.target.checked })
              }
            />
            18+
          </label>
          <button type="submit" className="btn-primary py-3" disabled={busy}>
            {busy ? "Criando..." : "Criar"}
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty__num">0</div>
          <h2 className="admin-empty__title">Nenhuma categoria ainda</h2>
          <p className="admin-empty__text">As categorias aparecem aqui quando o seed é executado no banco.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Slug</th>
                <th>18+</th>
                <th>Ativo</th>
                <th>Posição</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span
                      className="font-mono text-sm font-bold text-white"
                      style={{ paddingLeft: `${c.depth * 16}px` }}
                    >
                      {c.depth > 0 ? "↳ " : ""}
                      {c.name}
                    </span>
                  </td>
                  <td className="font-mono text-sm text-[#666]">{c.slug}</td>
                  <td>
                    <span className={`admin-badge ${c.ageRestricted ? "admin-badge--warn" : "admin-badge--ok"}`}>
                      {c.ageRestricted ? "Sim" : "Não"}
                    </span>
                  </td>
                  <td>
                    <span className={`admin-badge ${c.active ? "admin-badge--ok" : "admin-badge--err"}`}>
                      {c.active ? "Sim" : "Não"}
                    </span>
                  </td>
                  <td className="font-mono text-sm text-[#666]">{c.position}</td>
                  <td className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333]">{c.depth === 0 ? "departamento" : "subcategoria"}</span>
                    <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-2 border border-[#dc2626]/40 text-[#dc2626]" onClick={() => remove(c)} disabled={busy}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
