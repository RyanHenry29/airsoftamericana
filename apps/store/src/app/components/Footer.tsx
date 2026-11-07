// language: TSX, file: apps/store/src/app/components/Footer.tsx, target: Next.js App Router
// Rodapé institucional com navegação, endereço e condições de pagamento.
import Link from "next/link";
import type { CommercialSettings } from "../lib/store";

export function Footer({ settings }: { settings: CommercialSettings }) {
  return (
    <footer className="footer">
      <div className="footer__grid">
        <div>
          <p className="footer__brand">
            AIRSOFT <span>AMERICANA</span>
          </p>
          <p className="footer__line">
            {settings.address.street}
            {settings.address.district ? ` — ${settings.address.district}` : ""}
          </p>
          <p className="footer__line">
            {settings.address.city}/{settings.address.state} — CEP {settings.address.zip}
          </p>
          <p className="footer__line">{settings.service_hours}</p>
        </div>
        <nav className="footer__col" aria-label="Loja">
          <span className="footer__title">Loja</span>
          <Link href="/catalogo">Catálogo</Link>
          <Link href="/departamento/airsoft">Airsoft</Link>
          <Link href="/departamento/tiro-esportivo">Tiro Esportivo</Link>
          <Link href="/departamento/upgrades">Upgrades</Link>
          <Link href="/departamento/loadout">Loadout</Link>
        </nav>
        <nav className="footer__col" aria-label="Ajuda">
          <span className="footer__title">Ajuda</span>
          <Link href="/rastreamento">Acompanhar pedido</Link>
          <Link href="/atendimento">Atendimento</Link>
          <Link href="/institucional">A loja</Link>
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/termos">Termos de compra</Link>
        </nav>
        <div className="footer__col">
          <span className="footer__title">Pagamento</span>
          <span className="footer__line">PIX −{settings.pix_discount_percent}%</span>
          <span className="footer__line">Cartão {settings.installments}x sem juros</span>
          <span className="footer__line">Boleto bancário</span>
          <span className="footer__line">{settings.email}</span>
        </div>
      </div>
      <div className="footer__base">
        <span>© {new Date().getFullYear()} AIRSOFT AMERICANA</span>
        <span>Produtos com restrição de idade: 18+</span>
      </div>
    </footer>
  );
}
