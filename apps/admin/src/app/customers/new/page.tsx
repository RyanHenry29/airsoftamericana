"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function NewCustomerPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({ name: "", email: "", password: "", cpf: "", phone: "", notes: "" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const token = localStorage.getItem("aa_admin_token");
    try {
      const res = await fetch(`${API_URL}/api/admin/customers`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        credentials: "include",
        body: JSON.stringify({
          name: data.name.trim(),
          email: data.email.trim().toLowerCase(),
          password: data.password || undefined,
          cpf: data.cpf.replace(/\D/g, "") || undefined,
          phone: data.phone.trim() || undefined,
          notes: data.notes.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "Falha ao cadastrar cliente.");
        return;
      }
      router.push("/customers");
      router.refresh();
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-12 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Novo cliente
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Cadastro manual pelo operador
        </p>
      </header>

      <form onSubmit={onSubmit} className="border border-[#111] bg-[#0a0a0a] p-8 max-w-xl grid grid-cols-1 gap-6" noValidate>
        <div className="field">
          <label htmlFor="name">Nome completo</label>
          <input id="name" className="input" required value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" className="input" required value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="password">Senha (opcional)</label>
          <input id="password" type="password" className="input" value={data.password} onChange={(e) => setData({ ...data, password: e.target.value })} placeholder="Deixe vazio se for só registrar" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field">
            <label htmlFor="cpf">CPF (opcional)</label>
            <input id="cpf" inputMode="numeric" className="input" value={data.cpf} onChange={(e) => setData({ ...data, cpf: e.target.value })} placeholder="00000000000" />
          </div>
          <div className="field">
            <label htmlFor="phone">Telefone (opcional)</label>
            <input id="phone" type="tel" className="input" value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="notes">Observações (opcional)</label>
          <input id="notes" className="input" value={data.notes} onChange={(e) => setData({ ...data, notes: e.target.value })} />
        </div>
        {error && (
          <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-4">{error}</p>
        )}
        <div className="flex gap-4">
          <button type="submit" className="btn-primary px-8 py-3" disabled={busy}>
            {busy ? "Cadastrando..." : "Cadastrar cliente"}
          </button>
          <Link href="/customers" className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] hover:text-[#8bcf16] transition-colors underline underline-offset-4">
            Cancelar
          </Link>
        </div>
      </form>
    </main>
  );
}
