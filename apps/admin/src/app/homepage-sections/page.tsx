"use client";

// language: TSX, file: apps/admin/src/app/homepage-sections/page.tsx, target: Next.js App Router
// Seções da homepage (CMS da loja): ordem, ativação e títulos que a home
// renderiza em /api/store/home. Reorder usa POST /reorder com os ids na ordem.
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Section = {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  position: number;
  active: boolean;
  config: Record<string, unknown>;
};

/** kinds que a loja sabe renderizar (apps/store/src/app/page.tsx). */
const KIND_LABELS: Record<string, string> = {
  hero: "Hero (banner principal)",
  benefits: "Faixa de benefícios",
  departments: "Departamentos",
  featured: "Destaques (vitrine)",
  news: "Novidades (vitrine)",
  bestsellers: "Mais vendidos (vitrine)",
  sale: "Promoções (vitrine)",
  brands: "Marcas",
  institutional: "Bloco institucional",
  newsletter: "Newsletter",
};

const LIMIT_KINDS = new Set(["departments", "featured", "news", "bestsellers", "sale", "brands"]);

type FormState = {
  kind: string;
  title: string;
  subtitle: string;
  position: number;
  active: boolean;
  limit: number;
};

const EMPTY_FORM: FormState = {
  kind: "featured",
  title: "",
  subtitle: "",
  position: 0,
  active: true,
  limit: 8,
};

