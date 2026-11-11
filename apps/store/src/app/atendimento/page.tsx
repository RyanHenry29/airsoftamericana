// language: TSX, file: apps/store/src/app/atendimento/page.tsx, target: Next.js App Router
// Central de atendimento: canais diretos, FAQ e abertura de chamado.
import Link from "next/link";
import type { Metadata } from "next";
import { Clock, Mail, MessageCircle, Truck } from "lucide-react";
import { Header } from "../components/Header";
import { SiteFooter } from "../components/SiteFooter";
import { TicketForm } from "./TicketForm";
import { API_URL, storeGet, type CommercialSettings, type StoreHome } from "../lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atendimento e suporte",
  description:
    "Dúvida sobre produto, frete, pagamento ou troca? Atendimento da Airsoft Americana com perguntas frequentes e abertura de chamado — resposta no mesmo dia útil.",
  keywords: ["atendimento airsoft", "suporte ao cliente", "dúvidas de compra", "troca e devolução", "fale conosco"],
  alternates: { canonical: "/atendimento" },
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

const FAQ = [
  {
    q: "Qual o prazo de envio?",
    a: "Pedidos aprovados até 14h saem no mesmo dia útil. O prazo varia por CEP e modality — PAC e SEDEX pelos Correios.",
  },
  {
    q: "O frete é grátis?",
    a: "Sim, acima do valor mínimo configurado a loja. Abaixo disso, o valor é calculado pelo CEP no carrinho.",
  },
  {
    q: "Como funciona a troca?",
    a: "7 dias corridos para desistência, com produto sem uso e embalagem original. O primeiro frete de devolução é por nossa conta.",
  },
  {
    q: "Quais são as formas de pagamento?",
    a: "PIX com desconto, cartão de crédito parcelado e boleto bancário. O pedido entra em separação assim que o pagamento é aprovado.",
  },
  {
    q: "Posso retirar na loja?",
    a: "Sim. É só marcar a retirada no checkout e aparecer na loja com o número do pedido.",
  },
  {
    q: "Vendem para menores de 18 anos?",
    a: "Não. Airsoft e tiro esportivo são restritos a maiores de 18 anos, com verificação no checkout.",
  },
];

export default async function AtendimentoPage() {
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
  const s = home.settings;

  const channels = [
    {
      icon: MessageCircle,
      title: "WhatsApp",
      body: s.whatsapp ? `+55 ${s.whatsapp.replace(/(\d{2})(\d{5})(\d{4})/, "$1 $2-$3")}` : "Atendimento direto",
      href: s.whatsapp ? `https://wa.me/${s.whatsapp}` : "/atendimento",
    },
    {
      icon: Mail,
      title: "E-mail",
      body: s.email || "contato@airsoftamericana.com.br",
      href: s.email ? `mailto:${s.email}` : "/atendimento",
    },
    {
      icon: Clock,
      title: "Horário",
      body: s.service_hours || "Seg a sex, 9h às 18h",
      href: "/atendimento",
    },
    {
      icon: Truck,
      title: "Frete e prazos",
      body: "Consulte o CEP no carrinho ou na página de produto",
      href: "/catalogo",
    },
  ];

  return (
    <main className="page-shell">
      <Header departments={home.departments} />

      <section className="inst-hero">
        <span className="sec-kicker">Atendimento</span>
        <h1 className="inst-hero__title">Fale com a gente</h1>
        <p className="inst-hero__lead">
          Dúvida sobre produto, frete, pagamento ou troca? A gente responde no mesmo dia útil.
        </p>
      </section>

      <section className="block">
        <ul className="inst-facts">
          {channels.map((c) => (
            <li key={c.title}>
              <c.icon size={20} />
              <strong>{c.title}</strong>
              <span>
                {c.href.startsWith("http") || c.href.startsWith("mailto") ? (
                  <a href={c.href} target={c.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                    {c.body}
                  </a>
                ) : (
                  <Link href={c.href}>{c.body}</Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <div className="inst-copy">
          <h2 className="sec-title">Perguntas frequentes</h2>
          <dl className="faq">
            {FAQ.map((item) => (
              <div key={item.q} className="faq__row">
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="block">
        <div className="inst-copy">
          <h2 className="sec-title">Abrir um chamado</h2>
          <p className="inst-copy__lead">
            Preencha o formulário e o time de atendimento responde pelo e-mail informado.
          </p>
          <TicketForm />
        </div>
      </section>

      <SiteFooter settings={s} />
    </main>
  );
}
