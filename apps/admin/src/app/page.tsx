import Image from "next/image";
import { Suspense } from "react";
import { AdminLoginForm } from "./login/AdminLoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[#000] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
        {/* Left Side - Branding */}
        <section className="hidden lg:flex flex-col justify-between border border-[#111] p-12 bg-black/50">
          <div className="space-y-6">
            <Image
              src="/logo.png"
              alt="Airsoft Americana"
              width={60}
              height={60}
              className="h-16 w-16 object-contain"
            />
            <div>
              <p className="text-sm font-mono tracking-[0.2em] text-[#8BCF16] uppercase mb-2">Painel de Gestão</p>
              <h1 className="text-6xl font-black uppercase tracking-tighter leading-none">
                Airsoft <span className="text-[#A6F51B]">Americana</span>
              </h1>
              <p className="text-gray-400 max-w-sm mt-6 leading-relaxed font-light">
                Acesso restrito. Identidade tática, operação profissional de alto nível.
              </p>
            </div>
          </div>
          <div className="text-[10px] font-mono text-gray-600 tracking-[0.3em] uppercase">
            www.airsoftamericana.com.br
          </div>
        </section>

        {/* Right Side - Form */}
        <section className="bg-[#050505] border border-[#111] p-8 lg:p-12">
          <Suspense fallback={null}>
            <AdminLoginForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
