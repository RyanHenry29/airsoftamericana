// language: TSX, file: apps/store/src/app/redefinir-senha/page.tsx, target: Next.js App Router
// searchParams é Promise nesta versão do Next — a página é async e lê com await.
import type { Metadata } from "next";
import { AuthShell } from "../components/AuthShell";
import { OG_IMAGE } from "../lib/seo";
import { RedefinirForm } from "./RedefinirForm";

export const metadata: Metadata = {
  title: "Criar senha nova",
  description:
    "Escolha a nova senha da sua conta Airsoft Americana — o link do e-mail vale por 60 minutos e serve uma vez só.",
  alternates: { canonical: "/redefinir-senha" },
  openGraph: {
    title: "Criar senha nova | Airsoft Americana",
    description:
      "Escolha a nova senha da sua conta Airsoft Americana — o link do e-mail vale por 60 minutos e serve uma vez só.",
    url: "/redefinir-senha",
    images: [OG_IMAGE],
  },
  robots: { index: false, follow: true },
};

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = typeof raw === "string" ? raw : "";

  return (
    <AuthShell variant="entrar">
      <RedefinirForm token={token} />
    </AuthShell>
  );
}
