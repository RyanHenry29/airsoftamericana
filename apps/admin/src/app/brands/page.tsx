"use client";

import { useCallback, useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Brand = { id: string; name: string; slug: string; active: boolean; description?: string; seoTitle?: string | null; seoDescription?: string | null; position?: number };

function slugify(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function BrandsPage() {
  const [items, setItems] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "", seoTitle: "", seoDescription: "", active: true });
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Brand>>({});
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await adminJson<{ items?: Brand[] }>("/api/admin/brands");
      setItems(payload.items ?? []);
      setFailure(null); setError("");
    } catch (e) { setFailure(e); setError(messageOf(e, "Falha ao carregar marcas.")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson("/api/admin/brands", { method: "POST", body: JSON.stringify({ name: form.name.trim(), slug: (form.slug || slugify(form.name)).trim(), description: form.description, seoTitle: form.seoTitle || null, seoDescription: form.seoDescription || null, active: form.active }) });
      setForm({ name: "", slug: "", description: "", seoTitle: "", seoDescription: "", active: true });
      setNotice("Marca criada."); load();
    } catch (e) { setFailure(e); setError(messageOf(e, "Falha ao criar marca.")); }
    finally { setBusy(false); }
  }

  async function saveEdit(id: string) {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/brands/${id}`, { method: "PATCH", body: JSON.stringify(edit) });
      setEditing(null); setNotice("Marca atualizada."); load();
    } catch (e) { setFailure(e); setError(messageOf(e, "Falha ao atualizar marca.")); }
    finally { setBusy(false); }
  }

  async function remove(b: Brand) {
    if (!confirm(`Excluir a marca "${b.name}"? A exclusao e bloqueada se houver produtos vinculados.`)) return;
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/brands/${b.id}`, { method: "DELETE" });
      setNotice("Marca excluida."); load();
    } catch (e) { setFailure(e); setError(messageOf(e, "Falha ao excluir marca.")); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="px-6 pb-24"><p className="font-mono text-xs text-[#666]" role="status">Carregando marcas...</p></main>;

  return (
    <main className="px-6 pb-24">
      <header className="mb-8 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl uppercase text-white">Gestao de Marcas</h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">Catalogo proprio · {items.length} marca(s)</p>
      </header>
      {error ? <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-4">{error}</p> : null}
      {notice ? <p role="status" className="text-[#8bcf16] font-mono text-xs font-bold mb-4">{notice}</p> : null}

      <form onSubmit={create} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 mb-10">
        <h2 className="font-display font-black text-lg text-white uppercase">Nova marca</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="field"><label htmlFor="bname">Nome</label><input id="bname" className="input" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required /></div>
          <div className="field"><label htmlFor="bslug">Slug</label><input id="bslug" className="input" value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})} placeholder="gerado pelo nome" /></div>
          <label className="font-mono text-[0.65rem] uppercase text-[#666] flex items-center gap-2 mt-6"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})} /> Ativa</label>
        </div>
        <div className="field"><label htmlFor="bdesc">Descricao</label><input id="bdesc" className="input" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="field"><label htmlFor="bseot">SEO title</label><input id="bseot" className="input" value={form.seoTitle} onChange={e=>setForm({...form,seoTitle:e.target.value})} /></div>
          <div className="field"><label htmlFor="bseod">SEO description</label><input id="bseod" className="input" value={form.seoDescription} onChange={e=>setForm({...form,seoDescription:e.target.value})} /></div>
        </div>
        <div><button type="submit" className="btn-primary px-6 py-2" disabled={busy}>{busy?"Salvando...":"Criar marca"}</button></div>
      </form>

      {items.length === 0 ? (
        <div className="border border-[#111] bg-[#0a0a0a] p-10 text-center"><p className="font-mono text-xs text-[#666]">Nenhuma marca cadastrada.</p></div>
      ) : (
        <div className="overflow-x-auto">
          <table><thead><tr><th>Nome</th><th>Slug</th><th>Ativa</th><th>Acoes</th></tr></thead>
            <tbody>{items.map(b => (
              <tr key={b.id}>
                <td>{editing===b.id ? <input className="input" aria-label="Nome" value={edit.name ?? b.name} onChange={e=>setEdit({...edit,name:e.target.value})} /> : <span className="font-mono text-sm text-white font-bold">{b.name}</span>}</td>
                <td className="font-mono text-xs text-[#666]">{editing===b.id ? <input className="input" aria-label="Slug" value={edit.slug ?? b.slug} onChange={e=>setEdit({...edit,slug:e.target.value})} /> : b.slug}</td>
                <td>{editing===b.id ? <label className="font-mono text-xs"><input type="checkbox" checked={edit.active ?? b.active} onChange={e=>setEdit({...edit,active:e.target.checked})} /> ativa</label> : <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${b.active?"border-[#8bcf16] text-[#8bcf16]":"border-[#333] text-[#333]"}`}>{b.active?"Sim":"Nao"}</span>}</td>
                <td className="flex flex-wrap gap-2">
                  {editing===b.id ? (<><button type="button" className="btn-primary px-3 py-1 text-xs" onClick={()=>saveEdit(b.id)} disabled={busy}>Salvar</button><button type="button" className="font-mono text-xs underline text-[#666]" onClick={()=>setEditing(null)}>Cancelar</button></>) : (<><button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666]" onClick={()=>{setEditing(b.id); setEdit({name:b.name,slug:b.slug,active:b.active,description:b.description??"",seoTitle:b.seoTitle??"",seoDescription:b.seoDescription??""});}}>Editar</button><button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#dc2626]/40 text-[#dc2626]" onClick={()=>remove(b)} disabled={busy}>Excluir</button></>)}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
