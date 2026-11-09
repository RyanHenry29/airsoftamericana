"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldCheck, User, Mail, IdCard, Phone, ArrowRight, LogOut } from "lucide-react";

const API_URL =
  "";

type Customer = { id: string; name: string; email: string; cpf?: string | null; phone?: string | null };

export function ContaArea() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    async function load() {
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
      <div className="grid grid-cols-1 gap-3 px-5">
        <div className="h-20 bg-[#0a0a0a] border border-[#111]" />
        <div className="h-40 bg-[#0a0a0a] border border-[#111]" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="px-5 py-24 text-center">
        <div className="font-mono font-black text-5xl uppercase tracking-tighter text-[#8bcf16] mb-4">
          AA
        </div>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-3">
          Você ainda não entrou
        </h1>
        <p className="text-[#666] font-mono text-[0.65rem] uppercase tracking-widest max-w-md mx-auto mb-10">
          Entre com sua conta para ver pedidos, endereços e comprar mais rápido.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <Link href="/entrar" className="btn-primary px-8 py-3 font-display font-black uppercase tracking-tighter text-[0.7rem]">
            ENTRAR
          </Link>
          <Link href="/cadastro" className="font-mono text-[0.6rem] uppercase tracking-widest text-[#8bcf16] hover:text-[#a6f51b] transition-colors underline underline-offset-4">
            Criar conta
          </Link>
        </div>
      </div>
    );
  }

  const initials = customer.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="px-5 space-y-6">
      {/* Barra de identidade */}
      <div className="border-b border-[#111] pb-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 border border-[#111] bg-[#0a0a0a] flex items-center justify-center font-display font-black text-xl text-[#8bcf16] uppercase">
            {initials}
          </div>
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-widest text-[#8bcf16]">MINHA CONTA</p>
            <p className="font-display font-black text-2xl md:text-3xl uppercase leading-none tracking-tighter text-white">
              {customer.name}
            </p>
            <p className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] mt-1">
              {customer.email}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-l border-[#111] pl-4">
          <div className="flex flex-col items-end gap-1">
            <span className="font-mono text-[0.55rem] uppercase tracking-widest text-[#333]">Cadastro</span>
            <span className="font-mono text-sm font-bold text-white">{new Date().toLocaleDateString("pt-BR")}</span>
          </div>
        </div>
      </div>

      {/* Dados cadastrais — grade densa */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-[#111] bg-[#0a0a0a] p-4">
          <span className="font-mono text-[0.55rem] uppercase tracking-widest text-[#333] block mb-2">E-mail</span>
          <p className="font-mono text-sm font-bold text-white break-all">{customer.email}</p>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-4">
          <span className="font-mono text-[0.55rem] uppercase tracking-widest text-[#333] block mb-2">CPF</span>
          <p className="font-mono text-sm font-bold text-white">{customer.cpf ?? "—"}</p>
        </div>
        <div className="border border-[#111] bg-[#0a0a0a] p-4">
          <span className="font-mono text-[0.55rem] uppercase tracking-widest text-[#333] block mb-2">Telefone</span>
          <p className="font-mono text-sm font-bold text-white">{customer.phone ?? "—"}</p>
        </div>
      </div>

      {/* Ações */}
      <div className="border border-[#111] bg-[#0a0a0a] p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} strokeWidth={2} className="text-[#8bcf16]" aria-hidden="true" />
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666]">Dados guardados conforme a LGPD</span>
        </div>
        <div className="flex gap-3">
          <Link href="/catalogo" className="btn-primary px-8 py-2.5 font-display font-black uppercase tracking-tighter text-[0.7rem]">
            CATÁLOGO
          </Link>
          <button
            type="button"
            onClick={logout}
            className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] hover:text-[#dc2626] transition-colors flex items-center gap-1.5"
          >
            <LogOut size={14} strokeWidth={2} aria-hidden="true" />
            SAIR DA CONTA
          </button>
        </div>
      </div>

      {/* Meus pedidos (placeholder funcional) */}
      <div className="border border-[#111] bg-[#0a0a0a] p-4">
        <div className="flex justify-between items-center mb-3">
          <span className="font-mono text-[0.55rem] uppercase tracking-widest text-[#333]">Meus pedidos</span>
          <Link href="/rastreamento" className="font-mono text-[0.55rem] uppercase tracking-widest text-[#8bcf16] hover:text-[#a6f51b] transition-colors underline underline-offset-2">
            Acompanhar
          </Link>
        </div>
        <p className="text-[#666] font-mono text-[0.6rem] uppercase tracking-widest">
          Seus pedidos aparecem aqui assim que você comprar. Acompanhe status e rastreio na mesma tela.
        </p>
      </div>
    </div>
  );
}
