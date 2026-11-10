"use client";

// Assistente de cadastro (admin-only): foto + texto → rascunho pré-preenchido →
// o operador revisa, completa preço/estoque (a IA nunca envia esses valores) →
// publica pelo POST /api/admin/products já auditado.
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, adminFetch, adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Conversation = { id: string; title: string; createdAt: string; updatedAt: string };
type ChatMessage = { id: string; role: string; content: string; uploadIds: string[]; createdAt: string };
type Draft = {
  id: string;
  status: string;
  payload: DraftPayload;
  flags: string[];
  uploadIds: string[];
  productId: string | null;
};
type DraftPayload = {
  name: string; slug: string; sku: string;
  description: string; shortDescription: string; color: string;
  technical: Record<string, string>;
  categoryId: string | null; brandId: string | null;
  condicao: string; estadoConservacao: string;
  tags: string; seoTitle: string; seoDescription: string;
  variantName: string; weightGrams: number;
  priceCents: number | null; promoPriceCents: number | null;
  stockPhysical: number | null; stockMin: number;
};
type Category = { id: string; name: string };
type Brand = { id: string; name: string };
type SendResponse = {
  conversationId: string;
  draft: Draft | null;
};

const MAX_IMAGES = 3;

/** Compressão no cliente: máx. 1280px, JPEG ~0.8 — cabe no limite de 800 KB do servidor. */
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível neste navegador.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let quality = 0.82;
  let url = canvas.toDataURL("image/jpeg", quality);
  // corta para abaixo de ~800 KB (base64 já infla ~4/3)
  while (url.length > 800 * 1024 * 1.35 && quality > 0.4) {
    quality -= 0.12;
    url = canvas.toDataURL("image/jpeg", quality);
  }
  return url;
}

