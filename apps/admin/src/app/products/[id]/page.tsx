"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adminJson, messageOf } from "../../../lib/api";
import { useGateRedirect } from "../../../lib/useGate";

type Variant = { id: string; sku: string; name: string; priceCents: number; promoPriceCents: number | null; active: boolean; weightGrams: number; inventory?: { physical: number; reserved: number; minQuantity: number } | null };
type Img = { id: string; url: string; alt: string; kind: string; position: number };
type Rel = { id: string; relatedProductId?: string; compatibleId?: string; compatibleProductId?: string; position?: number };
type HistoryItem = { id: string; field: string; beforeValue: string | null; afterValue: string | null; actorLabel: string | null; createdAt: string };
type Product = {
  id: string; name: string; slug: string; description: string; shortDescription?: string; categoryId: string; brandId: string | null;
  published: boolean; featured: boolean; ageRestricted: boolean; condicao: string; estadoConservacao: string; acessoriosIncluidos: string;
  garantiaDias: number; tags: string; seoTitle: string; seoDescription: string; technical?: Record<string, string>; videos?: { url: string; type: string; title?: string }[];
  costCents?: number | null; publishedAt?: string | null;
};

function brl(cents: number) { return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
const COST_ROLES = new Set(["superadmin", "gerente", "financeiro"]);

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [meRole, setMeRole] = useState<string | null>(null);
  const [p, setP] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [images, setImages] = useState<Img[]>([]);
  const [related, setRelated] = useState<Rel[]>([]);
  const [compatible, setCompatible] = useState<Rel[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [imgUrl, setImgUrl] = useState("");
  const [relId, setRelId] = useState("");
  const [compId, setCompId] = useState("");
  const [vUrl, setVUrl] = useState("");
  const [vType, setVType] = useState("youtube");
  const [techKey, setTechKey] = useState("");
  const [techVal, setTechVal] = useState("");
  useGateRedirect(failure);

  async function load() {
    setLoading(true); setErr("");
    try {
      const [detail, me, hist] = await Promise.all([
        adminJson<any>(`/api/admin/products/${id}`),
        adminJson<any>(`/api/admin/me`).catch(() => ({ user: null })),
        adminJson<any>(`/api/admin/products/${id}/history`).catch(() => ({ items: [] })),
      ]);
      setP(detail.product); setVariants(detail.variants || []); setImages(detail.images || []); setRelated(detail.related || []); setCompatible(detail.compatible || []);
      setMeRole(me?.user?.role ?? null);
      setHistory(hist.items || []);
    } catch (e) { setFailure(e); setErr(messageOf(e, "Falha ao carregar produto.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  const canCost = meRole != null && COST_ROLES.has(meRole);

  async function save(partial?: Record<string, any>) {
    if (!p) return;
    setSaving(true); setMsg(""); setErr("");
    const body = partial ?? {
      name: p.name, slug: p.slug, description: p.description, shortDescription: p.shortDescription ?? "",
      condicao: p.condicao, estadoConservacao: p.estadoConservacao, acessoriosIncluidos: p.acessoriosIncluidos,
      garantiaDias: Number(p.garantiaDias) || 0, tags: p.tags, seoTitle: p.seoTitle, seoDescription: p.seoDescription,
      technical: p.technical ?? {}, videos: p.videos ?? [], ageRestricted: p.ageRestricted,
      ...(canCost && p.costCents !== undefined ? { costCents: p.costCents } : {}),
      ...(p.publishedAt !== undefined ? { publishedAt: p.publishedAt } : {}),
    };
    if ((body.condicao === "usado" || body.condicao === "seminovo") && !String(body.estadoConservacao || "").trim()) {
      setErr("Produtos usados/seminovos exigem estado de conservação."); setSaving(false); return;
    }
    try {
      await adminJson(`/api/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg("Salvo."); await load();
    } catch (e) { setFailure(e); setErr(messageOf(e, "Falha ao salvar.")); }
    finally { setSaving(false); }
  }

  async function action(label: string, body: Record<string, any>) {
    if (!confirm(label)) return;
    await save(body);
  }

  async function addImage() {
    if (!imgUrl.trim()) return; setSaving(true); setErr("");
    try { await adminJson(`/api/admin/products/${id}/images`, { method: "POST", body: JSON.stringify({ url: imgUrl.trim(), alt: p?.name || "" }) }); setImgUrl(""); await load(); setMsg("Imagem adicionada."); }
    catch (e) { setFailure(e); setErr(messageOf(e, "Falha ao adicionar imagem.")); } finally { setSaving(false); }
  }
  async function removeImage(imageId: string) {
    if (!confirm("Remover esta imagem?")) return; setSaving(true);
    try { await adminJson(`/api/admin/products/${id}/images/${imageId}`, { method: "DELETE" }); await load(); } catch (e) { setFailure(e); setErr(messageOf(e, "Falha.")); } finally { setSaving(false); }
  }
  async function moveImage(imageId: string, dir: -1 | 1) {
    const idx = images.findIndex(i => i.id === imageId); if (idx < 0) return;
    const j = idx + dir; if (j < 0 || j >= images.length) return;
    const order = images.map(i => i.id); const t = order[idx]!; order[idx] = order[j]!; order[j] = t;
    setSaving(true);
    try { await adminJson(`/api/admin/products/${id}/images/reorder`, { method: "POST", body: JSON.stringify({ order }) }); await load(); } catch (e) { setErr(messageOf(e, "Falha ao reordenar.")); } finally { setSaving(false); }
  }

  async function addRelated() { if (!relId.trim()) return; setSaving(true); try { await adminJson(`/api/admin/products/${id}/related`, { method: "POST", body: JSON.stringify({ relatedProductId: relId.trim() }) }); setRelId(""); await load(); } catch (e) { setErr(messageOf(e, "Falha.")); } finally { setSaving(false); } }
  async function removeRelated(rid: string) { if (!confirm("Remover relacionado?")) return; try { await adminJson(`/api/admin/products/${id}/related/${rid}`, { method: "DELETE" }); await load(); } catch (e) { setErr(messageOf(e, "Falha.")); } }
  async function addCompatible() { if (!compId.trim()) return; setSaving(true); try { await adminJson(`/api/admin/products/${id}/compatible`, { method: "POST", body: JSON.stringify({ compatibleProductId: compId.trim() }) }); setCompId(""); await load(); } catch (e) { setErr(messageOf(e, "Falha.")); } finally { setSaving(false); } }
  async function removeCompatible(cid: string) { if (!confirm("Remover compatível?")) return; try { await adminJson(`/api/admin/products/${id}/compatible/${cid}`, { method: "DELETE" }); await load(); } catch (e) { setErr(messageOf(e, "Falha.")); } }

  function addVideo() {
    if (!vUrl.trim() || !/^https?:\/\//i.test(vUrl)) { setErr("Informe uma URL de vídeo válida (http/https)."); return; }
    const videos = [...(p?.videos || []), { url: vUrl.trim(), type: vType, title: "" }];
    setP(p ? { ...p, videos } : p); setVUrl(""); setErr("");
  }
  function removeVideo(i: number) { if (!p) return; const videos = [...(p.videos || [])]; videos.splice(i,1); setP({ ...p, videos }); }
  function addTech() { if (!techKey.trim()) return; setP(p ? { ...p, technical: { ...(p.technical||{}), [techKey.trim()]: techVal } } : p); setTechKey(""); setTechVal(""); }

  if (loading) return <main className="px-6 pb-24"><p className="font-mono text-xs text-[#666]" role="status">Carregando produto…</p></main>;
  if (!p) return <main className="px-6 pb-24"><p role="alert" className="text-[#dc2626] font-mono text-xs">{err || "Produto não encontrado."}</p><Link href="/products" className="underline text-[#8bcf16]">Voltar</Link></main>;

  return (
    <main className="px-6 pb-24">
      <header className="mb-8 border-b border-[#111] pb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-black text-2xl md:text-3xl uppercase text-white">Editar produto</h1>
          <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-1">{p.slug} · {p.published ? "Publicado" : "Rascunho"}{p.featured ? " · Destaque" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-2 px-3 border border-[#111] text-[#666] hover:text-[#8bcf16]" onClick={() => action(p.published ? "Despublicar este produto?" : "Publicar este produto?", { published: !p.published })} disabled={saving}>{p.published ? "Despublicar" : "Publicar"}</button>
          <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-2 px-3 border border-[#111] text-[#666] hover:text-[#8bcf16]" onClick={() => save({ featured: !p.featured })} disabled={saving}>{p.featured ? "Remover destaque" : "Destacar"}</button>
          <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-2 px-3 border border-[#dc2626]/40 text-[#dc2626]" onClick={() => action("Arquivar este produto? Ele será despublicado e removido do destaque.", { archived: true })} disabled={saving}>Arquivar</button>
          <Link href="/products" className="font-mono text-[0.65rem] uppercase text-[#666] underline py-2 px-1">Voltar</Link>
        </div>
      </header>

      {msg && <p role="status" className="font-mono text-xs text-[#8bcf16] mb-4">{msg}</p>}
      {err && <p role="alert" className="font-mono text-xs text-[#dc2626] mb-4">{err}</p>}

      <div className="grid gap-8 max-w-5xl">
        <section className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4">
          <h2 className="font-display font-black text-lg text-white uppercase">Dados principais</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="field"><label htmlFor="name">Nome</label><input id="name" className="input" value={p.name} onChange={e=>setP({...p,name:e.target.value})} /></div>
            <div className="field"><label htmlFor="slug">Slug</label><input id="slug" className="input" value={p.slug} onChange={e=>setP({...p,slug:e.target.value})} /></div>
          </div>
          <div className="field"><label htmlFor="short">Descrição curta</label><input id="short" className="input" value={p.shortDescription||""} onChange={e=>setP({...p,shortDescription:e.target.value})} /></div>
          <div className="field"><label htmlFor="desc">Descrição técnica / detalhada</label><textarea id="desc" className="input" rows={5} value={p.description||""} onChange={e=>setP({...p,description:e.target.value})} /></div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="field"><label htmlFor="cond">Condição</label><select id="cond" className="select" value={p.condicao||"novo"} onChange={e=>setP({...p,condicao:e.target.value})}><option value="novo">Novo</option><option value="usado">Usado</option><option value="seminovo">Seminovo</option></select></div>
            <div className="field"><label htmlFor="cons">Estado de conservação {(p.condicao==="usado"||p.condicao==="seminovo") && <span className="text-[#dc2626]">*</span>}</label><input id="cons" className="input" value={p.estadoConservacao||""} onChange={e=>setP({...p,estadoConservacao:e.target.value})} aria-required={p.condicao!=="novo"} /></div>
            <div className="field"><label htmlFor="gar">Garantia (dias)</label><input id="gar" className="input" type="number" min={0} value={p.garantiaDias ?? 30} onChange={e=>setP({...p,garantiaDias:Number(e.target.value)})} /></div>
          </div>
          <div className="field"><label htmlFor="acess">Acessórios incluídos</label><input id="acess" className="input" value={p.acessoriosIncluidos||""} onChange={e=>setP({...p,acessoriosIncluidos:e.target.value})} /></div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="field"><label htmlFor="tags">Tags (separadas por vírgula)</label><input id="tags" className="input" value={p.tags||""} onChange={e=>setP({...p,tags:e.target.value})} /></div>
            <div className="field"><label htmlFor="pubat">publishedAt (ISO, opcional)</label><input id="pubat" className="input" value={p.publishedAt ? String(p.publishedAt).slice(0,19) : ""} onChange={e=>setP({...p,publishedAt:e.target.value||null})} placeholder="2026-01-01T12:00:00" /></div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="field"><label htmlFor="seot">SEO title</label><input id="seot" className="input" value={p.seoTitle||""} onChange={e=>setP({...p,seoTitle:e.target.value})} /></div>
            <div className="field"><label htmlFor="seod">SEO description</label><input id="seod" className="input" value={p.seoDescription||""} onChange={e=>setP({...p,seoDescription:e.target.value})} /></div>
          </div>
          {canCost ? (
            <div className="field"><label htmlFor="cost">Custo interno (centavos, restrito)</label><input id="cost" className="input" type="number" min={0} value={p.costCents ?? ""} onChange={e=>setP({...p,costCents:e.target.value===""?null:Number(e.target.value)})} /><p className="font-mono text-[0.6rem] text-[#666] mt-1">Visível/editável apenas para papéis autorizados; nunca público.</p></div>
          ) : (
            <p className="font-mono text-[0.6rem] text-[#666]">Custo interno: oculto para este papel (protegido no backend).</p>
          )}
          <div className="flex gap-3"><button type="button" className="btn-primary px-6 py-2" onClick={()=>save()} disabled={saving}>{saving?"Salvando…":"Salvar alterações"}</button></div>
        </section>

        <section className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4">
          <h2 className="font-display font-black text-lg text-white uppercase">Vídeos</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="field flex-1 min-w-[220px]"><label htmlFor="vurl">URL</label><input id="vurl" className="input" value={vUrl} onChange={e=>setVUrl(e.target.value)} placeholder="https://..." /></div>
            <div className="field"><label htmlFor="vtype">Tipo</label><select id="vtype" className="select" value={vType} onChange={e=>setVType(e.target.value)}><option value="youtube">youtube</option><option value="vimeo">vimeo</option><option value="mp4">mp4</option><option value="external">external</option></select></div>
            <button type="button" className="btn-primary px-4 py-2" onClick={addVideo}>Adicionar</button>
          </div>
          {(p.videos||[]).length===0 ? <p className="text-[#666] font-mono text-xs">Nenhum vídeo.</p> : (
            <ul className="grid gap-2">{(p.videos||[]).map((v,i)=>(<li key={i} className="flex items-center justify-between border border-[#111] p-2 font-mono text-xs"><span className="truncate mr-2"><span className="text-[#8bcf16]">[{v.type}]</span> {v.url}</span><button type="button" className="text-[#dc2626] underline" onClick={()=>removeVideo(i)}>Remover</button></li>))}</ul>
          )}
          <p className="text-[#666] font-mono text-[0.6rem]">Salve o produto após alterar vídeos.</p>
        </section>

        <section className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4">
          <h2 className="font-display font-black text-lg text-white uppercase">Campos técnicos (configuráveis)</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="field"><label htmlFor="tk">Chave</label><input id="tk" className="input" value={techKey} onChange={e=>setTechKey(e.target.value)} /></div>
            <div className="field flex-1"><label htmlFor="tv">Valor</label><input id="tv" className="input" value={techVal} onChange={e=>setTechVal(e.target.value)} /></div>
            <button type="button" className="btn-primary px-4 py-2" onClick={addTech}>Definir</button>
          </div>
          {Object.keys(p.technical||{}).length===0 ? <p className="text-[#666] font-mono text-xs">Nenhum campo técnico.</p> : (
            <ul className="grid gap-1 font-mono text-xs">{Object.entries(p.technical||{}).map(([k,v])=>(<li key={k} className="border border-[#111] p-2 flex justify-between"><span>{k}: <span className="text-white">{String(v)}</span></span><button type="button" className="text-[#dc2626] underline" onClick={()=>{ const t={...(p.technical||{})}; delete t[k]; setP({...p,technical:t}); }}>Remover</button></li>))}</ul>
          )}
        </section>

        <section className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4">
          <h2 className="font-display font-black text-lg text-white uppercase">Galeria</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="field flex-1 min-w-[220px]"><label htmlFor="imgurl">URL da imagem</label><input id="imgurl" className="input" value={imgUrl} onChange={e=>setImgUrl(e.target.value)} placeholder="https://..." /></div>
            <button type="button" className="btn-primary px-4 py-2" onClick={addImage} disabled={saving}>Adicionar</button>
          </div>
          {images.length===0 ? <p className="text-[#666] font-mono text-xs">Nenhuma imagem.</p> : (
            <ul className="grid gap-2">{images.map((im,i)=>(<li key={im.id} className="flex items-center justify-between gap-2 border border-[#111] p-2 font-mono text-xs"><span className="truncate">{i+1}. {im.url}</span><span className="flex gap-2 shrink-0"><button type="button" className="underline" onClick={()=>moveImage(im.id,-1)}>↑</button><button type="button" className="underline" onClick={()=>moveImage(im.id,1)}>↓</button><button type="button" className="text-[#dc2626] underline" onClick={()=>removeImage(im.id)}>Remover</button></span></li>))}</ul>
          )}
        </section>

        <section className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4">
          <h2 className="font-display font-black text-lg text-white uppercase">Relacionados e compatíveis</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="grid gap-2">
              <label htmlFor="rel" className="font-mono text-[0.65rem] uppercase text-[#666]">ID do produto relacionado</label>
              <div className="flex gap-2"><input id="rel" className="input flex-1" value={relId} onChange={e=>setRelId(e.target.value)} /><button type="button" className="btn-primary px-3 py-2" onClick={addRelated} disabled={saving}>Adicionar</button></div>
              {related.length===0 ? <p className="text-[#666] font-mono text-xs">Nenhum.</p> : <ul className="grid gap-1">{related.map(r=>{ const rid=(r as any).relatedProductId||r.id; return <li key={rid} className="flex justify-between border border-[#111] p-2 font-mono text-xs"><span className="truncate mr-2">{rid}</span><button type="button" className="text-[#dc2626] underline" onClick={()=>removeRelated(rid)}>Remover</button></li>; })}</ul>}
            </div>
            <div className="grid gap-2">
              <label htmlFor="comp" className="font-mono text-[0.65rem] uppercase text-[#666]">ID do produto compatível</label>
              <div className="flex gap-2"><input id="comp" className="input flex-1" value={compId} onChange={e=>setCompId(e.target.value)} /><button type="button" className="btn-primary px-3 py-2" onClick={addCompatible} disabled={saving}>Adicionar</button></div>
              {compatible.length===0 ? <p className="text-[#666] font-mono text-xs">Nenhum.</p> : <ul className="grid gap-1">{compatible.map(r=>{ const cid=(r as any).compatibleProductId||(r as any).compatibleId||r.id; return <li key={cid} className="flex justify-between border border-[#111] p-2 font-mono text-xs"><span className="truncate mr-2">{cid}</span><button type="button" className="text-[#dc2626] underline" onClick={()=>removeCompatible(cid)}>Remover</button></li>; })}</ul>}
            </div>
          </div>
        </section>

        <section className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4">
          <h2 className="font-display font-black text-lg text-white uppercase">Preço e estoque (variantes)</h2>
          <p className="text-[#666] font-mono text-[0.6rem]">Preço/estoque residem em variantes e inventário. Edição abaixo reflete a variante principal; movimentações de estoque usam o endpoint de inventário (auditado/RBAC).</p>
          {variants.length===0 ? <p className="text-[#666] font-mono text-xs">Nenhuma variante.</p> : (
            <div className="overflow-x-auto"><table><thead><tr><th>SKU</th><th>Preço</th><th>Promo</th><th>Físico</th><th>Reservado</th><th>Disponível</th><th>Mín.</th></tr></thead>
              <tbody>{variants.map(v=>{ const inv=v.inventory; const avail=inv?(inv.physical-inv.reserved):null; return <tr key={v.id}><td className="font-mono text-xs">{v.sku}</td><td>{brl(v.priceCents)}</td><td>{v.promoPriceCents!=null?brl(v.promoPriceCents):"—"}</td><td>{inv?.physical ?? "—"}</td><td>{inv?.reserved ?? "—"}</td><td>{avail ?? "—"}</td><td>{inv?.minQuantity ?? "—"}</td></tr>; })}</tbody>
            </table></div>
          )}
        </section>

        <section className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4">
          <h2 className="font-display font-black text-lg text-white uppercase">Histórico de alterações (append-only)</h2>
          {history.length===0 ? <p className="text-[#666] font-mono text-xs">Sem histórico registrado.</p> : (
            <ul className="grid gap-2 max-h-80 overflow-auto">{history.map(h=>(<li key={h.id} className="border border-[#111] p-2 font-mono text-[0.65rem]"><span className="text-white">{h.field}</span> <span className="text-[#666]">{new Date(h.createdAt).toLocaleString("pt-BR")}</span>{h.actorLabel?` · ${h.actorLabel}`:""}<div className="text-[#999] break-all">antes: {h.beforeValue ?? "—"} → depois: {h.afterValue ?? "—"}</div></li>))}</ul>
          )}
        </section>
      </div>
    </main>
  );
}
