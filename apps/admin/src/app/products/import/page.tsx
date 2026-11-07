"use client";

import { useRef, useState } from "react";
import { adminFetch, messageOf } from "../../../lib/api";
import { useGateRedirect } from "../../../lib/useGate";

type RowMsg = { line: number; field?: string; code: string; message: string; value?: string };
type PreviewRow = { line: number; action: string; sku: string; slug: string; name: string; condicao: string; priceCents: number; stock: number; errors: RowMsg[]; warnings: string[] };
type Preview = {
  checksum: string;
  header: string[];
  totalLines: number;
  valid: number;
  invalid: number;
  wouldCreate: number;
  wouldUpdate: number;
  rejected: number;
  errors: RowMsg[];
  warnings: string[];
  rows: PreviewRow[];
};
type ApplyResult = { checksum: string; created: number; updated: number; rejected: number; errors: RowMsg[]; warnings: string[] };

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ImportCsvPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [stage, setStage] = useState<"idle" | "reading" | "previewing" | "ready" | "applying" | "done" | "error">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [msg, setMsg] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useGateRedirect(failure);

  function reset() {
    setFileName(""); setFileText(""); setStage("idle"); setPreview(null); setResult(null); setFailure(null); setMsg(""); setConfirmed(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFailure(null); setMsg(""); setPreview(null); setResult(null); setConfirmed(false);
    if (f.size > 2 * 1024 * 1024) { setStage("error"); setMsg("Arquivo acima do limite (2 MiB)."); return; }
    const ext = (f.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    if (ext && ![".csv", ".txt"].includes(ext)) { setStage("error"); setMsg(`Extensão não permitida: ${ext}. Use .csv ou .txt.`); return; }
    setStage("reading"); setFileName(f.name);
    const text = await f.text();
    setFileText(text);
    setStage("previewing");
    try {
      const res = await adminFetch("/api/admin/catalog/import/preview", { method: "POST", body: JSON.stringify({ file: text, filename: f.name, mime: f.type || "" }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) { setStage("error"); setMsg(messageOf(Object.assign(new Error(), { status: 403, code: "forbidden", message: (json as any)?.error?.message, name: "ApiError" }) as any, "Sem permissão.")); setFailure(json); }
        else if (res.status === 413) { setStage("error"); setMsg((json as any)?.errors?.[0]?.message || "Arquivo acima do limite."); }
        else { setStage("error"); setMsg((json as any)?.errors?.[0]?.message || (json as any)?.error?.message || "Falha na pré-visualização."); }
        setPreview(json as Preview);
        return;
      }
      setPreview(json as Preview);
      const pv = json as Preview;
      const hasHard = pv.errors?.some((er) => ["file_too_large","invalid_extension","invalid_mime","empty_file","missing_header"].includes(er.code));
      setStage(hasHard ? "error" : "ready");
      if (hasHard) setMsg(pv.errors?.[0]?.message || "Arquivo inválido.");
    } catch (err) {
      setStage("error"); setMsg(messageOf(err, "Erro de conexão ao gerar preview."));
    }
  }

  async function apply() {
    if (!preview || !fileText || stage === "applying") return;
    if (!confirmed) { setMsg("Marque a confirmação explícita antes de aplicar."); return; }
    setStage("applying"); setMsg(""); setFailure(null);
    try {
      const res = await adminFetch("/api/admin/catalog/import/apply", { method: "POST", body: JSON.stringify({ file: fileText, filename: fileName, checksum: preview.checksum }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) { setStage("ready"); setMsg("Sem permissão para aplicar a importação."); setFailure(json); return; }
        if (res.status === 409) { setStage("error"); setMsg("O arquivo mudou desde a pré-visualização (checksum). Gere um novo preview."); setResult(json as ApplyResult); return; }
        if (res.status === 413) { setStage("error"); setMsg("Arquivo acima do limite."); return; }
        setStage("ready"); setMsg((json as any)?.errors?.[0]?.message || (json as any)?.error?.message || "Falha na aplicação; verifique os erros.");
        setResult(json as ApplyResult);
        return;
      }
      setResult(json as ApplyResult);
      setStage("done");
    } catch (err) {
      setStage("ready"); setMsg(messageOf(err, "Erro de conexão ao aplicar. Nenhuma alteração parcial deve ter sido gravada (transação)."));
    }
  }

  const busy = stage === "reading" || stage === "previewing" || stage === "applying";

  return (
    <main className="px-6 pb-24">
      <header className="mb-12 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">Importar CSV</h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">Duas etapas: pré-visualização (sem gravar) → confirmação explícita → aplicação transacional</p>
      </header>

      <section className="border border-[#111] bg-[#0a0a0a] p-8 max-w-4xl grid gap-6">
        <div className="field">
          <label htmlFor="csvfile">Arquivo CSV (UTF-8, .csv/.txt, máx. 2 MiB)</label>
          <input id="csvfile" ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} disabled={busy} className="input" />
          <p className="text-[#666] font-mono text-[0.6rem] mt-2">Cabeçalho obrigatório: slug;nome;sku;preco;category_slug (opcionais: brand_slug, condicao, estoque). Use dados próprios/DEMO.</p>
        </div>

        {stage === "reading" || stage === "previewing" ? (
          <p className="font-mono text-xs text-[#8bcf16]" role="status" aria-live="polite">Lendo e validando arquivo…</p>
        ) : null}

        {msg && <p role="alert" className={`font-mono text-xs font-bold ${stage === "done" ? "text-[#8bcf16]" : "text-[#dc2626]"}`}>{msg}</p>}

        {preview && !["file_too_large","invalid_extension","invalid_mime","empty_file","missing_header"].some(c => preview.errors?.some(e => e.code === c)) && (
          <div className="grid gap-4">
            <h2 className="font-display font-black text-xl text-white uppercase">Resumo da pré-visualização</h2>
            <p className="font-mono text-[0.65rem] text-[#666]">Arquivo: {fileName} · checksum <span className="text-white">{preview.checksum.slice(0, 12)}…</span> · nada gravado ainda</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ["Válidas", preview.valid], ["Inválidas", preview.invalid], ["Criar", preview.wouldCreate], ["Atualizar (SKU)", preview.wouldUpdate],
              ].map(([l,v]) => (
                <div key={String(l)} className="border border-[#111] p-3"><div className="font-mono text-[0.6rem] text-[#666] uppercase">{l}</div><div className="font-display font-black text-2xl text-white">{v as number}</div></div>
              ))}
            </div>
            {preview.warnings?.length ? (
              <div><h3 className="font-mono text-[0.65rem] uppercase text-[#666] mb-2">Avisos</h3><ul className="text-xs text-[#999] font-mono grid gap-1">{preview.warnings.slice(0, 20).map((w,i)=><li key={i}>• {w}</li>)}</ul></div>
            ) : null}
            {preview.errors?.length ? (
              <div><h3 className="font-mono text-[0.65rem] uppercase text-[#dc2626] mb-2">Erros por linha ({preview.errors.length})</h3>
                <ul className="text-xs font-mono grid gap-1 max-h-64 overflow-auto border border-[#111] p-3">
                  {preview.errors.map((e,i)=><li key={i} className="text-[#dc2626]">Linha {e.line}{e.field?` · ${e.field}`:""}: {e.message}{e.value?` (${e.value})`:""}</li>)}
                </ul>
              </div>
            ) : null}
            {preview.rows?.length ? (
              <div className="overflow-x-auto"><table><thead><tr><th>Linha</th><th>Ação</th><th>SKU</th><th>Nome</th><th>Condição</th><th>Preço</th><th>Estoque</th></tr></thead>
                <tbody>{preview.rows.slice(0, 50).map(r=>(
                  <tr key={r.line}><td>{r.line}</td><td className={r.action==='error'?'text-[#dc2626]':r.action==='update'?'text-[#f59e0b]':'text-[#8bcf16]'}>{r.action==='create'?'criar':r.action==='update'?'atualizar (SKU)':'erro'}</td><td className="font-mono text-xs">{r.sku}</td><td>{r.name}</td><td>{r.condicao}</td><td>{brl(r.priceCents)}</td><td>{r.stock}</td></tr>
                ))}</tbody></table></div>
            ) : null}

            {stage === "ready" && preview.invalid === 0 && preview.valid > 0 && (
              <div className="border border-[#111] p-4 grid gap-3">
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="accent-[#8bcf16] mt-1" /> <span>Confirmo a aplicação desta importação (checksum verificado). Linhas válidas serão gravadas em transação; em falha, rollback total.</span></label>
                <div className="flex gap-4"><button type="button" className="btn-primary px-8 py-3" onClick={apply} disabled={busy || !confirmed}>{busy ? "Aplicando…" : "Confirmar e aplicar"}</button><button type="button" className="font-mono text-[0.65rem] uppercase text-[#666] underline" onClick={reset} disabled={busy}>Cancelar</button></div>
              </div>
            )}
            {stage === "ready" && preview.invalid > 0 && (
              <p className="text-[#dc2626] font-mono text-xs">Corrija os erros no arquivo e gere um novo preview antes de aplicar. Nenhuma alteração foi gravada.</p>
            )}
          </div>
        )}

        {stage === "done" && result && (
          <div className="border border-[#8bcf16]/30 bg-[#8bcf16]/5 p-6 grid gap-2" role="status">
            <h2 className="font-display font-black text-xl text-white uppercase">Importação aplicada</h2>
            <p className="font-mono text-xs text-[#8bcf16]">Criados: {result.created} · Atualizados: {result.updated} · Rejeitados: {result.rejected}</p>
            <button type="button" className="btn-primary px-6 py-2 mt-2 w-fit" onClick={reset}>Nova importação</button>
          </div>
        )}

        {stage === "error" && preview?.errors?.length ? (
          <div className="grid gap-2"><ul className="text-xs font-mono grid gap-1">{preview.errors.slice(0,15).map((e,i)=><li key={i} className="text-[#dc2626]">{e.message}</li>)}</ul><button type="button" className="font-mono text-[0.65rem] uppercase text-[#666] underline w-fit" onClick={reset}>Tentar outro arquivo</button></div>
        ) : null}
      </section>
    </main>
  );
}