function money(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

export default function AssistentePage() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [err, setErr] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [ok, setOk] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  useGateRedirect(failure);

  const loadConvs = useCallback(async () => {
    setLoadingList(true);
    try {
      const json = await adminJson<{ conversations?: Conversation[] }>("/api/admin/ai/conversations");
      setConvs(json.conversations ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setErr(messageOf(e, "Falha ao carregar conversas."));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    setErr(""); setOk(""); setDraftId(null);
    try {
      const json = await adminJson<{ messages?: ChatMessage[]; drafts?: Draft[] }>(`/api/admin/ai/conversations/${id}`);
      setMessages(json.messages ?? []);
      setDrafts(json.drafts ?? []);
      const pending = (json.drafts ?? []).find((d) => d.status === "pendente");
      if (pending) applyDraft(pending);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setErr(messageOf(e, "Falha ao carregar a conversa."));
    } finally {
      setLoadingThread(false);
    }
    // applyDraft é estável (só usa setters) — mantido fora das deps de propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadConvs();
    fetch(`${API_URL}/api/store/categories`, { credentials: "include" })
      .then((r) => r.json().catch(() => []))
      .then((j) => setCats(Array.isArray(j) ? j : []))
      .catch(() => setCats([]));
    fetch(`${API_URL}/api/store/brands`, { credentials: "include" })
      .then((r) => r.json().catch(() => []))
      .then((j) => setBrands(Array.isArray(j) ? j : []))
      .catch(() => setBrands([]));
  }, [loadConvs]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  function newConversation() {
    setConvId(null); setMessages([]); setDrafts([]); setDraftId(null);
    setErr(""); setOk(""); setText(""); setImages([]);
  }

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setErr(""); setImgBusy(true);
    try {
      const room = MAX_IMAGES - images.length;
      if (files.length > room) setErr(`Máximo de ${MAX_IMAGES} imagens por mensagem.`);
      const picked: string[] = [];
      for (const f of files.slice(0, room)) {
        if (!/^image\//.test(f.type)) { setErr("Só arquivos de imagem (JPEG, PNG ou WebP)."); continue; }
        picked.push(await compressImage(f));
      }
      setImages((prev) => [...prev, ...picked]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao processar a imagem.");
    } finally {
      setImgBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && images.length === 0) return;
    setSending(true); setErr(""); setOk("");
    try {
      const json = await adminJson<SendResponse>("/api/admin/ai/messages", {
        method: "POST",
        body: JSON.stringify({ conversationId: convId ?? undefined, content: text.trim() || "Analise as fotos anexadas.", images }),
      });
      setText(""); setImages([]);
      if (json.conversationId && json.conversationId !== convId) setConvId(json.conversationId);
      // recarrega a thread completa (fonte única do servidor)
      if (json.conversationId) await loadThread(json.conversationId);
      else await loadConvs();
      if (json.draft) setOk("Rascunho gerado. Revise os campos e informe preço e estoque antes de publicar.");
    } catch (e) {
      setFailure(e);
      setErr(messageOf(e, "Falha ao enviar a mensagem."));
    } finally {
      setSending(false);
    }
  }

  function applyDraft(d: Draft) {
    setDraftId(d.id);
    setDrafts((prev) => (prev.some((x) => x.id === d.id) ? prev : [d, ...prev]));
  }

  const draft = drafts.find((d) => d.id === draftId) ?? null;
  const form = draft ? { ...draft.payload } : null;

  function setForm(patch: Partial<DraftPayload>) {
    setDrafts((prev) =>
      prev.map((d) => (d.id === draftId ? { ...d, payload: { ...d.payload, ...patch } } : d)),
    );
  }

  function setSpec(key: string, value: string) {
    if (!form) return;
    const technical = { ...form.technical };
    if (value === "") delete technical[key];
    else technical[key] = value;
    setForm({ technical });
  }

  function addSpec() {
    if (!form) return;
    const key = window.prompt("Nome da especificação (ex.: Material):")?.trim();
    if (!key) return;
    if (form.technical[key] !== undefined) return setErr(`A especificação "${key}" já existe.`);
    setForm({ technical: { ...form.technical, [key]: "" } });
  }

  async function discardDraft() {
    if (!draft || !window.confirm("Descartar este rascunho?")) return;
    try {
      await adminFetch(`/api/admin/ai/drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify({ status: "descartado" }) });
      setDraftId(null);
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      setOk("Rascunho descartado.");
    } catch (e) {
      setFailure(e); setErr(messageOf(e, "Falha ao descartar."));
    }
  }

  async function publish() {
    if (!form || !draft) return;
    setErr(""); 
    if (!form.categoryId) { setErr("Selecione a categoria antes de publicar."); return; }
    if (!form.priceCents && form.priceCents !== 0) { setErr("Informe o preço de venda — a IA não define preço."); return; }
    if (form.priceCents < 0) { setErr("Preço não pode ser negativo."); return; }
    if (form.stockPhysical == null) { setErr("Informe o estoque físico — a IA não define estoque."); return; }
    if ((form.condicao === "usado" || form.condicao === "seminovo") && !form.estadoConservacao.trim()) {
      setErr("Produtos usados/seminovos exigem estado de conservação."); return;
    }
    if (form.promoPriceCents != null && form.promoPriceCents >= form.priceCents) {
      setErr("Preço promocional deve ser menor que o preço normal."); return;
    }
    setPublishing(true);
    try {
      const json = await adminJson<{ product?: { id?: string } }>("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          description: form.description.trim(),
          shortDescription: form.shortDescription.trim(),
          categoryId: form.categoryId,
          brandId: form.brandId || undefined,
          ageRestricted: false,
          featured: false,
          published: true,
          condicao: form.condicao,
          estadoConservacao: form.estadoConservacao,
          acessoriosIncluidos: "",
          garantiaDias: 30,
          tags: form.tags,
          seoTitle: form.seoTitle,
          seoDescription: form.seoDescription,
          technical: form.technical,
          variants: [
            {
              sku: form.sku.trim(),
              name: form.variantName.trim() || form.name.trim(),
              priceCents: form.priceCents!,
              promoPriceCents: form.promoPriceCents,
              stockPhysical: form.stockPhysical!,
              stockMin: form.stockMin,
              weightGrams: form.weightGrams,
              active: true,
            },
          ],
        }),
      });
      const productId = json.product?.id;
      if (productId) {
        await adminFetch(`/api/admin/ai/drafts/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "publicado", productId }),
        });
      }
      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, status: "publicado", productId: productId ?? null } : d)));
      setOk(`Produto publicado na loja${productId ? " (#" + productId.slice(0, 8) + ")" : ""}.`);
      setDraftId(null);
    } catch (e) {
      setFailure(e);
      setErr(messageOf(e, "Falha ao publicar o produto."));
    } finally {
      setPublishing(false);
    }
  }

  const lastDraft = drafts.find((d) => d.status === "pendente") ?? null;

  return (
    <main className="px-4 md:px-6 pb-24">
      <header className="mb-8 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Assistente de cadastro
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Foto + descrição → rascunho revisável · o assistente não publica sozinho
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* -------------------------------------------------- conversas */}
        <aside className="border border-[#111] bg-[#0a0a0a] p-4 h-fit">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666]">Conversas</h2>
            <button type="button" className="btn btn-outline btn-sm" onClick={newConversation}>Nova</button>
          </div>
          {loadingList ? (
            <div className="space-y-2" aria-busy="true">
              <div className="h-9 bg-[#111] animate-pulse" />
              <div className="h-9 bg-[#111] animate-pulse" />
            </div>
          ) : convs.length === 0 ? (
            <p className="font-mono text-xs text-[#666]">
              Nenhuma conversa ainda. Envie a primeira foto de produto ao lado.
            </p>
          ) : (
            <ul className="space-y-1">
              {convs.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { setConvId(c.id); loadThread(c.id); }}
                    className={`w-full text-left px-2 py-2 border font-mono text-xs transition-colors truncate ${
                      c.id === convId ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#111] text-[#999] hover:border-[#333]"
                    }`}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* -------------------------------------------------- chat + rascunho */}
        <section className="min-w-0">
          <div className="border border-[#111] bg-[#0a0a0a] flex flex-col" style={{ minHeight: 260 }}>
            <div ref={feedRef} className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[55vh]">
              {loadingThread ? (
                <div className="space-y-3" aria-busy="true">
                  <div className="h-12 bg-[#111] w-2/3 animate-pulse" />
                  <div className="h-12 bg-[#111] w-1/2 ml-auto animate-pulse" />
                </div>
              ) : messages.length === 0 && !sending ? (
                <div className="py-8 text-center">
                  <p className="font-display font-black uppercase text-xl text-[#333]">Bancada vazia</p>
                  <p className="font-mono text-xs text-[#666] mt-2">
                    Envie até {MAX_IMAGES} fotos do produto e diga o que sabe sobre ele. O assistente monta o
                    rascunho com categoria, marca, cor e ficha técnica reais do catálogo.
                  </p>
                </div>
              ) : (
                messages.map((m) => (
                  <article key={m.id} className={m.role === "assistant" ? "max-w-[85%]" : "max-w-[85%] ml-auto"}>
                    <p className="font-mono text-[0.6rem] uppercase tracking-widest text-[#555] mb-1">
                      {m.role === "assistant" ? "Assistente" : "Você"}
                    </p>
                    <div className={`border p-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "assistant" ? "border-[#111] bg-black text-[#ccc]" : "border-[#8bcf16] bg-[#0a0f00] text-white"
                    }`}>
                      {m.content}
                    </div>
                    {m.uploadIds.length > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {m.uploadIds.map((uid) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={uid}
                            src={`${API_URL}/api/admin/ai/uploads/${uid}`}
                            alt="Foto enviada ao assistente"
                            className="w-20 h-20 object-cover border border-[#111]"
                          />
                        ))}
                      </div>
                    )}
                  </article>
                ))
              )}
              {sending && (
                <p className="font-mono text-xs text-[#666] animate-pulse" role="status">
                  Lendo o material e montando o rascunho…
                </p>
              )}
            </div>

            <form onSubmit={onSend} className="border-t border-[#111] p-4 space-y-3">
              {images.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {images.map((src, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Foto ${i + 1} selecionada`} className="w-16 h-16 object-cover border border-[#333]" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-2 -right-2 bg-[#dc2626] text-white text-xs w-5 h-5 leading-none"
                        aria-label={`Remover foto ${i + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col md:flex-row gap-3">
                <textarea
                  className="input flex-1 min-h-[72px]"
                  placeholder="Ex.: réplica M4 CQB, full metal, cor preta — veja a foto"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={4000}
                  aria-label="Mensagem ao assistente"
                />
                <div className="flex md:flex-col gap-2 shrink-0">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()} disabled={imgBusy || images.length >= MAX_IMAGES}>
                    {imgBusy ? "Processando…" : `Foto (${images.length}/${MAX_IMAGES})`}
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={sending || (!text.trim() && images.length === 0)}>
                    {sending ? "Enviando…" : "Enviar"}
                  </button>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={onPickImages}
                className="sr-only"
                aria-label="Selecionar fotos do produto"
              />
            </form>
          </div>

          {/* -------------------------------------------------- avisos */}
          {err && (
            <p className="admin-notice admin-notice--err mt-4" role="alert">{err}</p>
          )}
          {ok && (
            <p className="admin-notice admin-notice--ok mt-4" role="status">{ok}</p>
          )}

          {/* -------------------------------------------------- rascunho */}
          {form && draft && (
            <section className="mt-6 border border-[#8bcf16] bg-[#0a0f00] p-5 md:p-8" aria-label="Rascunho de cadastro">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1c2a00] pb-4 mb-6">
                <div>
                  <h2 className="font-display font-black text-2xl uppercase tracking-tighter text-[#a6f51b]">
                    Rascunho pronto
                  </h2>
                  <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-1">
                    Revisado contra o catálogo real · preço e estoque são seus
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-outline btn-sm" onClick={discardDraft} disabled={publishing}>Descartar</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={publish} disabled={publishing}>
                    {publishing ? "Publicando…" : "Publicar produto"}
                  </button>
                </div>
              </div>

              {draft.flags.length > 0 && (
                <ul className="mb-6 space-y-1">
                  {draft.flags.map((f, i) => (
                    <li key={i} className="font-mono text-xs text-[#fbbf24] border border-[#4a3a00] bg-[#1a1400] px-3 py-2">
                      ⚠ {f}
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="field md:col-span-2">
                  <label htmlFor="d-name">Nome</label>
                  <input id="d-name" className="input" value={form.name} onChange={(e) => setForm({ name: e.target.value })} maxLength={160} />
                </div>
                <div className="field">
                  <label htmlFor="d-slug">Slug</label>
                  <input id="d-slug" className="input" value={form.slug} onChange={(e) => setForm({ slug: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="d-sku">SKU</label>
                  <input id="d-sku" className="input" value={form.sku} onChange={(e) => setForm({ sku: e.target.value })} maxLength={64} />
                </div>
                <div className="field">
                  <label htmlFor="d-cat">Categoria *</label>
                  <select id="d-cat" className="select" value={form.categoryId ?? ""} onChange={(e) => setForm({ categoryId: e.target.value || null })}>
                    <option value="">— selecione —</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="d-brand">Marca</label>
                  <select id="d-brand" className="select" value={form.brandId ?? ""} onChange={(e) => setForm({ brandId: e.target.value || null })}>
                    <option value="">— sem marca —</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="d-color">Cor</label>
                  <input id="d-color" className="input" value={form.color} onChange={(e) => setForm({ color: e.target.value })} maxLength={60} />
                </div>
                <div className="field">
                  <label htmlFor="d-cond">Condição</label>
                  <select id="d-cond" className="select" value={form.condicao} onChange={(e) => setForm({ condicao: e.target.value })}>
                    <option value="novo">Novo</option>
                    <option value="seminovo">Seminovo</option>
                    <option value="usado">Usado</option>
                  </select>
                </div>
                {form.condicao !== "novo" && (
                  <div className="field md:col-span-2">
                    <label htmlFor="d-estado">Estado de conservação *</label>
                    <input id="d-estado" className="input" value={form.estadoConservacao} onChange={(e) => setForm({ estadoConservacao: e.target.value })} maxLength={120} />
                  </div>
                )}

                <div className="field md:col-span-2">
                  <label htmlFor="d-desc">Descrição</label>
                  <textarea id="d-desc" className="input min-h-[120px]" rows={5} value={form.description} onChange={(e) => setForm({ description: e.target.value })} maxLength={20000} />
                </div>

                {/* ficha técnica editável */}
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[0.7rem] font-black uppercase tracking-widest text-[#666]">Ficha técnica</span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={addSpec}>+ Especificação</button>
                  </div>
                  {Object.keys(form.technical).length === 0 ? (
                    <p className="font-mono text-xs text-[#666]">Sem especificações. Some com o que não está visível na foto.</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(form.technical).map(([k, v]) => (
                        <div key={k} className="flex gap-2 items-center">
                          <span className="font-mono text-xs text-[#999] w-40 shrink-0 truncate" title={k}>{k}</span>
                          <input
                            className="input flex-1"
                            value={v}
                            aria-label={`Valor de ${k}`}
                            onChange={(e) => setSpec(k, e.target.value)}
                          />
                          <button type="button" className="text-[#dc2626] text-xs underline shrink-0" onClick={() => setSpec(k, "")}>
                            remover
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* valores — sempre do operador */}
                <div className="md:col-span-2 border border-[#333] p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <p className="md:col-span-4 font-mono text-[0.65rem] uppercase tracking-widest text-[#8bcf16]">
                    Definição do lojista (a IA não preenche)
                  </p>
                  <div className="field">
                    <label htmlFor="d-price">Preço (R$) *</label>
                    <input id="d-price" className="input" inputMode="decimal" value={money(form.priceCents)}
                      onChange={(e) => {
                        const n = Number(String(e.target.value).replace(/\./g, "").replace(",", "."));
                        setForm({ priceCents: Number.isFinite(n) && String(e.target.value).trim() !== "" ? Math.round(n * 100) : null });
                      }} />
                  </div>
                  <div className="field">
                    <label htmlFor="d-promo">Promo (R$)</label>
                    <input id="d-promo" className="input" inputMode="decimal" value={money(form.promoPriceCents)}
                      onChange={(e) => {
                        const n = Number(String(e.target.value).replace(/\./g, "").replace(",", "."));
                        setForm({ promoPriceCents: Number.isFinite(n) && String(e.target.value).trim() !== "" ? Math.round(n * 100) : null });
                      }} />
                  </div>
                  <div className="field">
                    <label htmlFor="d-stock">Estoque físico *</label>
                    <input id="d-stock" className="input" inputMode="numeric" value={form.stockPhysical ?? ""}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        setForm({ stockPhysical: Number.isFinite(n) && e.target.value.trim() !== "" ? n : null });
                      }} />
                  </div>
                  <div className="field">
                    <label htmlFor="d-min">Estoque mínimo</label>
                    <input id="d-min" className="input" inputMode="numeric" value={form.stockMin}
                      onChange={(e) => setForm({ stockMin: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })} />
                  </div>
                </div>

                <div className="field md:col-span-2">
                  <label htmlFor="d-tags">Tags</label>
                  <input id="d-tags" className="input" value={form.tags} onChange={(e) => setForm({ tags: e.target.value })} maxLength={500} placeholder="separadas por vírgula" />
                </div>
                <div className="field">
                  <label htmlFor="d-seot">Título SEO</label>
                  <input id="d-seot" className="input" value={form.seoTitle} onChange={(e) => setForm({ seoTitle: e.target.value })} maxLength={200} />
                </div>
                <div className="field">
                  <label htmlFor="d-seod">Descrição SEO</label>
                  <input id="d-seod" className="input" value={form.seoDescription} onChange={(e) => setForm({ seoDescription: e.target.value })} maxLength={320} />
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mt-6 pt-5 border-t border-[#1c2a00]">
                <button type="button" className="btn btn-outline btn-sm" onClick={discardDraft} disabled={publishing}>Descartar rascunho</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={publish} disabled={publishing}>
                  {publishing ? "Publicando…" : "Publicar produto"}
                </button>
              </div>
            </section>
          )}

          {!form && lastDraft && (
            <p className="admin-notice mt-4">
              Há um rascunho pendente nesta conversa.{" "}
              <button type="button" className="underline" onClick={() => applyDraft(lastDraft)}>Abrir rascunho</button>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
