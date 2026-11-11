// language: TSX, file: apps/store/src/app/guia/primeiro-jogo/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import Link from "next/link";
import { Shield, Crosshair, Circle, Battery, Wrench, Backpack } from "lucide-react";
import { Header } from "../../components/Header";
import { SiteFooter } from "../../components/SiteFooter";
import { API_URL, storeGet, type CommercialSettings, type StoreHome } from "../../lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guia de primeiro jogo",
  description:
    "O que levar no primeiro jogo de airsoft: proteção ocular, réplica, BBs, bateria, manutenção e loadout. Guia prático da Airsoft Americana.",
  keywords: [
    "primeiro jogo de airsoft",
    "checklist de airsoft",
    "equipamento para airsoft",
    "proteção ocular airsoft",
    "loadout iniciante",
  ],
  alternates: { canonical: "/guia/primeiro-jogo" },
};

const EMPTY_SETTINGS: CommercialSettings = {
  pix_discount_percent: 0,
  installments: 1,
  installment_interest_free: false,
  min_installment_cents: 0,
  free_shipping_from_cents: 0,
  shipping_carriers: [],
  whatsapp: "",
  email: "",
  address: { street: "", district: "", city: "", state: "", zip: "" },
  service_hours: "",
  social: { instagram: "", whatsapp: "" },
  announcement: "",
};

const STEPS = [
  {
    icon: Shield,
    title: "1. Proteção ocular",
    body: "Óculos ou máscara com certificação de impacto (ANSI Z87.1+). Obrigatório em qualquer partida — sem exceção.",
    href: "/catalogo?categoria=protecao-ocular",
    cta: "Ver proteções",
  },
  {
    icon: Crosshair,
    title: "2. Réplica ideal",
    body: "AEG para início (manutenção mais simples), GBBR para realismo, HPA para performance. Escolha pelo seu estilo de jogo e orçamento.",
    href: "/catalogo?categoria=replicas",
    cta: "Ver réplicas",
  },
  {
    icon: Circle,
    title: "3. BBs de qualidade",
    body: "0.20g a 0.28g de marcas confiáveis. BBs de baixa qualidade travam o cano e desgastam o hop-up prematuramente.",
    href: "/catalogo?categoria=bbs",
    cta: "Ver BBs",
  },
  {
    icon: Battery,
    title: "4. Bateria e carregador",
    body: "LiPo 7.4V ou 11.1V com carregador balanceador. Nunca carregue sem supervisão e use saco de segurança para LiPo.",
    href: "/catalogo?categoria=baterias",
    cta: "Ver baterias",
  },
  {
    icon: Wrench,
    title: "5. Manutenção básica",
    body: "Óleo de silicone, graxa branca, chave allen. Limpe o cano interno e lubrifique pontos de atrito conforme o manual da réplica.",
    href: "/catalogo?categoria=manutencao",
    cta: "Ver ferramentas",
  },
  {
    icon: Backpack,
    title: "6. Fardamento e carga",
    body: "Cinto tático, coldre, pouches para magazines, mochila de hidratação. Conforto e mobilidade definem sua permanência no campo.",
    href: "/catalogo?categoria=loadout",
    cta: "Ver loadout",
  },
];

export default async function GuiaPrimeiroJogoPage() {
  const home = await storeGet<StoreHome>(`${API_URL}/api/store/home`, {
    banners: [],
    sections: [],
    departments: [],
    brands: [],
    featured: [],
    news: [],
    sale: [],
    bestsellers: [],
    settings: EMPTY_SETTINGS,
    totals: { products: 0 },
  });
  const s = home.settings ?? EMPTY_SETTINGS;
  const wa = s.whatsapp ? `https://wa.me/${s.whatsapp.replace(/\D/g, "")}` : "/atendimento";

  return (
    <main className="page-shell">
      <Header departments={home.departments} />

      <section className="inst-hero" style={{ paddingBottom: "1.5rem" }}>
        <span className="sec-kicker">Guia</span>
        <h1 className="inst-hero__title">Começando no airsoft? Guia de primeiro jogo</h1>
        <p className="inst-hero__lead">
          Checklist prático do que levar, o que priorizar e como evitar os erros mais comuns na primeira partida.
          Se tiver dúvida de compatibilidade ou orçamento, fale com a equipe antes de comprar.
        </p>
      </section>

      <section className="block" aria-labelledby="checklist-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Checklist</span>
            <h2 id="checklist-title" className="sec-title">O essencial para o primeiro jogo</h2>
          </div>
          <a href={wa} className="sec-link" target={wa.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
            Falar com especialista
          </a>
        </div>
        <div className="orientacao-grid">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="orientacao-card">
                <div className="orientacao-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.8} />
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <Link href={step.href} className="orientacao-link">
                  {step.cta} →
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="block block--border" aria-labelledby="dicas-title">
        <div className="inst-copy">
          <h2 id="dicas-title" className="sec-title">Antes de ir ao campo</h2>
          <ul className="policy-list" style={{ marginTop: "1rem" }}>
            <li>
              <Shield size={18} />
              <div>
                <strong>Segurança primeiro</strong>
                <span>Proteção ocular o tempo todo dentro da área de jogo. Siga as regras de FPS e distância mínima do campo.</span>
              </div>
            </li>
            <li>
              <Battery size={18} />
              <div>
                <strong>Bateria carregada e revisada</strong>
                <span>Teste a réplica antes de sair de casa. Leve BBs extras e verifique se o carregador está funcionando.</span>
              </div>
            </li>
            <li>
              <Backpack size={18} />
              <div>
                <strong>Hidratação e conforto</strong>
                <span>Água, roupa adequada ao clima e calçado fechado. Jogos longos exigem preparo físico básico.</span>
              </div>
            </li>
          </ul>
          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <Link href="/catalogo" className="btn-primary">Ver catálogo</Link>
            <a href={wa} className="btn-secondary" target={wa.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              Tirar dúvidas no WhatsApp
            </a>
          </div>
        </div>
      </section>

      <SiteFooter settings={s} />
    </main>
  );
}
