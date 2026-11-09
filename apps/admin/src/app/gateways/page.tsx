"use client";

import { useCallback, useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Gateway = {
  id?: string;
  provider: string;
  enabled: boolean;
  isDefault: boolean;
  methods: string[];
  captureAfterReview: boolean;
  require3ds: boolean;
  pixDiscountPercent: number;
  hasCredentials: boolean;
  updatedAt?: string;
};

const PROVIDERS: { id: string; label: string; fields: { key: string; label: string; hint?: string }[] }[] = [
  { id: "sandbox", label: "Sandbox (testes)", fields: [{ key: "secret", label: "Segredo webhook (opcional)", hint: "Usado para validar assinatura em testes." }] },
  { id: "mercadopago", label: "Mercado Pago", fields: [{ key: "accessToken", label: "Access Token", hint: "Token de produção/teste do Mercado Pago." }] },
  { id: "pagbank", label: "PagBank", fields: [{ key: "token", label: "Token", hint: "Token da API PagBank." }] },
  { id: "cielo", label: "Cielo", fields: [
    { key: "merchantId", label: "Merchant ID" },
    { key: "merchantKey", label: "Merchant Key" },
  ] },
];

const ALL_METHODS = ["pix", "cartao", "boleto"] as const;

export default function GatewaysPage() {
  const [items, setItems] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [creds, setCreds] = useState<Record<string, string>>({});
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await adminJson<{ items?: Gateway[] }>("/api/admin/gateways");
      setItems(payload.items ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar gateways."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function byProvider(provider: string): Gateway | undefined {
    return items.find((i) => i.provider === provider);
  }

  function openEdit(provider: string) {
    const g = byProvider(provider);
    setEdit(provider);
    setForm({
      enabled: g?.enabled ?? false,
      isDefault: g?.isDefault ?? false,
      methods: Array.isArray(g?.methods) && g?.methods.length ? g!.methods : ["pix", "cartao", "boleto"],
      captureAfterReview: g?.captureAfterReview ?? false,
      require3ds: g?.require3ds ?? false,
      pixDiscountPercent: g?.pixDiscountPercent ?? 0,
    });
    setCreds({});
    setError("");
    setNotice("");
  }

  function toggleMethod(m: string) {
    const cur = Array.isArray(form.methods) ? (form.methods as string[]) : [];
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
    setForm({ ...form, methods: next.length ? next : [m] });
  }

  async function save(provider: string) {
    if (busy) return;
    setBusy(provider); setError(""); setNotice("");
    try {
      const body: Record<string, unknown> = { ...form };
      const cleanCreds: Record<string, string> = {};
      for (const [k, v] of Object.entries(creds)) {
        if (v && v.trim()) cleanCreds[k] = v.trim();
      }
      if (Object.keys(cleanCreds).length) body.credentials = cleanCreds;
      await adminJson(`/api/admin/gateways/${provider}`, { method: "PUT", body: JSON.stringify(body) });
      setNotice(`Gateway ${provider} atualizado. Credenciais novas (se enviadas) foram salvas cifradas; valores não são exibidos.`);
      setEdit(null);
      setCreds({});
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao salvar gateway."));
    } finally { setBusy(null); }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <p className="font-mono text-xs text-[#666]" role="status">Carregando gateways…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-8 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Pagamentos / Gateways
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Configure provedores, métodos, captura e 3DS. Credenciais são salvas cifradas e nunca exibidas após o envio.
        </p>
      </header>

      {error ? <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-6">{error}</p> : null}
      {notice ? <p role="status" className="text-[#8bcf16] font-mono text-xs font-bold mb-6">{notice}</p> : null}

      <div className="grid grid-cols-1 gap-6">
        {PROVIDERS.map((p) => {
          const g = byProvider(p.id);
          const isEdit = edit === p.id;
          return (
            <section key={p.id} className="border border-[#111] bg-[#0a0a0a] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="font-display font-black text-xl uppercase text-white">{p.label}</h2>
                  <p className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] mt-1">
                    {p.id} · {g?.enabled ? "ativo" : "inativo"} · {g?.isDefault ? "padrão" : "não padrão"} · credenciais: {g?.hasCredentials ? "configuradas" : "ausentes"}
                  </p>
                </div>
                <button type="button" className="font-mono text-[0.65rem] uppercase font-bold py-2 px-4 border border-[#333] text-white" onClick={() => isEdit ? setEdit(null) : openEdit(p.id)}>
                  {isEdit ? "Fechar" : "Configurar"}
                </button>
              </div>

              {isEdit ? (
                <div className="border-t border-[#111] pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(form.enabled)} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
                    Habilitado
                  </label>
                  <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(form.isDefault)} onChange={e => setForm({ ...form, isDefault: e.target.checked })} />
                    Gateway padrão
                  </label>
                  <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(form.captureAfterReview)} onChange={e => setForm({ ...form, captureAfterReview: e.target.checked })} />
                    Captura após revisão manual
                  </label>
                  <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(form.require3ds)} onChange={e => setForm({ ...form, require3ds: e.target.checked })} />
                    Exigir 3DS (quando suportado)
                  </label>

                  <div className="field">
                    <span className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] block mb-2">Métodos</span>
                    <div className="flex flex-wrap gap-3">
                      {ALL_METHODS.map((m) => (
                        <label key={m} className="font-mono text-xs text-white flex items-center gap-2">
                          <input type="checkbox" checked={(form.methods as string[] | undefined)?.includes(m) ?? false} onChange={() => toggleMethod(m)} />
                          {m.toUpperCase()}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor={`${p.id}-pix`} className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] block mb-1">Desconto PIX (%)</label>
                    <input id={`${p.id}-pix`} className="input w-full" type="number" min={0} max={100} value={Number(form.pixDiscountPercent ?? 0)} onChange={e => setForm({ ...form, pixDiscountPercent: Number(e.target.value) })} />
                  </div>

                  <div className="md:col-span-2 border border-[#111] p-4">
                    <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#8bcf16] mb-3">Credenciais (envie para atualizar; não são exibidas)</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {p.fields.map((f) => (
                        <div key={f.key} className="field">
                          <label htmlFor={`${p.id}-${f.key}`} className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">{f.label}</label>
                          <input
                            id={`${p.id}-${f.key}`}
                            className="input w-full"
                            type="password"
                            autoComplete="new-password"
                            placeholder={g?.hasCredentials ? "•••••• (deixe vazio para manter)" : "Informe para configurar"}
                            value={creds[f.key] ?? ""}
                            onChange={e => setCreds({ ...creds, [f.key]: e.target.value })}
                          />
                          {f.hint ? <p className="font-mono text-[0.55rem] text-[#444] mt-1">{f.hint}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-2 flex gap-3">
                    <button type="button" className="btn-primary px-6 py-2" disabled={busy === p.id} onClick={() => save(p.id)}>
                      {busy === p.id ? "Salvando…" : "Salvar gateway"}
                    </button>
                    <button type="button" className="font-mono text-xs underline text-[#666]" onClick={() => setEdit(null)}>Cancelar</button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}
