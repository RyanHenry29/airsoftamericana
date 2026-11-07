"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Customer = { id: string; name: string; email: string; cpf?: string | null; phone?: string | null };

export function ContaArea() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    async function load() {
      // Sessão em cookie httpOnly — nada de token no localStorage.
      localStorage.removeItem("aa_customer_token");
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
          credentials: "include",
        });
        const json = (await res.json().catch(() => ({}))) as { customer?: Customer };
        if (res.ok && json.customer) setCustomer(json.customer);
      } catch {
        /* offline */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function logout() {
    localStorage.removeItem("aa_customer_token");
    await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 px-5">
        <div className="h-24 bg-[#0a0a0a] border border-[#111]" />
        <div className="h-40 bg-[#0a0a0a] border border-[#111]" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="px-5 py-24">
        <div className="text-center">
          <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6">
            AA
          </div>
          <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-6">
            Você ainda não entrou
          </h1>
          <p className="text-[#666] font-mono text-xs max-w-md mx-auto mb-10">
            Entre com sua conta para ver pedidos, endereços e comprar mais rápido.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/entrar" className="btn-primary px-8 py-3">
              ENTRAR
            </Link>
            <Link href="/cadastro" className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] hover:text-[#a6f51b] transition-colors underline underline-offset-4">
              Criar conta
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 space-y-10">
      <div className="border border-[#111] bg-[#0a0a0a] p-8">
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
          Minha conta
        </span>
        <h2 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white mb-2">
          {customer.name}
        </h2>
        <p className="text-[#666] font-mono text-xs mb-6">{customer.email}</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="border border-[#111] p-4">
            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] block mb-1">CPF</span>
            <span className="font-mono text-sm text-white">{customer.cpf ?? "—"}</span>
          </div>
          <div className="border border-[#111] p-4">
            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#333] block mb-1">Telefone</span>
            <span className="font-mono text-sm text-white">{customer.phone ?? "—"}</span>
          </div>
        </dl>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/catalogo" className="btn-primary px-8 py-3">
            CATÁLOGO
          </Link>
          <button
            type="button"
            onClick={logout}
            className="font-mono text-xs uppercase tracking-widest text-[#666] hover:text-[#8bcf16] transition-colors underline underline-offset-4"
          >
            Sair da conta
          </button>
        </div>
      </div>

      <div className="border border-[#111] bg-[#0a0a0a] p-8">
        <h3 className="font-display font-black text-xl md:text-2xl uppercase leading-none tracking-tighter text-white mb-4">
          Meus pedidos
        </h3>
        <p className="text-[#666] font-mono text-xs">
          Seus pedidos aparecem aqui assim que você comprar. Acompanhe status e rastreio na mesma tela.
        </p>
      </div>
    </div>
  );
}
