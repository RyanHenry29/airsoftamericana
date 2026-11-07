"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Customer = { id: string; name: string; email: string; cpf?: string | null; phone?: string | null; createdAt?: string };

export default function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  useGateRedirect(failure);

  async function load(term = "") {
    setLoading(true);
    setError("");
    try {
      const path = term.trim()
        ? `/api/admin/customers?q=${encodeURIComponent(term.trim())}`
        : "/api/admin/customers";
      const json = await adminJson<{ items?: Customer[] }>(path);
      setItems(json.items ?? []);
      setFailure(null);
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar clientes."));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <div className="grid grid-cols-1 gap-4">
          <div className="h-24 bg-[#0a0a0a] border border-[#111]" />
          <div className="h-24 bg-[#0a0a0a] border border-[#111]" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="px-6 py-24 text-center">
        <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#dc2626] mb-6">
          ERR
        </div>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-6">
          Erro ao carregar
        </h1>
        <p className="text-[#666] font-mono text-xs mb-10 max-w-md mx-auto">{error}</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-12 border-b border-[#111] pb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
            Clientes
          </h1>
          <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
            Base de clientes da loja · {items.length} encontrado(s)
          </p>
        </div>
        <Link href="/customers/new" className="btn-primary px-8 py-3">
          NOVO CLIENTE
        </Link>
      </header>

      <form
        className="mb-10 flex gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
      >
        <input
          className="input flex-1"
          placeholder="Buscar por nome ou e-mail..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar clientes"
        />
        <button type="submit" className="btn-secondary px-6 py-3">
          Buscar
        </button>
      </form>

      {items.length === 0 ? (
        <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
          <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6 inline-block">
            0
          </div>
          <h2 className="font-display font-black text-3xl uppercase leading-none tracking-tighter text-white mb-4">
            Nenhum cliente ainda
          </h2>
          <p className="text-[#666] font-mono text-xs max-w-md mx-auto mb-8">
            Clientes aparecem aqui quando se cadastram na loja ou quando você cadastra manualmente.
          </p>
          <Link href="/customers/new" className="btn-primary px-8 py-3">
            CADASTRAR CLIENTE
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>CPF</th>
                <th>Telefone</th>
                <th>Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="group">
                  <td className="font-mono text-sm font-bold text-white">{c.name}</td>
                  <td className="font-mono text-sm text-white">{c.email}</td>
                  <td className="font-mono text-sm text-[#666]">{c.cpf ?? "—"}</td>
                  <td className="font-mono text-sm text-[#666]">{c.phone ?? "—"}</td>
                  <td className="font-mono text-sm text-[#666]">
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : "—"}
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