export default function HomepageSectionsPage() {
  const [items, setItems] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await adminJson<{ items?: Section[] }>("/api/admin/homepage-sections");
      setItems(payload.items ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar as seções."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kindOptions = useMemo(() => Object.entries(KIND_LABELS), []);

  function formFrom(s: Section): FormState {
    const limit = Number(s.config?.limit);
    return {
      kind: s.kind,
      title: s.title ?? "",
      subtitle: s.subtitle ?? "",
      position: s.position ?? 0,
      active: !!s.active,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 8,
    };
  }

  function payloadFrom(f: FormState) {
    return {
      kind: f.kind,
      title: f.title.trim(),
      subtitle: f.subtitle.trim(),
      position: Number(f.position) || 0,
      active: f.active,
      config: LIMIT_KINDS.has(f.kind) ? { limit: Number(f.limit) || 8 } : {},
    };
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await adminJson("/api/admin/homepage-sections", {
        method: "POST",
        body: JSON.stringify(payloadFrom(form)),
      });
      setForm(EMPTY_FORM);
      setNotice("Seção criada — ela entra na home na posição indicada.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao criar a seção."));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await adminJson(`/api/admin/homepage-sections/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payloadFrom(form)),
      });
      setEditing(null);
      setNotice("Seção atualizada.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao atualizar a seção."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Section) {
    if (!confirm(`Remover a seção "${s.title || KIND_LABELS[s.kind] || s.kind}" da home?`)) return;
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await adminJson(`/api/admin/homepage-sections/${s.id}`, { method: "DELETE" });
      setNotice("Seção removida.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao remover a seção."));
    } finally {
      setBusy(false);
    }
  }

  /** Sobe uma seção trocando de lugar com a vizinha e regrava a ordem. */
  async function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length || busy) return;
    const ids = items.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await adminJson("/api/admin/homepage-sections/reorder", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao reordenar as seções."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <p className="font-mono text-xs text-[#666]" role="status">Carregando seções…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <div className="admin-section-head">
        <div>
          <span className="admin-section-head__kicker">CMS</span>
          <h1 className="admin-section-head__title">Seções da Homepage</h1>
          <p className="admin-section-head__subtitle">
            A ordem desta lista é a ordem da loja. Desative uma seção e ela some da home;
            mude o título e o texto da loja muda junto.
          </p>
        </div>
      </div>

      {error ? (
        <p className="admin-notice admin-notice--err" role="alert">{error}</p>
      ) : null}
      {notice ? (
        <p className="admin-notice admin-notice--ok">{notice}</p>
      ) : null}

      <form onSubmit={create} className="admin-form grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-12">
        <div className="field">
          <label htmlFor="hs-kind">Tipo da seção</label>
          <select
            id="hs-kind"
            className="select w-full"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            {kindOptions.map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hs-title">Título na loja</label>
          <input
            id="hs-title"
            className="input w-full"
            required
            value={form.title}
            placeholder="ex.: Destaques"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="hs-subtitle">Subtítulo</label>
          <input
            id="hs-subtitle"
            className="input w-full"
            value={form.subtitle}
            placeholder="Linha de apoio (opcional)"
            onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="hs-position">Posição</label>
          <input
            id="hs-position"
            className="input w-full"
            type="number"
            min={0}
            value={form.position}
            onChange={(e) => setForm({ ...form, position: Number(e.target.value) })}
          />
        </div>
        {LIMIT_KINDS.has(form.kind) ? (
          <div className="field">
            <label htmlFor="hs-limit">Itens máximos</label>
            <input
              id="hs-limit"
              className="input w-full"
              type="number"
              min={1}
              max={24}
              value={form.limit}
              onChange={(e) => setForm({ ...form, limit: Number(e.target.value) })}
            />
          </div>
        ) : null}
        <div className="field flex items-end">
          <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Ativa
          </label>
        </div>
        <div className="md:col-span-4 flex items-end">
          <button type="submit" className="btn-primary px-6 py-2" disabled={busy}>
            {busy ? "Salvando…" : "Criar seção"}
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="admin-empty">
          <p className="text-[#666] font-mono text-xs">
            Nenhuma seção cadastrada — a home usa o layout padrão até você criar a primeira.
          </p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ordem</th>
                <th>Título</th>
                <th>Tipo</th>
                <th>Posição</th>
                <th>Ativa</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s, index) => {
                const isEditing = editing === s.id;
                return (
                  <tr key={s.id}>
                    <td className="p-3 whitespace-nowrap">
                      <button
                        type="button"
                        className="font-mono text-xs border border-[#111] px-2 py-1 mr-1 disabled:opacity-40"
                        onClick={() => move(index, -1)}
                        disabled={busy || index === 0}
                        aria-label={`Mover ${s.title} para cima`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="font-mono text-xs border border-[#111] px-2 py-1 disabled:opacity-40"
                        onClick={() => move(index, 1)}
                        disabled={busy || index === items.length - 1}
                        aria-label={`Mover ${s.title} para baixo`}
                      >
                        ↓
                      </button>
                    </td>
                    <td className="p-3">
                      {isEditing ? (
                        <>
                          <input
                            className="input"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                          />
                          <input
                            className="input mt-1"
                            value={form.subtitle}
                            placeholder="Subtítulo"
                            onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                          />
                        </>
                      ) : (
                        <>
                          <div className="font-mono text-sm font-bold text-white">
                            {s.title || KIND_LABELS[s.kind] || s.kind}
                          </div>
                          {s.subtitle ? (
                            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] mt-1 block">
                              {s.subtitle}
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs text-[#666]">
                      {isEditing ? (
                        <select
                          className="select"
                          value={form.kind}
                          onChange={(e) => setForm({ ...form, kind: e.target.value })}
                        >
                          {kindOptions.map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      ) : (
                        KIND_LABELS[s.kind] ?? s.kind
                      )}
                    </td>
                    <td className="p-3 font-mono text-sm text-[#666]">
                      {isEditing ? (
                        <input
                          className="input"
                          type="number"
                          min={0}
                          value={form.position}
                          onChange={(e) => setForm({ ...form, position: Number(e.target.value) })}
                        />
                      ) : (
                        s.position ?? 0
                      )}
                    </td>
                    <td className="p-3">
                      {isEditing ? (
                        <label className="font-mono text-xs">
                          <input
                            type="checkbox"
                            checked={form.active}
                            onChange={(e) => setForm({ ...form, active: e.target.checked })}
                          />{" "}
                          ativa
                        </label>
                      ) : (
                        <span className={`admin-badge ${s.active ? "admin-badge--ok" : "admin-badge--err"}`}>
                          {s.active ? "Sim" : "Não"}
                        </span>
                      )}
                    </td>
                    <td className="p-3 flex flex-wrap gap-2 items-center">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="btn-primary px-3 py-1 text-xs"
                            onClick={() => saveEdit(s.id)}
                            disabled={busy}
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            className="font-mono text-xs underline text-[#666]"
                            onClick={() => setEditing(null)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666]"
                            onClick={() => {
                              setEditing(s.id);
                              setForm(formFrom(s));
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#dc2626]/40 text-[#dc2626]"
                            onClick={() => remove(s)}
                            disabled={busy}
                          >
                            Excluir
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
