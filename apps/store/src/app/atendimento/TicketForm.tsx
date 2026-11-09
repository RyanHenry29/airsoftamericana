// language: TSX, file: apps/store/src/app/atendimento/TicketForm.tsx, target: Next.js App Router
// Formulário de chamado de atendimento — grava ticket real na API.
"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

const API_URL = "";

export function TicketForm() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/store/tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "Não foi possível abrir o chamado.");
        return;
      }
      setDone(true);
      setForm({ name: "", email: "", subject: "", message: "" });
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="ticket__done">
        <CheckCircle2 size={22} />
        <div>
          <strong>Chamado aberto</strong>
          <span>Recebemos seu contato e respondemos pelo e-mail informado.</span>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setDone(false)}>
          Abrir outro chamado
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="ticket">
      <div className="ticket__row">
        <div>
          <label htmlFor="t-name">Nome</label>
          <input
            id="t-name"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="t-email">E-mail</label>
          <input
            id="t-email"
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <label htmlFor="t-subject">Assunto</label>
        <input
          id="t-subject"
          value={form.subject}
          onChange={(e) => update("subject", e.target.value)}
          placeholder="Dúvida sobre frete, troca, pagamento…"
          required
        />
      </div>
      <div>
        <label htmlFor="t-message">Mensagem</label>
        <textarea
          id="t-message"
          value={form.message}
          onChange={(e) => update("message", e.target.value)}
          rows={5}
          required
        />
      </div>
      {error && <p className="track__error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        Abrir chamado
      </button>
    </form>
  );
}
