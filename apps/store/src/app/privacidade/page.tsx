// language: TSX, file: apps/store/src/app/privacidade/page.tsx, target: Next.js App Router
import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../components/Header";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Como a Airsoft Americana coleta, usa e protege seus dados pessoais (LGPD).",
  alternates: { canonical: "/privacidade" },
};

const SECTIONS = [
  {
    h: "Dados que coletamos",
    p: [
      "Nome, e-mail, CPF, telefone e endereço de entrega quando você cria conta ou finaliza um pedido.",
      "Dados de navegação (páginas visitadas, origem do acesso) para melhorar o catálogo e a loja.",
      "Dados de pagamento não passam pela nossa loja: são processados diretamente pelo gateway (PIX, cartão, boleto).",
    ],
  },
  {
    h: "Para que usamos",
    p: [
      "Processar e entregar pedidos, emitir nota fiscal e cumprir obrigações legais.",
      "Enviar novidades e promoções — apenas se você se inscreveu. Todo e-mail de marketing tem descadastro em um clique.",
      "Detectar fraudes e proteger sua conta.",
    ],
  },
  {
    h: "Compartilhamento",
    p: [
      "Seus dados são compartilhados apenas com quem executa o pedido: gateways de pagamento, Correios/transportadoras e contadores, na medida do necessário.",
      "Não vendemos dados pessoais. Nunca.",
    ],
  },
  {
    h: "Seus direitos (LGPD)",
    p: [
      "Acesso, correção, portabilidade, exclusão e informação sobre compartilhamento — solicite pelo canal de atendimento.",
      "Restrição de idade: categorias com restrição 18+ exigem maioridade na compra, conforme a legislação vigente.",
      "Você pode pedir a exclusão da conta e do histórico associado a ela a qualquer momento.",
    ],
  },
  {
    h: "Cookies e armazenamento local",
    p: [
      "Usamos cookies e armazenamento local essenciais para o funcionamento da loja, como manter sua sessão, carrinho e proteções de segurança.",
      "Cookies ou armazenamentos não essenciais só são ativados quando você aceita no aviso de preferências exibido no site. Você pode recusar os não essenciais.",
      "Sua escolha fica registrada no seu navegador e pode ser alterada limpando os dados do site/cookies no navegador.",
    ],
  },
  {
    h: "Retenção e segurança",
    p: [
      "Dados de pedidos são mantidos pelo prazo legal fiscal; dados de marketing até o descadastro.",
      "Acesso ao painel é restrito, com trilha de auditoria em operações sensíveis.",
    ],
  },
];

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Header />
      <div className="mx-auto max-w-3xl px-4 md:px-8 py-16 md:py-20">
        <span className="sec-kicker">LGPD · LEI 13.709/2018</span>
        <h1 className="sec-title mb-10">POLÍTICA DE PRIVACIDADE</h1>
        <div className="flex flex-col gap-10">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="font-display uppercase text-xl text-white mb-3">{s.h}</h2>
              <ul className="flex flex-col gap-2 text-sm text-white/60 leading-relaxed list-none">
                {s.p.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-14 text-sm text-white/50 border-t border-[var(--border)] pt-6">
          Dúvidas sobre este documento: <Link href="/atendimento" className="sec-link !text-sm">fale com a gente</Link>.
        </p>
      </div>
    </main>
  );
}
