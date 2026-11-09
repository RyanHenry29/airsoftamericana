"use client";

import { useCallback, useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type InventoryItem = {
  id?: string;
  variantId: string;
  sku: string;
  name: string;
  physical: number;
  reserved: number;
  available: number;
  minQuantity: number;
};

type Movement = {
  id: string;
  variantId: string;
  type: string;
  quantity: number;
  beforePhysical?: number | null;
  afterPhysical?: number | null;
  beforeReserved?: number | null;
  afterReserved?: number | null;
  reason?: string | null;
  createdAt?: string;
};

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ variantId: "", type: "ajuste", quantity: 1, reason: "" });
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [inv, mov] = await Promise.all([
        adminJson<{ items?: InventoryItem[] }>("/api/admin/inventory"),
        adminJson<{ items?: Movement[] }>("/api/admin/inventory/movements?limit=50"),
      ]);
      setItems(inv.items ?? []);
      setMovements(mov.items ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar estoque."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!form.variantId) { setError("Selecione uma variante/SKU."); return; }
    if (!form.reason.trim() || form.reason.trim().length < 3) { setError("Informe o motivo (mín. 3 caracteres)."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson("/api/admin/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          variantId: form.variantId,
          type: form.type,
          quantity: Math.max(1, Math.round(Number(form.quantity) || 1)),
          reason: form.reason.trim(),
        }),
      });
      setNotice("Movimento de estoque registrado.");
      setForm((f) => ({ ...f, quantity: 1, reason: "" }));
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao registrar movimento."));
    } finally { setBusy(false); }
  }

  const low = items.filter((i) => i.available <= (i.minQuantity ?? 0));

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <p className="font-mono text-xs text-[#666]" role="status">Carregando estoque…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <div className="admin-section-head">
        <div>
          <span className="admin-section-head__kicker">Operação</span>
          <h1 className="admin-section-head__title">Estoque</h1>
          <p className="admin-section-head__subtitle">Saldo por variante, ajuste manual com motivo e histórico de movimentos. Disponível = físico − reservado.</p>
        </div>
      </div>

      {error ? (
        <p className="admin-notice admin-notice--err" role="alert">{error}</p>
      ) : null}
      {notice ? (
        <p className="admin-notice admin-notice--ok">{notice}</p>
      ) : null}

      {low.length > 0 ? (
        <div className="admin-notice admin-notice--err" role="alert">
          {low.length} item(ns) no mínimo ou abaixo
        </div>
      ) : null}

      <form onSubmit={submit} className="admin-form grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-12">
        <div className="field md:col-span-2">
          <label htmlFor="inv-variant">Variante / SKU</label>
          <select id="inv-variant" className="select w-full" required value={form.variantId} onChange={e => setForm({ ...form, variantId: e.target.value })}>
            <option value="">Selecione…</option>
            {items.map((i) => (
              <option key={i.variantId} value={i.variantId}>{i.sku} — {i.name} (disp. {i.available})</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inv-type">Tipo</label>
          <select id="inv-type" className="select w-full" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
            <option value="ajuste">Ajuste</option>
            <option value="transferencia">Transferência</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="inv-qty">Quantidade</label>
          <input id="inv-qty" className="input w-full" type="number" min={1} value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} />
        </div>
        <div className="field md:col-span-3">
          <label htmlFor="inv-reason">Motivo (obrigatório)</label>
          <input id="inv-reason" className="input w-full" required minLength={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Ex.: inventário físico, devolução, avaria" />
        </div>
        <div className="field">
          <button type="submit" className="btn-primary px-6 py-2 w-full" disabled={busy}>{busy ? "Registrando…" : "Registrar movimento"}</button>
        </div>
      </form>

      <section className="mb-12">
        <h2 className="admin-section-head__kicker" style={{ marginBottom: "0.5rem", display: "block" }}>Saldo por variante</h2>
        {items.length === 0 ? (
          <div className="admin-empty">
            <p className="text-[#666] font-mono text-xs">Nenhum item de estoque.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Variante</th>
                  <th>Físico</th>
                  <th>Reservado</th>
                  <th>Disponível</th>
                  <th>Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const isLow = i.available <= (i.minQuantity ?? 0);
                  return (
                    <tr key={i.variantId} className="border-b border-[#111]">
                      <td className="p-3 font-mono text-xs text-white">{i.sku}</td>
                      <td className="p-3 font-mono text-xs text-[#666]">{i.name}</td>
                      <td className="p-3 font-mono text-sm text-white">{i.physical}</td>
                      <td className="p-3 font-mono text-sm text-[#666]">{i.reserved}</td>
                      <td className={`p-3 font-mono text-sm font-bold ${isLow ? "text-[#dc2626]" : "text-[#8bcf16]"}`}>{i.available}</td>
                      <td className="p-3 font-mono text-xs text-[#666]">{i.minQuantity ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="admin-section-head__kicker" style={{ marginBottom: "0.5rem", display: "block" }}>Movimentos recentes</h2>
        {movements.length === 0 ? (
          <div className="admin-empty">
            <p className="text-[#666] font-mono text-xs">Nenhum movimento registrado.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Qtd.</th>
                  <th>Antes → Depois</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-[#111]">
                    <td className="p-3 font-mono text-[0.65rem] text-[#666]">{m.createdAt ? new Date(m.createdAt).toLocaleString("pt-BR") : "—"}</td>
                    <td className="p-3 font-mono text-xs uppercase text-white">{m.type}</td>
                    <td className="p-3 font-mono text-sm text-white">{m.quantity}</td>
                    <td className="p-3 font-mono text-xs text-[#666]">{m.beforePhysical ?? "—"} → {m.afterPhysical ?? "—"}</td>
                    <td className="p-3 font-mono text-xs text-[#666]">{m.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
