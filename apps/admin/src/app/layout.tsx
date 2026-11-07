import "./globals.css";
import Image from "next/image";
import Link from "next/link";
import { AdminNav } from "./AdminNav";

export const metadata = {
  title: "Airsoft Americana - Painel Administrativo",
  description: "Painel administrativo da loja Airsoft Americana",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-br">
      <body className="bg-[#000] text-white font-sans antialiased">
        <div className="admin-shell">
          <aside className="admin-side">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <Image
                src="/logo.png"
                alt="Airsoft Americana"
                width={40}
                height={40}
                className="h-10 w-10 object-contain"
              />
              <span className="admin-brand">
                AIRSOFT <span className="text-[#8bcf16]">AMERICANA</span>
              </span>
            </Link>
            <p className="admin-side-sub">Painel de uso interno</p>
            <AdminNav />
            <p className="admin-side-foot">
              Acesso apenas por URL direta. Sem botão na loja pública.
            </p>
          </aside>
          <div className="admin-main">{children}</div>
        </div>
      </body>
    </html>
  );
}
