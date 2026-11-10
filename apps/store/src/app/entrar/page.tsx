// language: TSX, file: apps/store/src/app/entrar/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import { AuthShell } from "../components/AuthShell";
import { OG_IMAGE } from "../lib/seo";
import { EntrarForm } from "./EntrarForm";

export const metadata: Metadata = {
  title: "Entrar",
  description:
    "Acesse sua conta da Airsoft Americana: pedidos, rastreio e checkout pronto pra próxima compra.",
  alternates: { canonical: "/entrar" },
  openGraph: {
    title: "Entrar | Airsoft Americana",
    description:
      "Acesse sua conta da Airsoft Americana: pedidos, rastreio e checkout pronto pra próxima compra.",
    url: "/entrar",
    images: [OG_IMAGE],
  },
  robots: { index: false, follow: true },
};

export default function EntrarPage() {
  return (
    <AuthShell variant="entrar">
      <EntrarForm />
    </AuthShell>
  );
}
