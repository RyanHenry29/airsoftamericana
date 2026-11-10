// language: TSX, file: apps/store/src/app/components/Footer.tsx, target: Next.js App Router
// Rodapé: informações reais da operação, navegação e newsletter. Sem ícones decorativos, sem links vazios.
"use client";

import Link from "next/link";
import { useState } from "react";
import { AtSign, CreditCard, Mail, MessageCircle, QrCode, RefreshCcw, Truck } from "lucide-react";
import type { CommercialSettings } from "../lib/store";
import { formatBRL, type Company } from "../lib/store";
import { PaymentMarks } from "./PaymentMarks";
import { COOKIE_PREFS_EVENT } from "./CookieConsent";

const departments = [
  { label: "Airsoft", href: "/departamento/airsoft" },
  { label: "Tiro Esportivo", href: "/departamento/tiro-esportivo" },
  { label: "Upgrades", href: "/departamento/upgrades" },
  { label: "Loadout", href: "/departamento/loadout" },
  { label: "Life Style", href: "/departamento/life-style" },
  { label: "Aventura", href: "/departamento/aventura" },
];

const infoLinks = [
  { label: "Por que comprar aqui", href: "/por-que-comprar" },
  { label: "Atendimento ao cliente", href: "/atendimento" },
  { label: "Rastrear pedido", href: "/rastreamento" },
  { label: "Guias", href: "/guia" },
  { label: "Blog", href: "/blog" },
  { label: "Loja física", href: "/institucional" },
  { label: "Trocas / devoluções / garantias", href: "/termos" },
  { label: "Perguntas frequentes", href: "/busca" },
  { label: "Condições de frete", href: "/frete" },
  { label: "Termos de compra", href: "/termos" },
];

