"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL, adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Chargeback = {
  id: string;
  orderId: string;
  paymentId: string;
  provider: string;
  providerDisputeId: string;
  status: string;
  amountCents: number;
  reason?: string | null;
  respondBy?: string | null;
  notifiedAt?: string | null;
  resolvedAt?: string | null;
  note?: string | null;
};

type Evidence = { id: string; kind: string; label: string; fileUrl?: string | null; content?: unknown; createdAt?: string };

type Detail = {
  chargeback: Chargeback;
  evidences: Evidence[];
  order?: { id: string; number: string; status: string; totalCents: number; createdAt: string } | null;
  items?: { sku: string; name: string; quantity: number; unitPriceCents: number }[];
  customer?: { name: string; email: string; cpf?: string | null } | null;
  assessment?: { score: number; level: string; action: string } | null;
};

const STATUSES = ["notificado", "aguardando_analise", "documentacao_pendente", "defesa_preparada", "defesa_enviada", "em_analise", "ganho", "perdido", "encerrado"];

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ChargebacksPage() {
  const [items, setItems] = useState<Chargeback[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [evForm, setEvForm] = useState({ kind: "documento", label: "", fileUrl: "" });
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const payload = await adminJson<{ items?: Chargeback[] }>(`/api/admin/chargebacks${q}`);
      setItems(payload.items ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar chargebacks."));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(id: string) {
    setError(""); setNotice("");
    try {
      const d = await adminJson<Detail>(`/api/admin/chargebacks/${id}`);
      setDetail(d);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar detalhe do chargeback."));
    }
  }

  async function updateStatus(id: string, status: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const d = await adminJson<Detail>(`/api/admin/chargebacks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setDetail(d);
      setNotice("Status atualizado.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao atualizar status."));
    } finally { setBusy(false); }
  }

  async function addEvidence(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || busy) return;
    if (!evForm.label.trim()) { setError("Informe o rótulo da evidência."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const d = await adminJson<Detail>(`/api/admin/chargebacks/${detail.chargeback.id}/evidence`, {
        method: "POST",
        body: JSON.stringify({ kind: evForm.kind, label: evForm.label.trim(), fileUrl: evForm.fileUrl.trim() || undefined }),
      });
      setDetail(d);
      setEvForm({ kind: "documento", label: "", fileUrl: "" });
      setNotice("Evidência adicionada.");
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao adicionar evidência."));
    } finally { setBusy(false); }
  }

  async function exportPdf(id: string) {
    setError(""); setNotice("");
    try {
      const res = await fetch(`${API_URL}/api/admin/chargebacks/${id}/export`, { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any)?.error?.message || `Falha ao exportar (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chargeback-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice("PDF de evidências exportado.");
    } catch (e) {
      setError(messageOf(e, "Falha ao exportar PDF."));
    }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <p className="font-mono text-xs text-[#666]" role="status">Carregando chargebacks…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-8 border-b border-[#111] pb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">Chargebacks</h1>
          <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
            Disputas notificadas por webhook/gateway. Atualize status, registre evidências e exporte PDF para contestação.
          </p>
        </div>
        <div className="field">
          <label htmlFor="cb-filter" className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">Filtrar status</label>
          <select id="cb-filter" className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      </header>

      {error ? <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-6">{error}</p> : null}
      {notice ? <p role="status" className="text-[#8bcf16] font-mono text-xs font-bold mb-6">{notice}</p> : null}

      {items.length === 0 ? (
        <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
          <p className="text-[#666] font-mono text-xs">Nenhum chargeback registrado{statusFilter ? " para este filtro" : ""}.</p>
        </div>
      ) : (
        <div className="overflow-x-auto mb-10">
          <table>
            <thead>
              <tr>
                <th>Disputa</th>
                <th>Pedido</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Prazo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-[#111]">
                  <td className="p-3">
                    <div className="font-mono text-xs text-white">{c.provider} · {c.providerDisputeId}</div>
                    <div className="font-mono text-[0.6rem] text-[#444] mt-1">{c.reason || "—"}</div>
                  </td>
                  <td className="p-3 font-mono text-xs text-[#666]">{c.orderId.slice(0, 8)}…</td>
                  <td className="p-3 font-mono text-sm font-bold text-white">{brl(c.amountCents)}</td>
                  <td className="p-3">
                    <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${c.status === "ganho" ? "border-[#8bcf16] text-[#8bcf16]" : c.status === "perdido" ? "border-[#dc2626] text-[#dc2626]" : "border-[#333] text-[#999]"}`}>
                      {c.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-[0.65rem] text-[#666]">{c.respondBy ? new Date(c.respondBy).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#333] text-white" onClick={() => openDetail(c.id)}>Detalhar</button>
                      <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#8bcf16]/50 text-[#8bcf16]" onClick={() => exportPdf(c.id)}>PDF</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail ? (
        <section className="border border-[#111] bg-[#0a0a0a] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="font-display font-black text-2xl uppercase text-white">Disputa {detail.chargeback.providerDisputeId}</h2>
              <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-1">
                Pedido {detail.order?.number ?? detail.chargeback.orderId} · {brl(detail.chargeback.amountCents)} · {detail.chargeback.provider}
              </p>
            </div>
            <button type="button" className="font-mono text-xs underline text-[#666]" onClick={() => setDetail(null)}>Fechar</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="border border-[#111] p-4">
              <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">Cliente</span>
              <p className="font-mono text-xs text-white">{detail.customer?.name ?? "—"}</p>
              <p className="font-mono text-[0.65rem] text-[#666]">{detail.customer?.email ?? "—"}</p>
            </div>
            <div className="border border-[#111] p-4">
              <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">Antifraude (pedido)</span>
              <p className="font-mono text-xs text-white">{detail.assessment ? `${detail.assessment.level.toUpperCase()} (${detail.assessment.score}) · ${detail.assessment.action}` : "Sem avaliação"}</p>
            </div>
            <div className="border border-[#111] p-4">
              <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">Prazo de resposta</span>
              <p className="font-mono text-xs text-white">{detail.chargeback.respondBy ? new Date(detail.chargeback.respondBy).toLocaleString("pt-BR") : "Não informado pelo provedor"}</p>
            </div>
          </div>

          <div className="mb-6">
            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Atualizar status</span>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button key={s} type="button" disabled={busy || detail.chargeback.status === s} className={`font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border ${detail.chargeback.status === s ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#333] text-[#666]"}`} onClick={() => updateStatus(detail.chargeback.id, s)}>
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-display font-black text-lg uppercase text-white mb-3">Evidências ({detail.evidences.length})</h3>
            {detail.evidences.length === 0 ? (
              <p className="font-mono text-xs text-[#666]">Nenhuma evidência registrada.</p>
            ) : (
              <ul className="space-y-2 mb-4">
                {detail.evidences.map((ev) => (
                  <li key={ev.id} className="border border-[#111] p-3 font-mono text-xs text-[#999]">
                    <span className="text-white font-bold">{ev.label}</span> · {ev.kind} {ev.fileUrl ? `· ${ev.fileUrl}` : ""}
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addEvidence} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end border border-[#111] p-4">
              <div className="field">
                <label htmlFor="ev-kind" className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">Tipo</label>
                <select id="ev-kind" className="select w-full" value={evForm.kind} onChange={e => setEvForm({ ...evForm, kind: e.target.value })}>
                  <option value="documento">Documento</option>
                  <option value="rastreio">Rastreio</option>
                  <option value="comprovante">Comprovante</option>
                  <option value="atendimento">Atendimento</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div className="field md:col-span-2">
                <label htmlFor="ev-label" className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">Rótulo</label>
                <input id="ev-label" className="input w-full" required value={evForm.label} onChange={e => setEvForm({ ...evForm, label: e.target.value })} placeholder="Ex.: Comprovante de entrega Correios" />
              </div>
              <div className="field">
                <label htmlFor="ev-url" className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">URL arquivo (opcional)</label>
                <input id="ev-url" className="input w-full" value={evForm.fileUrl} onChange={e => setEvForm({ ...evForm, fileUrl: e.target.value })} placeholder="https://…" />
              </div>
              <div className="md:col-span-4">
                <button type="submit" className="btn-primary px-5 py-2" disabled={busy}>{busy ? "Salvando…" : "Adicionar evidência"}</button>
                <button type="button" className="font-mono text-xs underline text-[#8bcf16] ml-4" onClick={() => exportPdf(detail.chargeback.id)}>Exportar PDF</button>
              </div>
            </form>
          </div>

          {detail.items?.length ? (
            <div>
              <h3 className="font-display font-black text-lg uppercase text-white mb-3">Itens do pedido</h3>
              <ul className="font-mono text-xs text-[#999] space-y-1">
                {detail.items.map((it, i) => (
                  <li key={i}>{it.quantity}x {it.sku} — {it.name} ({brl(it.unitPriceCents)})</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
