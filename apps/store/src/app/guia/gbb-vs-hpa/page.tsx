// language: TSX, file: apps/store/src/app/guia/gbb-vs-hpa/page.tsx, target: Next.js App Router
// Comparativo GBB vs HPA: tabela lado a lado, custo por partida e critérios de escolha.
import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Droplets, Flame, Gauge, Shield, Wrench } from "lucide-react";
import { Header } from "../../components/Header";
import { SiteFooter } from "../../components/SiteFooter";
import { loadHome } from "../../lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GBB vs HPA: qual vale a pena?",
  description:
    "Comparativo GBB e HPA: realismo, manutenção, custo por partida, consistência de FPS e requisitos de campo. Decida com dados.",
  keywords: ["GBB vs HPA", "gas blowback", "HPA airsoft", "réplica HPA", "comparativo de airsoft"],
  alternates: { canonical: "/guia/gbb-vs-hpa" },
};

type Row = { aspect: string; gbb: string; hpa: string };

const COMPARISON: Row[] = [
  {
    aspect: "Sistema",
    gbb: "Gás (green gas / CO₂) dentro do carregador; o gás move o blowback e o BB.",
    hpa: "Ar comprimido de tanque externo, regulado, alimenta a réplica por mangueira.",
  },
  {
    aspect: "Realismo",
    gbb: "Blowback mecânico: recuo e trava aberta no último disparo — o mais próximo de um firearm.",
    hpa: "Sem recuo mecânico; o realismo vem do comportamento do tiro, não do carregador.",
  },
  {
    aspect: "Consistência de FPS",
    gbb: "Cai com o frio e com a pressão do gás: cada carregador rende menos no fim do jogo.",
    hpa: "Regulador mantém a pressão constante: mesmo FPS do primeiro ao último disparo.",
  },
  {
    aspect: "Manutenção",
    gbb: "Alta: borrachas, válvulas e lubricação do sistema de gás a cada uso. Desmontagem periódica.",
    hpa: "Baixa na réplica: sem ciclo de gás para limpar; o cuidado migra para o regulador e o tanque.",
  },
  {
    aspect: "Custo por partida",
    gbb: "Carregadores de gás e recargas recorrentes — o custo cresce a cada partida jogada.",
    hpa: "Tanque e recarga de ar: entrada maior, custo por disparo muito menor no médio prazo.",
  },
  {
    aspect: "Carga e logística",
    gbb: "Carregador no bolso, recarrega em casa. Nada pendurado no loadout.",
    hpa: "Tanque no costas ou no cinto + mangueira. Peso extra e dependência do regulador.",
  },
  {
    aspect: "Clima",
    gbb: "Frio derruba a pressão do gás e reduz alcance e cadência no meio da partida.",
    hpa: "Ar comprimido não sente temperatura de gás: desempenho estável em qualquer clima.",
  },
  {
    aspect: "Barreira de entrada",
    gbb: "Menor: compra a réplica, o carregador e o gás. Começa a jogar na mesma semana.",
    hpa: "Maior: além da réplica, tanque, regulador e mangueira — sistema completo antes do primeiro jogo.",
  },
];

const DECIDE = [
  {
    icon: Flame,
    title: "Escolha GBB se…",
    body: "Você valoriza recuo, trava e som reais; joga em clima ameno; aceita manutenção rotineira e gosta de simular tiro controlado em vez de rajada.",
  },
  {
    icon: Gauge,
    title: "Escolha HPA se…",
    body: "Você quer FPS constante em qualquer clima, rajada sem estresse de gás e o menor custo por disparo no longo prazo — e não se incomoda com mangueira.",
  },
  {
    icon: Banknote,
    title: "Decida pelo orçamento total",
    body: "GBB começa barato e cobra por partida; HPA começa caro e barateia o uso. Rode a conta pelo número de partidas por mês, não pelo preço da vitrine.",
  },
];

