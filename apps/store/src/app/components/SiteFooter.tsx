// language: TSX, file: apps/store/src/app/components/SiteFooter.tsx, target: Next.js App Router
// Rodapé do site: busca o cadastro da empresa no servidor (CNPJ/razão social já
// renderizados no HTML) e repassa ao rodapé de cliente.
import { Footer } from "./Footer";
import { loadCompany, type CommercialSettings } from "../lib/store";

export async function SiteFooter({ settings }: { settings: CommercialSettings }) {
  const company = await loadCompany();
  return <Footer settings={settings} company={company} />;
}
