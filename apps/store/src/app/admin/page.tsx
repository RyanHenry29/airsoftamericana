import { redirect } from "next/navigation";

// Acesso administrativo apenas por URL direta (sem botão/link na loja),
// ex.: http://localhost:3000/admin em dev ou https://www.airsoftamericana.com.br/admin em prod.
// Redireciona para o serviço admin (porta 3001 em dev / NEXT_PUBLIC_ADMIN_URL em prod).
const ADMIN_URL =
  process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";

export default function AdminGatePage() {
  redirect(`${ADMIN_URL}/login`);
}