const CARE = [
  "GBB: lubrifique o sistema de gás e troque borrachas conforme o manual — vazamento silencioso derruba a cadência no meio do jogo.",
  "GBB: use o gás indicado (green gas ou CO₂ conforme o modelo) e evite encher carregador no calor do sol.",
  "HPA: verifique o regulador antes de cada partida e inspecione a mangueira e as conexões por desgaste.",
  "HPA: tanque de ar é pressão alta — mantenha o certificado de vistoria do tanque em dia e nunca abra válvula improvisada.",
  "Ambos: proteção ocular certificada é obrigatória dentro de campo, sem exceção pelo sistema de propulsão.",
];

export default async function GbbVsHpaPage() {
  const home = await loadHome();
  const settings = home.settings;
  const wa = settings.whatsapp ? `https://wa.me/${settings.whatsapp.replace(/\D/g, "")}` : "/atendimento";

  return (
    <main className="page-shell">
      <Header />

      <section className="inst-hero" style={{ paddingBottom: "1.5rem" }}>
        <span className="sec-kicker">Comparativo</span>
        <h1 className="inst-hero__title">GBB vs HPA: qual vale a pena?</h1>
        <p className="inst-hero__lead">
          Gás contra ar comprimido: dois caminhos opostos para a mesma réplica. Um prioriza realismo e
          simplicidade de entrada; o outro, consistência e custo por disparo. A tabela abaixo coloca os dois
          lado a lado — sem marketing, só o que muda em campo.
        </p>
      </section>

      <section className="block" aria-labelledby="comparativo-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Lado a lado</span>
            <h2 id="comparativo-title" className="sec-title">Comparativo direto</h2>
          </div>
          <Link href="/catalogo" className="sec-link">Ver no catálogo</Link>
        </div>
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">Aspecto</th>
                <th scope="col">GBB — Blowback a gás</th>
                <th scope="col">HPA — Ar comprimido</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.aspect}>
                  <th scope="row">{row.aspect}</th>
                  <td>{row.gbb}</td>
                  <td>{row.hpa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block block--border" aria-labelledby="decisao-title">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Decisão</span>
            <h2 id="decisao-title" className="sec-title">Como decidir na prática</h2>
          </div>
          <Link href="/atendimento" className="sec-link">Falar com a equipe</Link>
        </div>
        <div className="orientacao-grid">
          {DECIDE.map((d) => {
            const Icon = d.icon;
            return (
              <article key={d.title} className="orientacao-card">
                <div className="orientacao-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.8} />
                </div>
                <h3>{d.title}</h3>
                <p>{d.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="block block--border" aria-labelledby="cuidados-title">
        <div className="inst-copy">
          <h2 id="cuidados-title" className="sec-title">Cuidados de cada sistema</h2>
          <p className="inst-copy__lead">
            Os dois sistemas exigem cuidado físico — pressão, gás e peças móveis não perdoam descuido. Trate
            o tanque e o carregador com o mesmo respeito que trata a proteção ocular.
          </p>
          <ul className="policy-list">
            {CARE.map((item) => (
              <li key={item}>
                <Wrench size={18} />
                <div>
                  <span>{item}</span>
                </div>
              </li>
            ))}
          </ul>
          <ul className="policy-list" style={{ marginTop: "1rem" }}>
            <li>
              <Shield size={18} />
              <div>
                <strong>Pressão é energia acumulada</strong>
                <span>Tanque de HPA e garrafa de gás nunca devem ser aquecidos, dropados ou abertos com conexão folgada.</span>
              </div>
            </li>
            <li>
              <Droplets size={18} />
              <div>
                <strong>Umidade e lubrificação</strong>
                <span>Lubrificante adequado para cada sistema — óleo errado estraga borracha e regulador.</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section className="block block--border">
        <div className="sec-head">
          <div>
            <span className="sec-kicker">Próximo passo</span>
            <h2 className="sec-title">Ainda em dúvida?</h2>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link href="/guia/escolher-primeira-aeg" className="btn-primary">
            Ler o guia da primeira AEG
          </Link>
          <a
            href={wa}
            className="btn-secondary"
            target={wa.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
          >
            Tirar dúvidas no WhatsApp
          </a>
        </div>
      </section>

      <SiteFooter settings={settings} />
    </main>
  );
}
