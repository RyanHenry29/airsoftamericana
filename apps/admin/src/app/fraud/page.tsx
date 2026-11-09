"use client";

import { useCallback, useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type AssessmentRow = {
  assessment: {
    id: string;
    orderId: string;
    score: number;
    level: string;
    action: string;
    reasons: unknown;
    autoDecision: boolean;
    reviewNote?: string | null;
    reviewedByUserId?: string | null;
    createdAt: string;
  };
  orderNumber?: string | null;
  orderStatus?: string | null;
  orderTotalCents?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
};

type Rule = { id?: string; key: string; name: string; enabled: boolean; weight: number; threshold?: number | null; action: string; updatedAt?: string };
type WatchItem = { id: string; kind: string; value: string; reason: string; expiresAt?: string | null; createdAt?: string };

function brl(cents: number | null | undefined) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function reasonsText(r: unknown): string {
  if (!r) return "—";
  if (Array.isArray(r)) return r.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ");
  if (typeof r === "string") return r;
  try { return JSON.stringify(r); } catch { return "—"; }
}

export default function FraudPage() {
  const [tab, setTab] = useState<"queue" | "rules" | "watchlist">("queue");
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [levelFilter, setLevelFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ id: string; note: string } | null>(null);
  const [ruleForm, setRuleForm] = useState<Rule>({ key: "", name: "", enabled: true, weight: 10, threshold: null, action: "soma" });
  const [watchForm, setWatchForm] = useState({ kind: "email", value: "", reason: "", expiresAt: "" });
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = levelFilter ? `?level=${encodeURIComponent(levelFilter)}` : "";
      const [a, r, w] = await Promise.all([
        adminJson<{ items?: AssessmentRow[] }>(`/api/admin/fraud/assessments${q}`),
        adminJson<{ items?: Rule[] }>("/api/admin/fraud/rules"),
        adminJson<{ items?: WatchItem[] }>("/api/admin/fraud/watchlist"),
      ]);
      setAssessments(a.items ?? []);
      setRules(r.items ?? []);
      setWatch(w.items ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar antifraude."));
    } finally {
      setLoading(false);
    }
  }, [levelFilter]);

  useEffect(() => { load(); }, [load]);

  async function doReview(action: "approve" | "reject" | "hold") {
    if (!review || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await adminJson<{ ok?: boolean; orderTransition?: { attempted: boolean; to?: string; ok?: boolean; reason?: string } }>(
        `/api/admin/fraud/assessments/${review.id}/review`,
        { method: "POST", body: JSON.stringify({ action, note: review.note.trim() || undefined, applyOrderTransition: true }) },
      );
      const t = res.orderTransition;
      const tMsg = t?.attempted ? (t.ok ? ` Pedido → ${t.to}.` : ` Pedido não alterado: ${t.reason ?? "transição inválida"}.`) : "";
      setNotice(`Revisão registrada (${action}).${tMsg}`);
      setReview(null);
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao registrar revisão."));
    } finally { setBusy(false); }
  }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const key = ruleForm.key.trim();
    if (!key) { setError("Informe a chave (key) da regra."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/fraud/rules/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: ruleForm.name.trim() || key,
          enabled: ruleForm.enabled,
          weight: Number(ruleForm.weight),
          threshold: ruleForm.threshold == null || ruleForm.threshold === ("" as unknown) ? null : Number(ruleForm.threshold),
          action: ruleForm.action,
        }),
      });
      setNotice("Regra salva.");
      setRuleForm({ key: "", name: "", enabled: true, weight: 10, threshold: null, action: "soma" });
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao salvar regra."));
    } finally { setBusy(false); }
  }

  async function addWatch(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!watchForm.value.trim() || watchForm.reason.trim().length < 3) { setError("Informe valor e motivo (mín. 3 caracteres)."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson("/api/admin/fraud/watchlist", {
        method: "POST",
        body: JSON.stringify({
          kind: watchForm.kind,
          value: watchForm.value.trim(),
          reason: watchForm.reason.trim(),
          expiresAt: watchForm.expiresAt ? new Date(watchForm.expiresAt).toISOString() : null,
        }),
      });
      setNotice("Item adicionado à watchlist.");
      setWatchForm({ kind: "email", value: "", reason: "", expiresAt: "" });
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao adicionar à watchlist."));
    } finally { setBusy(false); }
  }

  async function removeWatch(id: string) {
    if (!confirm("Remover este item da watchlist?") || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminJson(`/api/admin/fraud/watchlist/${id}`, { method: "DELETE" });
      setNotice("Item removido.");
      load();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao remover item."));
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <p className="font-mono text-xs text-[#666]" role="status">Carregando antifraude…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <div className="admin-section-head">
        <div>
          <span className="admin-section-head__kicker">Segurança</span>
          <h1 className="admin-section-head__title">Antifraude</h1>
          <p className="admin-section-head__subtitle">Fila de avaliações, revisão manual, regras de score e watchlist. Revisão pode aplicar transição no pedido quando válida.</p>
        </div>
      </div>

      {error ? (
        <p className="admin-notice admin-notice--err" role="alert">{error}</p>
      ) : null}
      {notice ? (
        <p className="admin-notice admin-notice--ok">{notice}</p>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-8">
        {(["queue", "rules", "watchlist"] as const).map((t) => (
          <button key={t} type="button" className={`font-mono text-[0.65rem] uppercase font-bold py-2 px-4 border ${tab === t ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#333] text-[#666]"}`} onClick={() => setTab(t)}>
            {t === "queue" ? "Avaliações" : t === "rules" ? "Regras" : "Watchlist"}
          </button>
        ))}
      </div>

      {tab === "queue" ? (
        <section>
          <div className="flex items-end gap-4 mb-4">
            <div className="field">
              <label htmlFor="fr-level" className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">Nível</label>
              <select id="fr-level" className="select" value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
                <option value="">Todos</option>
                <option value="baixo">Baixo</option>
                <option value="medio">Médio</option>
                <option value="alto">Alto</option>
              </select>
            </div>
          </div>

          {assessments.length === 0 ? (
            <div className="admin-empty">
              <p className="text-[#666] font-mono text-xs">Nenhuma avaliação encontrada{levelFilter ? " para este nível" : ""}.</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Score</th>
                    <th>Ação</th>
                    <th>Motivos</th>
                    <th>Revisão</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((row) => {
                    const a = row.assessment;
                    return (
                      <tr key={a.id}>
                        <td className="p-3">
                          <div className="font-mono text-sm font-bold text-white">#{row.orderNumber ?? a.orderId.slice(0, 8)}</div>
                          <div className="font-mono text-[0.6rem] text-[#666] mt-1">{brl(row.orderTotalCents)} · {row.orderStatus?.replace(/_/g, " ") ?? "—"}</div>
                          <div className="font-mono text-[0.55rem] text-[#444] mt-1">{new Date(a.createdAt).toLocaleString("pt-BR")}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-mono text-xs text-white">{row.customerName ?? "—"}</div>
                          <div className="font-mono text-[0.6rem] text-[#666]">{row.customerEmail ?? "—"}</div>
                        </td>
                        <td className="p-3">
                          <span className={`admin-badge ${a.level === "alto" ? "admin-badge--err" : a.level === "medio" ? "admin-badge--warn" : "admin-badge--ok"}`}>
                            {a.level} ({a.score})
                          </span>
                          {a.autoDecision ? <div className="font-mono text-[0.55rem] text-[#444] mt-1">auto</div> : <div className="font-mono text-[0.55rem] text-[#8bcf16] mt-1">revisado</div>}
                        </td>
                        <td className="p-3 font-mono text-xs text-[#999]">{a.action}</td>
                        <td className="p-3 font-mono text-[0.65rem] text-[#666] max-w-md">{reasonsText(a.reasons)}</td>
                        <td className="p-3">
                          <button type="button" className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#333] text-white" onClick={() => setReview({ id: a.id, note: a.reviewNote ?? "" })}>
                            Revisar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {review ? (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
              <div className="border border-[#111] bg-[#0a0a0a] p-6 max-w-lg w-full">
                <h3 className="font-display font-black text-xl uppercase text-white mb-4">Revisão antifraude</h3>
                <div className="field mb-4">
                  <label htmlFor="rv-note" className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-1">Nota (opcional)</label>
                  <textarea id="rv-note" className="input w-full min-h-[90px]" value={review.note} onChange={e => setReview({ ...review, note: e.target.value })} />
                </div>
                <p className="font-mono text-[0.6rem] text-[#666] mb-4">Aprovar tenta mover pedido para pagamento aprovado; rejeitar tenta cancelar (quando a transição for válida).</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className="font-mono text-[0.65rem] uppercase font-bold py-2 px-4 border border-[#8bcf16] text-[#8bcf16]" onClick={() => doReview("approve")}>Aprovar</button>
                  <button type="button" disabled={busy} className="font-mono text-[0.65rem] uppercase font-bold py-2 px-4 border border-[#dc2626] text-[#dc2626]" onClick={() => doReview("reject")}>Rejeitar</button>
                  <button type="button" disabled={busy} className="font-mono text-[0.65rem] uppercase font-bold py-2 px-4 border border-[#333] text-[#999]" onClick={() => doReview("hold")}>Manter em análise</button>
                  <button type="button" className="font-mono text-xs underline text-[#666] ml-auto" onClick={() => setReview(null)}>Cancelar</button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "rules" ? (
        <section>
          <form onSubmit={saveRule} className="admin-form grid grid-cols-1 md:grid-cols-3 gap-4 items-end mb-8">
            <div className="field">
              <label htmlFor="rl-key">Chave (key)</label>
              <input id="rl-key" className="input w-full" required value={ruleForm.key} onChange={e => setRuleForm({ ...ruleForm, key: e.target.value })} placeholder="ex: high_value" />
            </div>
            <div className="field md:col-span-2">
              <label htmlFor="rl-name">Nome</label>
              <input id="rl-name" className="input w-full" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="rl-weight">Peso</label>
              <input id="rl-weight" className="input w-full" type="number" min={0} max={100} value={ruleForm.weight} onChange={e => setRuleForm({ ...ruleForm, weight: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="rl-thr">Threshold (opcional)</label>
              <input id="rl-thr" className="input w-full" type="number" value={ruleForm.threshold ?? ""} onChange={e => setRuleForm({ ...ruleForm, threshold: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="rl-action">Ação</label>
              <select id="rl-action" className="select w-full" value={ruleForm.action} onChange={e => setRuleForm({ ...ruleForm, action: e.target.value })}>
                <option value="soma">soma</option>
                <option value="flag">flag</option>
                <option value="block">block</option>
                <option value="review">review</option>
              </select>
            </div>
            <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2 md:col-span-2">
              <input type="checkbox" checked={ruleForm.enabled} onChange={e => setRuleForm({ ...ruleForm, enabled: e.target.checked })} />
              Ativa
            </label>
            <div className="field">
              <button type="submit" className="btn-primary px-6 py-2 w-full" disabled={busy}>{busy ? "Salvando…" : "Salvar regra"}</button>
            </div>
          </form>

          {rules.length === 0 ? (
            <div className="admin-empty">
              <p className="text-[#666] font-mono text-xs">Nenhuma regra cadastrada. O motor pode usar regras padrão do serviço se aplicável.</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Key</th><th>Nome</th><th>Peso</th><th>Threshold</th><th>Ação</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.key}>
                      <td className="p-3 font-mono text-xs text-white">{r.key}</td>
                      <td className="p-3 font-mono text-xs text-[#999]">{r.name}</td>
                      <td className="p-3 font-mono text-sm text-white">{r.weight}</td>
                      <td className="p-3 font-mono text-xs text-[#666]">{r.threshold ?? "—"}</td>
                      <td className="p-3 font-mono text-xs text-[#666]">{r.action}</td>
                      <td className="p-3"><span className={`admin-badge ${r.enabled ? "admin-badge--ok" : "admin-badge--err"}`}>{r.enabled ? "Ativa" : "Inativa"}</span></td>
                      <td className="p-3"><button type="button" className="font-mono text-[0.6rem] uppercase border border-[#333] text-[#999] py-1 px-2" onClick={() => setRuleForm({ key: r.key, name: r.name, enabled: r.enabled, weight: r.weight, threshold: r.threshold ?? null, action: r.action })}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === "watchlist" ? (
        <section>
          <form onSubmit={addWatch} className="admin-form grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-8">
            <div className="field">
              <label htmlFor="wl-kind">Tipo</label>
              <select id="wl-kind" className="select w-full" value={watchForm.kind} onChange={e => setWatchForm({ ...watchForm, kind: e.target.value })}>
                <option value="email">Email</option>
                <option value="cpf">CPF</option>
                <option value="ip">IP</option>
                <option value="phone">Telefone</option>
                <option value="device">Dispositivo</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="wl-val">Valor</label>
              <input id="wl-val" className="input w-full" required value={watchForm.value} onChange={e => setWatchForm({ ...watchForm, value: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="wl-exp">Expira em (opcional)</label>
              <input id="wl-exp" className="input w-full" type="datetime-local" value={watchForm.expiresAt} onChange={e => setWatchForm({ ...watchForm, expiresAt: e.target.value })} />
            </div>
            <div className="field md:col-span-3">
              <label htmlFor="wl-reason">Motivo</label>
              <input id="wl-reason" className="input w-full" required minLength={3} value={watchForm.reason} onChange={e => setWatchForm({ ...watchForm, reason: e.target.value })} />
            </div>
            <div className="field">
              <button type="submit" className="btn-primary px-6 py-2 w-full" disabled={busy}>{busy ? "Salvando…" : "Adicionar"}</button>
            </div>
          </form>

          {watch.length === 0 ? (
            <div className="admin-empty">
              <p className="text-[#666] font-mono text-xs">Watchlist vazia.</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Tipo</th><th>Valor</th><th>Motivo</th><th>Expira</th><th></th></tr>
                </thead>
                <tbody>
                  {watch.map((w) => (
                    <tr key={w.id}>
                      <td className="p-3 font-mono text-xs uppercase text-white">{w.kind}</td>
                      <td className="p-3 font-mono text-xs text-[#999]">{w.value}</td>
                      <td className="p-3 font-mono text-xs text-[#666]">{w.reason}</td>
                      <td className="p-3 font-mono text-[0.65rem] text-[#666]">{w.expiresAt ? new Date(w.expiresAt).toLocaleString("pt-BR") : "—"}</td>
                      <td className="p-3"><button type="button" disabled={busy} className="font-mono text-[0.6rem] uppercase border border-[#dc2626]/40 text-[#dc2626] py-1 px-2" onClick={() => removeWatch(w.id)}>Remover</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
