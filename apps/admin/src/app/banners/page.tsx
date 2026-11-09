"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Banner = {
  id: string;
  title: string;
  subtitle?: string | null;
  eyebrow?: string | null;
  ctaLabel?: string | null;
  imageDesktop?: string | null;
  imageMobile?: string | null;
  link?: string | null;
  kind?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  active?: boolean;
  position?: number;
  createdAt?: string;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function BannersPage() {
  const [items, setItems] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Banner>>({
    title: "", subtitle: "", eyebrow: "", ctaLabel: "", imageDesktop: "",
    imageMobile: "", link: "", kind: "hero", active: true, position: 0,
  });
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await adminJson<{ items?: Banner[] }>("/api/admin/banners");
      setItems(payload.items ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar banners."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kindLabels = useMemo(() => ({
    hero: "Hero (destaque principal)",
    promo: "Promoção",
    institutional: "Institucional",
  }), []);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson("/api/admin/banners", {
        method: "POST",
        body: JSON.stringify({
          title: form.title?.trim(),
          subtitle: form.subtitle?.trim() || null,
          eyebrow: form.eyebrow?.trim() || null,
          ctaLabel: form.ctaLabel?.trim() || null,
          imageDesktop: form.imageDesktop?.trim() || null,
          imageMobile: form.imageMobile?.trim() || null,
          link: form.link?.trim() || null,
          kind: form.kind ?? "hero",
          active: form.active ?? true,
          position: Number(form.position ?? 0),
        }),
      });
      setForm({ title: "", subtitle: "", eyebrow: "", ctaLabel: "", imageDesktop: "", imageMobile: "", link: "", kind: "hero", active: true, position: 0 });
      setEditing(null);
      setNotice("Banner criado.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao criar banner."));
    } finally { setBusy(false); }
  }

  async function saveEdit(id: string) {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/banners/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(form.title !== undefined ? { title: form.title?.trim() } : {}),
          ...(form.subtitle !== undefined ? { subtitle: form.subtitle?.trim() || null } : {}),
          ...(form.eyebrow !== undefined ? { eyebrow: form.eyebrow?.trim() || null } : {}),
          ...(form.ctaLabel !== undefined ? { ctaLabel: form.ctaLabel?.trim() || null } : {}),
          ...(form.imageDesktop !== undefined ? { imageDesktop: form.imageDesktop?.trim() || null } : {}),
          ...(form.imageMobile !== undefined ? { imageMobile: form.imageMobile?.trim() || null } : {}),
          ...(form.link !== undefined ? { link: form.link?.trim() || null } : {}),
          ...(form.kind !== undefined ? { kind: form.kind } : {}),
          ...(form.active !== undefined ? { active: form.active } : {}),
          ...(form.position !== undefined ? { position: Number(form.position ?? 0) } : {}),
        }),
      });
      setEditing(null);
      setNotice("Banner atualizado.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao atualizar banner."));
    } finally { setBusy(false); }
  }

  async function remove(b: Banner) {
    if (!confirm(`Remover o banner "${b.title}" da homepage?`)) return;
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/banners/${b.id}`, { method: "DELETE" });
      setNotice("Banner removido."); load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao remover banner."));
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <p className="font-mono text-xs text-[#666]" role="status">Carregando banners…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-8 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Banners da Homepage
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          O banner com <strong>kind = "hero"</strong> vira o destaque principal da loja. Troque a foto a qualquer hora.
        </p>
      </header>

      {error ? <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-6">{error}</p> : null}
      {notice ? <p role="status" className="text-[#8bcf16] font-mono text-xs font-bold mb-6">{notice}</p> : null}

      <form onSubmit={create} className="border border-[#111] bg-[#0a0a0a] p-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-12">
        <div className="field">
          <label htmlFor="bn-title">Título</label>
          <input id="bn-title" className="input w-full" required value={form.title ?? ""} onChange={e => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="bn-eyebrow">Eyebrow (etiqueta)</label>
          <input id="bn-eyebrow" className="input w-full" value={form.eyebrow ?? ""} placeholder="ex.: Lançamento" onChange={e => setForm({ ...form, eyebrow: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="bn-subtitle">Subtítulo</label>
          <input id="bn-subtitle" className="input w-full" value={form.subtitle ?? ""} placeholder="Legenda abaixo do título" onChange={e => setForm({ ...form, subtitle: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="bn-kind">Tipo</label>
          <select id="bn-kind" className="select w-full" value={form.kind ?? "hero"} onChange={e => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(kindLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 field">
          <label htmlFor="bn-image">URL da imagem (hero/foto)</label>
          <input id="bn-image" className="input w-full" value={form.imageDesktop ?? ""} placeholder="https://sua-loja.com.br/foto-hero.webp" onChange={e => setForm({ ...form, imageDesktop: e.target.value })} />
        </div>
        <div className="md:col-span-2 field">
          <label htmlFor="bn-image-mobile">URL da imagem (mobile)</label>
          <input id="bn-image-mobile" className="input w-full" value={form.imageMobile ?? ""} placeholder="mesma da acima ou recorte mobile" onChange={e => setForm({ ...form, imageMobile: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="bn-link">Link do botão (opcional)</label>
          <input id="bn-link" className="input w-full" value={form.link ?? ""} placeholder="/catalogo" onChange={e => setForm({ ...form, link: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="bn-cta">Texto do botão (CTA)</label>
          <input id="bn-cta" className="input w-full" value={form.ctaLabel ?? ""} placeholder="ex.: Ver catálogo" onChange={e => setForm({ ...form, ctaLabel: e.target.value })} />
        </div>
        <div className="field flex items-end">
          <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
            <input type="checkbox" checked={form.active ?? true} onChange={e => setForm({ ...form, active: e.target.checked })} />
            Ativo
          </label>
        </div>
        <div className="field">
          <label htmlFor="bn-position">Posição</label>
          <input id="bn-position" className="input w-full" type="number" min={0} value={form.position ?? 0} onChange={e => setForm({ ...form, position: Number(e.target.value) })} />
        </div>
        <div className="md:col-span-4 flex items-end">
          <button type="submit" className="btn-primary px-6 py-2" disabled={busy}>{busy ? "Criando…" : "Criar banner"}</button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
          <p className="text-[#666] font-mono text-xs">Nenhum banner cadastrado. Crie o primeiro para ativar o hero da loja.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Imagem</th>
                <th>Título</th>
                <th>Tipo</th>
                <th>Posição</th>
                <th>Ativo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => {
                const isEditing = editing === b.id;
                return (
                  <tr key={b.id} className="group border-b border-[#111]">
                    <td className="p-3">
                      {b.imageDesktop ? (
                        <img src={b.imageDesktop} alt={b.title} className="w-16 h-16 object-cover border border-[#111]" />
                      ) : (
                        <span className="w-16 h-16 flex items-center justify-center border border-[#111] text-[#333] font-mono text-xs">sem foto</span>
                      )}
                    </td>
                    <td className="p-3">
                      {isEditing ? (
                        <input className="input" value={form.title ?? b.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                      ) : (
                        <>
                          <div className="font-mono text-sm font-bold text-white">{b.title}</div>
                          {b.subtitle ? <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] mt-1 block">{b.subtitle}</span> : null}
                        </>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs text-[#666]">
                      {kindLabels[(b.kind as keyof typeof kindLabels) ?? "hero"] ?? b.kind}
                    </td>
                    <td className="p-3 font-mono text-sm text-[#666]">{b.position ?? 0}</td>
                    <td className="p-3">
                      {isEditing ? (
                        <label className="font-mono text-xs"><input type="checkbox" checked={form.active ?? true} onChange={e => setForm({ ...form, active: e.target.checked })} /> ativo</label>
                      ) : (
                        <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${b.active ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#333] text-[#333]"}`}>
                          {b.active ? "Sim" : "Não"}
                        </span>
                      )}
                    </td>
                    <td className="p-3 flex flex-wrap gap-2 items-center">
                      {isEditing ? (
                        <>
                          <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => saveEdit(b.id)} disabled={busy}>Salvar</button>
                          <button type="button" className="font-mono text-xs underline text-[#666]" onClick={() => setEditing(null)}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666]" onClick={() => { setEditing(b.id); setForm({ ...b, active: !!b.active }); }}>Editar</button>
                          <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#dc2626]/40 text-[#dc2626]" onClick={() => remove(b)} disabled={busy}>Excluir</button>
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
