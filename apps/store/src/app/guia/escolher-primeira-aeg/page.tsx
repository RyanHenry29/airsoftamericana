// language: TSX, file: apps/store/src/app/guia/escolher-primeira-aeg/page.tsx, target: Next.js App Router
// Guia de compra: escolha da primeira AEG — conceitos, passo a passo e erros comuns.
import type { Metadata } from "next";
import Link from "next/link";
import { Battery, Cpu, Ruler, Shield, Target, Wrench } from "lucide-react";
import { Header } from "../../components/Header";
import { SiteFooter } from "../../components/SiteFooter";
import { loadHome } from "../../lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Como escolher sua primeira AEG",
  description:
    "Guia da primeira AEG: gearbox, bateria, hop-up, munição, orçamento total e os erros que mais estragam a primeira compra.",
  keywords: [
    "primeira AEG",
    "como escolher airsoft",
    "gearbox airsoft",
    "AEG para iniciante",
    "hop-up airsoft",
  ],
  alternates: { canonical: "/guia/escolher-primeira-aeg" },
};

const CONCEPTS = [
  {
    icon: Cpu,
    title: "Gearbox",
    body: "O conjunto mecânico dentro da réplica. V2 (M4/AR) e V3 (AK) são as mais comuns — peças de reposição em abundância e upgrade barato no futuro.",
  },
  {
    icon: Battery,
    title: "Bateria e carregador",
    body: "LiPo 7.4V é o ponto de partida tranquilo; 11.1V exige MOSFET para proteger o contato elétrico. Carregador sempre balanceador, carga sempre supervisionada.",
  },
  {
    icon: Target,
    title: "Hop-up",
    body: "Aplica rotação ao BB em voo: sem ele, o BB cai rápido. Ajuste fino + munição pesada = alcance útil. É o primeiro ajuste depois de comprar.",
  },
  {
    icon: Ruler,
    title: "Munição",
    body: "0.20g serve para testar; 0.25g a 0.28g é o padrão de jogo para AEG. BB de qualidade evita travamento e desgasta menos o cano.",
  },
  {
    icon: Shield,
    title: "Construção",
    body: "Corpo em polímero é leve e barato — e não é sinônimo de frágil. Metal pesa mais e muda o equilíbrio; escolha pelo tipo de jogo, não pelo peso da vitrine.",
  },
  {
    icon: Wrench,
    title: "Manutenção",
    body: "Óleo de silicone, graxa branca e chave allen resolvem 90% do custo de manutenção. Limpe o cano e lubrifique os pontos de atrito conforme o manual.",
  },
];

const STEPS = [
  {
    title: "1. Defina onde você vai jogar",
    body: "Campo aberto pede alcance e precisão; CQB pede manobrabilidade e réplica curta. A resposta muda o modelo — e o orçamento.",
  },
  {
    title: "2. Feche o orçamento total",
    body: "Réplica + bateria + carregador + BBs + proteção. Comprar só a réplica é o erro de orçamento mais comum do iniciante.",
  },
  {
    title: "3. Escolha o modelo pelo que você gosta de usar",
    body: "Dentro da mesma gearbox, a diferença entre corpos é ergonomia e alcance de ajuste. Segure no que for confortável por horas.",
  },
  {
    title: "4. Confira a reposição de peças",
    body: "Gearbox V2/V3 genérica significa peça amanhã, não em seis meses. É o que mantém a réplica viva por anos.",
  },
  {
    title: "5. Confira as regras do seu campo",
    body: "Limite de energia (joule), distância mínima e restrição de idade variam por organizador. Confirme antes de escolher a potência.",
  },
  {
    title: "6. Compre o kit completo de uma vez",
    body: "Bateria compatível, carregador balanceador e BBs de qualidade na mesma compra — sem esperar a primeira partida para descobrir que faltou algo.",
  },
];

