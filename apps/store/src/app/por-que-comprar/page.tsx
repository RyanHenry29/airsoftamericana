// language: TSX, file: apps/store/src/app/por-que-comprar/page.tsx, target: Next.js App Router
// Página "Por que comprar aqui": orientação de entrada, provas de confiança
// (dado real do backend) e guias — seções movidas da home, entrada no rodapé
// e no menu mobile.
import Link from "next/link";
import {
  Clock,
  CreditCard,
  PackageSearch,
  QrCode,
  RefreshCcw,
  Store,
  Truck,
} from "lucide-react";
import { Header } from "../components/Header";
import { SiteFooter } from "../components/SiteFooter";
import { loadHome, type CommercialSettings } from "../lib/store";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Por que comprar aqui — Airsoft Americana",
};

export default async function PorQueComprarPage() {
  const home = await loadHome();

  const settingsFromHome = home.settings ?? ({} as CommercialSettings);
  const settings = {
    ...settingsFromHome,
    address: settingsFromHome.address ?? ({} as CommercialSettings["address"]),
  };
  const pixPercent = settings.pix_discount_percent ?? 0;
  const inst = settings.installments ?? 1;

  // Provas de confiança: estrutura única (rótulo + valor) — dado real do banco,
  // sem métrica inventada e sem texto verde solto no meio da frase.
  const trust: { label: string; value: string; Icon: typeof Truck }[] = [
    {
      label: "Catálogo",
      value:
        home.totals.products > 0
          ? `${home.totals.products} produtos publicados`
          : "Em atualização — fale com a equipe",
      Icon: PackageSearch,
    },
    { label: "Entrega", value: "Para todo o Brasil", Icon: Truck },
    ...(settings.service_hours
      ? [{ label: "Atendimento", value: settings.service_hours, Icon: Clock }]
      : []),
    {
      label: "PIX",
      value:
        pixPercent > 0
          ? `${pixPercent}% de desconto à vista`
          : "Transferência direta, sem intermediários",
      Icon: QrCode,
    },
    ...(inst > 1
      ? [
          {
            label: "Cartão",
            value: `${inst}x${settings.installment_interest_free !== false ? " sem juros" : ""} no cartão`,
            Icon: CreditCard,
          },
        ]
      : []),
    ...(settings.address?.city
      ? [
          {
            label: "Loja física",
            value: `${settings.address.city}/${settings.address.state ?? ""}`.replace(/\/$/, ""),
            Icon: Store,
          },
        ]
      : []),
    { label: "Trocas", value: "Devoluções conforme o CDC", Icon: RefreshCcw },
  ];

  return (
    <main id="conteudo" className="page-shell">
      <Header departments={home.departments} />

      <section className="inst-hero">
        <span className="sec-kicker">Por que comprar aqui</span>
        <h1 className="inst-hero__title">Compra segura, do clique à entrega</h1>
        <p className="inst-hero__lead">
          Condições comerciais claras, dados da empresa à vista e um time que responde antes
          da venda — não só depois do problema.
        </p>
      </section>

      {/* GUIA — orientação de quem está começando */}
      <section className="block block--border" aria-labelledby="guia-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Precisa de ajuda?</span>
            <h2 id="guia-title" className="sec-title">Começando no airsoft?</h2>
          </div>
          <Link href="/guia/primeiro-jogo" className="sec-link">Ver guia completo</Link>
        </div>
        <div className="inst-copy" style={{ maxWidth: "72ch" }}>
          <p className="inst-copy__lead">
            Checklist prático para o primeiro jogo: proteção ocular, réplica, BBs, bateria, manutenção e loadout.
            Se tiver dúvida de compatibilidade ou orçamento, fale com a equipe.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
            <Link href="/guia/primeiro-jogo" className="btn-primary">Abrir guia de primeiro jogo</Link>
            <Link href="/atendimento" className="btn-secondary">Falar com especialista</Link>
          </div>
        </div>
      </section>

      {/* CONFIANÇA — informações reais, sem métricas inventadas */}
      <section className="block" aria-labelledby="confianca-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Por que comprar aqui?</span>
            <h2 id="confianca-title" className="sec-title">Confiança</h2>
          </div>
          <Link href="/atendimento" className="sec-link">Fale com a equipe</Link>
        </div>
        <ul className="confianca-grid">
          {trust.map((item) => {
            const Icon = item.Icon;
            return (
              <li key={item.label} className="confianca-item">
                <span className="confianca-item__ico" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <span className="confianca-item__body">
                  <span className="confianca-item__label">{item.label}</span>
                  <span className="confianca-item__value">{item.value}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* GUIAS ÚTEIS — 3 artigos conectados a produtos */}
      <section className="block block--border" aria-labelledby="guias-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Conteúdo</span>
            <h2 id="guias-title" className="sec-title">Guias</h2>
          </div>
          <Link href="/guia" className="sec-link">Ver todos os guias</Link>
        </div>
        <ul className="guias-grid">
          <li className="guia-card">
            <h3>Como escolher sua primeira AEG</h3>
            <p>Entenda sistemas de propulsão, marcas, upgrade path e orçamento. Evite arrependimento na primeira compra.</p>
            <Link href="/guia/escolher-primeira-aeg" className="guia-link">Ler o guia →</Link>
          </li>
          <li className="guia-card">
            <h3>GBB vs HPA: qual vale a pena?</h3>
            <p>Comparativo real: realismo, manutenção, custo por partida, consistência de FPS. Decida com dados.</p>
            <Link href="/guia/gbb-vs-hpa" className="guia-link">Ler o guia →</Link>
          </li>
          <li className="guia-card">
            <h3>Checklist de primeiro jogo</h3>
            <p>O que levar, o que vestir, regras de segurança, etiqueta de campo. Chegue preparado e jogue tranquilo.</p>
            <Link href="/guia/primeiro-jogo" className="guia-link">Ler o guia →</Link>
          </li>
        </ul>
      </section>

      <SiteFooter settings={settings} />
    </main>
  );
}
