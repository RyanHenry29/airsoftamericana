"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Coupon = {
  id: string;
  code: string;
  kind: "percentual" | "fixo" | "frete" | string;
  value: number;
  minOrderCents: number;
  maxUses: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
};

type FormState = {
  code: string;
  kind: string;
  value: number;
  minOrderCents: number;
  maxUses: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

const emptyForm: FormState = {
  code: "",
  kind: "percentual",
  value: 5,
  minOrderCents: 0,
  maxUses: "",
  startsAt: "",
  endsAt: "",
  active: true,
};

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function fmtValue(c: Coupon): string {
  if (c.kind === "percentual") return `${c.value}%`;
  if (c.kind === "fixo") return (c.value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (c.kind === "frete") return "Frete grátis";
  return String(c.value);
}

export default function CuponsPage() {
  const [items, setItems] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await adminJson<{ items?: Coupon[] }>("/api/admin/coupons");
      setItems(payload.items ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar cupons."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kindLabels = useMemo(() => ({
    percentual: "Percentual (%)",
    fixo: "Valor fixo (centavos)",
    frete: "Frete grátis",
  }), []);

  function formFrom(c: Coupon): FormState {
    return {
      code: c.code,
      kind: c.kind,
      value: c.value,
      minOrderCents: c.minOrderCents ?? 0,
      maxUses: c.maxUses == null ? "" : String(c.maxUses),
      startsAt: toDateInput(c.startsAt),
      endsAt: toDateInput(c.endsAt),
      active: !!c.active,
    };
  }

  function bodyFrom(f: FormState) {
    return {
      code: f.code.trim().toUpperCase(),
      kind: f.kind,
      value: Number(f.value),
      minOrderCents: Number(f.minOrderCents || 0),
      maxUses: f.maxUses.trim() === "" ? null : Number(f.maxUses),
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
      endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      active: f.active,
    };
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson("/api/admin/coupons", { method: "POST", body: JSON.stringify(bodyFrom(form)) });
      setForm(emptyForm);
      setNotice("Cupom criado.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao criar cupom."));
    } finally { setBusy(false); }
  }

  async function saveEdit(id: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/coupons/${id}`, { method: "PATCH", body: JSON.stringify(bodyFrom(form)) });
      setEditing(null);
      setNotice("Cupom atualizado.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao atualizar cupom."));
    } finally { setBusy(false); }
  }

  async function remove(c: Coupon) {
    if (!confirm(`Remover o cupom "${c.code}"?`)) return;
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/coupons/${c.id}`, { method: "DELETE" });
      setNotice("Cupom removido.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao remover cupom."));
    } finally { setBusy(false); }
  }

  async function toggleActive(c: Coupon) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/coupons/${c.id}`, { method: "PATCH", body: JSON.stringify({ active: !c.active }) });
      setNotice(c.active ? "Cupom desativado." : "Cupom ativado.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao atualizar cupom."));
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <p className="font-mono text-xs text-[#666]" role="status">Carregando cupons…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-8 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Cupons
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Crie, edite e desative cupons. Tipos: percentual, valor fixo (centavos) ou frete grátis.
        </p>
      </header>

      {error ? <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-6">{error}</p> : null}
      {notice ? <p role="status" className="text-[#8bcf16] font-mono text-xs font-bold mb-6">{notice}</p> : null}

      <form onSubmit={editing ? (e) => { e.preventDefault(); saveEdit(editing); } : create} className="border border-[#111] bg-[#0a0a0a] p-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-12">
        <div className="field">
          <label htmlFor="cp-code">Código</label>
          <input id="cp-code" className="input w-full" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="EX: PIX5" />
        </div>
        <div className="field">
          <label htmlFor="cp-kind">Tipo</label>
          <select id="cp-kind" className="select w-full" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value, value: e.target.value === "frete" ? 0 : form.value })}>
            {Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cp-value">{form.kind === "percentual" ? "Percentual (1-100)" : form.kind === "fixo" ? "Valor (centavos)" : "Valor (ignorado)"}</label>
          <input id="cp-value" className="input w-full" type="number" min={0} value={form.value} disabled={form.kind === "frete"} onChange={e => setForm({ ...form, value: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="cp-min">Pedido mínimo (centavos)</label>
          <input id="cp-min" className="input w-full" type="number" min={0} value={form.minOrderCents} onChange={e => setForm({ ...form, minOrderCents: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="cp-max">Máx. usos (vazio = ilimitado)</label>
          <input id="cp-max" className="input w-full" type="number" min={1} value={form.maxUses} onChange={e => setForm({ ...form, maxUses: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="cp-start">Início</label>
          <input id="cp-start" className="input w-full" type="datetime-local" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="cp-end">Fim</label>
          <input id="cp-end" className="input w-full" type="datetime-local" value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })} />
        </div>
        <div className="field flex items-end">
          <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
            Ativo
          </label>
        </div>
        <div className="md:col-span-4 flex items-end gap-3">
          <button type="submit" className="btn-primary px-6 py-2" disabled={busy}>{busy ? "Salvando…" : editing ? "Salvar alterações" : "Criar cupom"}</button>
          {editing ? <button type="button" className="font-mono text-xs underline text-[#666]" onClick={() => { setEditing(null); setForm(emptyForm); }}>Cancelar edição</button> : null}
        </div>
      </form>

      {items.length === 0 ? (
        <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
          <p className="text-[#666] font-mono text-xs">Nenhum cupom cadastrado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Mínimo</th>
                <th>Uso</th>
                <th>Vigência</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="group border-b border-[#111]">
                  <td className="p-3 font-mono text-sm font-bold text-white">{c.code}</td>
                  <td className="p-3 font-mono text-xs text-[#666]">{kindLabels[c.kind as keyof typeof kindLabels] ?? c.kind}</td>
                  <td className="p-3 font-mono text-sm text-white">{fmtValue(c)}</td>
                  <td className="p-3 font-mono text-xs text-[#666]">{c.minOrderCents ? (c.minOrderCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</td>
                  <td className="p-3 font-mono text-xs text-[#666]">{c.usedCount}{c.maxUses == null ? "" : ` / ${c.maxUses}`}</td>
                  <td className="p-3 font-mono text-[0.65rem] text-[#666]">
                    <div>{fmtDate(c.startsAt)}</div>
                    <div>{fmtDate(c.endsAt)}</div>
                  </td>
                  <td className="p-3">
                    <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${c.active ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#333] text-[#333]"}`}>
                      {c.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666]" onClick={() => { setEditing(c.id); setForm(formFrom(c)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Editar</button>
                      <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666]" onClick={() => toggleActive(c)} disabled={busy}>{c.active ? "Desativar" : "Ativar"}</button>
                      <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#dc2626]/40 text-[#dc2626]" onClick={() => remove(c)} disabled={busy}>Excluir</button>
                    </div>
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