const MISTAKES = [
  "BB barato ou liso: traz o cano, desgasta o hop-up e derruba a precisão em poucas partidas.",
  "11.1V em gearbox sem MOSFET: o contato elétrico queima antes do primeiro jogo inteiro.",
  "Ignorar o limite de energia do campo: réplica acima do limite não entra na partida.",
  "Comprar réplica sem proteção ocular certificada: obrigatória dentro de campo, sem exceção.",
  "Esperar precisão de sniper sem ajustar hop-up e sem munição na gramatura certa.",
];

export default async function EscolherPrimeiraAegPage() {
  const home = await loadHome();
  const settings = home.settings;
  const wa = settings.whatsapp ? `https://wa.me/${settings.whatsapp.replace(/\D/g, "")}` : "/atendimento";

  return (
    <main className="page-shell">
      <Header departments={home.departments} />

      <section className="inst-hero" style={{ paddingBottom: "1.5rem" }}>
        <span className="sec-kicker">Guia de compra</span>
        <h1 className="inst-hero__title">Como escolher sua primeira AEG</h1>
        <p className="inst-hero__lead">
          AEG é réplica elétrica: a bateria aciona a gearbox, a gearbox comprime a mola e o ar sai pelo cano.
          Escolher bem é decidir gearbox, bateria e orçamento total — não o modelo mais bonito da vitrine.
        </p>
      </section>

      <section className="block" aria-labelledby="conceitos-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Fundamentos</span>
            <h2 id="conceitos-title" className="sec-title">O que realmente define uma AEG</h2>
          </div>
        </div>
        <div className="orientacao-grid">
          {CONCEPTS.map((c) => {
            const Icon = c.icon;
            return (
              <article key={c.title} className="orientacao-card">
                <div className="orientacao-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.8} />
                </div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="block block--border" aria-labelledby="passos-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Passo a passo</span>
            <h2 id="passos-title" className="sec-title">Da decisão à primeira compra</h2>
          </div>
          <Link href="/catalogo" className="sec-link">Ver catálogo</Link>
        </div>
        <ol className="steps-list">
          {STEPS.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <span>{s.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="block block--border" aria-labelledby="joule-title">
        <div className="inst-copy">
          <h2 id="joule-title" className="sec-title">Por que a gramatura muda tudo</h2>
          <p className="inst-copy__lead">
            Energia em joules: <strong>E = ½ · massa · velocidade²</strong>. O mesmo FPS com BB mais pesado entrega mais
            energia — por isso o campo mede em joule, não em FPS.
          </p>
          <ul className="policy-list">
            <li>
              <Target size={18} />
              <div>
                <strong>0.20g a 300 fps ≈ 0,84 J</strong>
                <span>Referência de teste. Serve para crono e ajuste inicial de hop-up.</span>
              </div>
            </li>
            <li>
              <Target size={18} />
              <div>
                <strong>0.28g a 300 fps ≈ 1,17 J</strong>
                <span>Mesma velocidade, mais energia e voo mais estável — o padrão de jogo da maioria das AEGs.</span>
              </div>
            </li>
            <li>
              <Shield size={18} />
              <div>
                <strong>O limite é do campo</strong>
                <span>Organizadores trabalham com limite por papel (atirador, DMR, sniper) e distância mínima de segurança.</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section className="block block--border" aria-labelledby="erros-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Cuidado</span>
            <h2 id="erros-title" className="sec-title">Erros que mais custam caro</h2>
          </div>
        </div>
        <ul className="policy-list">
          {MISTAKES.map((m) => (
            <li key={m}>
              <Wrench size={18} />
              <div>
                <span>{m}</span>
              </div>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link href="/catalogo" className="btn-primary">Ver AEGs no catálogo</Link>
          <a href={wa} className="btn-secondary" target={wa.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
            Tirar dúvidas no WhatsApp
          </a>
        </div>
      </section>

      <SiteFooter settings={settings} />
    </main>
  );
}
