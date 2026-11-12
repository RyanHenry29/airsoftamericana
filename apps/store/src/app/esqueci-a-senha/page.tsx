// language: TSX, file: apps/store/src/app/esqueci-a-senha/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import { OG_IMAGE } from "../lib/seo";
import { EsqueciForm } from "./EsqueciForm";
import { AuthCentered } from "../components/AuthCentered";

export const metadata: Metadata = {
  title: "Esqueci a senha",
  description:
    "Peça um link de redefinição de senha da sua conta Airsoft Americana — chega no e-mail do cadastro, válido por 60 minutos.",
  alternates: { canonical: "/esqueci-a-senha" },
  openGraph: {
    title: "Esqueci a senha | Airsoft Americana",
    description:
      "Peça um link de redefinição de senha da sua conta Airsoft Americana — chega no e-mail do cadastro, válido por 60 minutos.",
    url: "/esqueci-a-senha",
    images: [OG_IMAGE],
  },
  robots: { index: false, follow: true },
};

export default function EsqueciSenhaPage() {
  return (
    <AuthCentered>
      <EsqueciForm />
    </AuthCentered>
  );
}