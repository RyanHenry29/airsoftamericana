// language: TSX, file: apps/store/src/app/components/AuthCentered.tsx, target: Next.js App Router
// Layout centralizado limpo para telas de acesso (esqueci senha, redefinir senha).
// Sem painel lateral de marca — só a marca compacta no topo, formulário centralizado.
"use client";

import { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

interface Props {
  children: ReactNode;
}

function BrandCompact() {
  return (
    <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="Airsoft Americana - Início">
      <Image src="/emblema.png" alt="" width={44} height={44} className="h-8 w-8 object-contain" priority />
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-wide text-foreground">AIRSOFT AMERICANA</span>
        <span className="block text-[11px] text-muted-foreground">Equipamentos e acessórios</span>
      </span>
    </Link>
  );
}

export function AuthCentered({ children }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-[440px]">
        {/* Brand compacta + voltar pra loja */}
        <div className="mb-8 flex items-center justify-between">
          <BrandCompact />
          <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft size={15} /> Voltar para a loja
          </Link>
        </div>

        {/* Formulário */}
        {children}

        {/* Rodapé LGPD */}
        <p className="mt-8 flex items-center justify-center gap-1.5 border-t border-border pt-6 text-xs text-muted-foreground/70">
          <ShieldCheck size={14} /> Dados protegidos conforme a LGPD
        </p>
      </div>
    </main>
  );
}