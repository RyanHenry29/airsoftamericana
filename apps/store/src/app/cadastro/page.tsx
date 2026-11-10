// language: TSX, file: apps/store/src/app/cadastro/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import { AuthShell } from "../components/AuthShell";
import { OG_IMAGE } from "../lib/seo";
import { CadastroForm } from "./CadastroForm";

export const metadata: Metadata = {
  title: "Criar conta",
  description:
    "Crie sua conta na Airsoft Americana em um minuto: sem taxa, sem assinatura e com checkout mais rápido.",
  alternates: { canonical: "/cadastro" },
  openGraph: {
    title: "Criar conta | Airsoft Americana",
    description:
      "Crie sua conta na Airsoft Americana em um minuto: sem taxa, sem assinatura e com checkout mais rápido.",
    url: "/cadastro",
    images: [OG_IMAGE],
  },
  robots: { index: false, follow: true },
};

export default function CadastroPage() {
  return (
    <AuthShell variant="cadastro">
      <CadastroForm />
    </AuthShell>
  );
}
