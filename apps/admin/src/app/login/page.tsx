import Image from "next/image";
import { Suspense } from "react";
import { AdminLoginForm } from "./AdminLoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[#000] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
        {/* Lado esquerdo - Branding */}
        <section className="hidden lg:flex flex-col justify-between border border-[#111] p-10 bg-black">
          <div>
            <Image
              src="/logo.png"
              alt="Airsoft Americana"
              width={56}
              height={56}
              className="h-14 w-14 object-contain"
            />
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#666] mt-6">
              Painel de gestão
            </p>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight mt-2">
              Airsoft <span className="text-[#8bcf16]">Americana</span>
            </h1>
            <p className="mt-4 text-[#666] max-w-md">
              Acesso restrito. Identidade tática, operação profissional.
            </p>
          </div>
          <p className="font-mono text-xs text-[#333] uppercase tracking-[0.14em]">
            www.airsoftamericana.com.br
          </p>
        </section>

        {/* Lado direito - Formulario */}
        <section className="bg-[#000] p-8 md:p-10 border border-[#111]">
          <div className="max-w-sm mx-auto w-full">
            <Image
              src="/logo.png"
              alt="Airsoft Americana"
              width={56}
              height={56}
              className="h-14 w-14 object-contain mx-auto lg:hidden"
            />
            <h2 className="text-2xl font-black mt-4 mb-1 text-center text-white uppercase">
              Acesso ao Painel
            </h2>
            <p className="text-center text-[#666] mb-8 font-mono text-xs uppercase tracking-widest">
              Identifique-se para continuar
            </p>
            <Suspense fallback={null}>
              <AdminLoginForm />
            </Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}