function socialUrl(kind: "instagram" | "whatsapp", value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (kind === "instagram") {
    if (/^https?:\/\//i.test(v)) return v;
    const handle = v.replace(/^@/, "");
    return handle ? `https://instagram.com/${handle}` : null;
  }
  const digits = v.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

/** `@airsoft_americana` a partir do valor digitado no admin (handle ou URL). */
function instagramHandle(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.startsWith("@")) return v.slice(1);
  if (/^https?:\/\//i.test(v)) {
    return v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
  }
  return v.replace(/^@/, "");
}

// `company` chega do servidor (SiteFooter) — CNPJ/razão social no HTML, sem fetch no cliente.
export function Footer({
  settings,
  company,
}: {
  settings: CommercialSettings;
  company: Company | null;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, source: "footer" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "Não foi possível cadastrar seu e-mail.");
        return;
      }
      setOk(true);
    } catch {
      setError("Erro de conexão. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  const pix = settings.pix_discount_percent ?? 0;
  const inst = settings.installments ?? 1;
  const free = settings.free_shipping_from_cents ?? 0;
  const minInst = settings.min_installment_cents ?? 0;
  const year = new Date().getFullYear();
  const instagram = socialUrl("instagram", settings.social?.instagram);
  const whatsapp = socialUrl("whatsapp", settings.social?.whatsapp || settings.whatsapp);

  return (
    <footer className="footer">
      <div className="footer__topbar">
        <div className="footer__topbar-inner">
          <div className="footer__promise">
            <Truck size={20} strokeWidth={2} aria-hidden="true" />
            <span className="footer__promise-text">
              <b>{free > 0 ? "Frete Grátis" : "Envio para todo o Brasil"}</b>
              <small>{free > 0 ? `Acima de ${formatBRL(free)}` : "Consulte o prazo no checkout"}</small>
            </span>
          </div>
          <div className="footer__promise">
            <CreditCard size={20} strokeWidth={2} aria-hidden="true" />
            <span className="footer__promise-text">
              <b>{inst > 1 ? `${inst}x Sem Juros` : "Pagamento Facilitado"}</b>
              <small>
                {minInst > 0
                  ? `Parcela mínima ${formatBRL(minInst)}`
                  : inst > 1 && settings.installment_interest_free !== false
                    ? "Sem juros no cartão"
                    : "Cartão, PIX e boleto"}
              </small>
            </span>
          </div>
          <div className="footer__promise">
            <QrCode size={20} strokeWidth={2} aria-hidden="true" />
            <span className="footer__promise-text">
              <b>{pix > 0 ? `${pix}% de Desconto` : "Pagamento via PIX"}</b>
              <small>{pix > 0 ? "No pagamento via PIX" : "Aprovação na hora"}</small>
            </span>
          </div>
          <div className="footer__promise">
            <RefreshCcw size={20} strokeWidth={2} aria-hidden="true" />
            <span className="footer__promise-text">
              <b>Trocas e Devoluções</b>
              <small>Conforme a política de trocas</small>
            </span>
          </div>
        </div>
      </div>
      <div className="footer__grid">
        <div className="footer__col footer__col--brand">
          <p className="footer__brand">
            AIRSOFT <span>AMERICANA</span>
          </p>
          <div className="footer__block">
            <p className="footer__label">Loja física</p>
            <address className="footer__line" style={{ fontStyle: "normal" }}>
              {settings?.address?.street}
              {settings?.address?.district ? ` — ${settings?.address?.district}` : ""}
              <br />
              {[settings?.address?.city, settings?.address?.state].filter(Boolean).join("/")}
              {settings?.address?.zip ? ` — CEP ${settings.address.zip}` : ""}
            </address>
          </div>
          {settings?.service_hours ? (
            <div className="footer__block">
              <p className="footer__label">Horário</p>
              <p className="footer__line">{settings.service_hours}</p>
            </div>
          ) : null}
        </div>

        <nav className="footer__col" aria-label="Departamentos">
          <span className="footer__title">Departamentos</span>
          {departments.map((d) => (
            <Link key={d.href} href={d.href} className="footer__link">
              {d.label}
            </Link>
          ))}
        </nav>

        <nav className="footer__col" aria-label="Informações">
          <span className="footer__title">Informações</span>
          {infoLinks.map((l) => (
            <Link key={`${l.href}-${l.label}`} href={l.href} className="footer__link">
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            className="footer__link footer__link--button"
            onClick={() => window.dispatchEvent(new Event(COOKIE_PREFS_EVENT))}
          >
            Preferências de cookies
          </button>
        </nav>

        <div className="footer__col footer__col--newsletter">
          <span className="footer__title">Receba novidades</span>
          <p className="footer__newsletter-intro">Cadastre seu e-mail para receber avisos de reposição e lançamentos.</p>
          <form className="footer__newsletter" onSubmit={onSubmit} noValidate>
            <label className="sr-only" htmlFor="footer-newsletter-email">
              E-mail
            </label>
            <input
              id="footer-newsletter-email"
              type="email"
              required
              className="footer__input"
              placeholder="seu e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Seu e-mail"
            />
            <button type="submit" className="footer__btn" disabled={busy}>
              {busy ? "Enviando..." : "Cadastrar"}
            </button>
          </form>
          {error && (
            <p className="footer__error" role="alert">
              {error}
            </p>
          )}
          <div className="footer__contact">
            {whatsapp ? (
              <a className="footer__contact-row" href={whatsapp} target="_blank" rel="noreferrer">
                <MessageCircle size={15} strokeWidth={2} className="footer__ico" aria-hidden="true" />
                <span>{settings.whatsapp || "WhatsApp"}</span>
              </a>
            ) : null}
            {settings.email ? (
              <a className="footer__contact-row" href={`mailto:${settings.email}`}>
                <Mail size={15} strokeWidth={2} className="footer__ico" aria-hidden="true" />
                <span>{settings.email}</span>
              </a>
            ) : null}
            {instagram ? (
              <a className="footer__contact-row" href={instagram} target="_blank" rel="noreferrer">
                <AtSign size={15} strokeWidth={2} className="footer__ico" aria-hidden="true" />
                <span>{instagramHandle(settings.social?.instagram) || "Instagram"}</span>
              </a>
            ) : null}          </div>
        </div>
      </div>
      <div className="footer__base">
        <span className="footer__copy">
          {company
            ? `Copyright ${company.nome_fantasia}${company.razao_social ? ` — ${company.razao_social}` : ""} · CNPJ ${company.cnpj} — ${year}. Todos os direitos reservados.`
            : `© ${year} Airsoft Americana. Todos os direitos reservados.`}
        </span>
        <span className="footer__age">Produtos com restrição de idade: 18+</span>
        <PaymentMarks />
      </div>

      {ok && (
        <div className="footer__ok-toast" role="status" aria-live="polite">
          <p className="newsletter-ok">Feito. A gente avisa quando entrar novidade.</p>
        </div>
      )}
    </footer>
  );
}
