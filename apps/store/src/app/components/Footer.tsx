// language: TSX, file: apps/store/src/app/components/Footer.tsx, target: Next.js App Router
// Rodapé: informações reais da operação, navegação e newsletter. Sem ícones decorativos, sem links vazios.
"use client";

import Link from "next/link";
import { useState } from "react";
import type { CommercialSettings } from "../lib/store";
import { formatBRL } from "../lib/store";

const departments = [
  { label: "Airsoft", href: "/departamento/airsoft" },
  { label: "Tiro Esportivo", href: "/departamento/tiro-esportivo" },
  { label: "Upgrades", href: "/departamento/upgrades" },
  { label: "Loadout", href: "/departamento/loadout" },
  { label: "Life Style", href: "/departamento/life-style" },
  { label: "Aventura", href: "/departamento/aventura" },
];

const infoLinks = [
  { label: "Atendimento ao cliente", href: "/atendimento" },
  { label: "Loja física", href: "/institucional" },
  { label: "Trocas / devoluções / garantias", href: "/termos" },
  { label: "Perguntas frequentes", href: "/busca" },
  { label: "Condições de frete", href: "/frete" },
  { label: "Termos de compra", href: "/termos" },
];

const paymentMethods = ["Visa", "Mastercard", "Elo", "Hipercard", "American Express", "Boleto", "PIX"];

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

export function Footer({ settings }: { settings: CommercialSettings }) {
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
            <span className="footer__promise-label">Entrega</span>
            <span>{free > 0 ? `Frete grátis acima de ${formatBRL(free)}` : "Entrega para todo o Brasil"}</span>
          </div>
          <div className="footer__promise">
            <span className="footer__promise-label">Pagamento</span>
            <span>
              {inst > 1 ? `${inst}x${settings.installment_interest_free !== false ? " sem juros" : ""}` : "À vista"}
              {minInst > 0 ? ` · parcela mínima ${formatBRL(minInst)}` : ""}
            </span>
          </div>
          {pix > 0 ? (
            <div className="footer__promise">
              <span className="footer__promise-label">PIX</span>
              <span>{pix}% de desconto à vista</span>
            </div>
          ) : null}
          <div className="footer__promise">
            <span className="footer__promise-label">Pós-venda</span>
            <span>Trocas e devoluções conforme política</span>
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
              {settings.address.street}
              {settings.address.district ? ` — ${settings.address.district}` : ""}
            </address>
            <p className="footer__line">
              {settings.address.city}/{settings.address.state} — CEP {settings.address.zip}
            </p>
          </div>
          <div className="footer__block">
            <p className="footer__label">Horário</p>
            <p className="footer__line">{settings.service_hours}</p>
          </div>
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
            {settings.whatsapp ? (
              <div className="footer__contact-row">
                <span>WhatsApp: {settings.whatsapp}</span>
              </div>
            ) : null}
            {settings.email ? (
              <div className="footer__contact-row">
                <span>{settings.email}</span>
              </div>
            ) : null}
          </div>
          {(instagram || whatsapp) ? (
            <div className="footer__social">
              {instagram ? (
                <a href={instagram} target="_blank" rel="noreferrer" className="footer__social-link">
                  Instagram
                </a>
              ) : null}
              {whatsapp ? (
                <a href={whatsapp} target="_blank" rel="noreferrer" className="footer__social-link">
                  WhatsApp
                </a>
              ) : null}
              <span className="footer__social-handle">@airsoftamericana</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="footer__base">
        <span className="footer__copy">© {year} Airsoft Americana. Todos os direitos reservados.</span>
        <span className="footer__age">Produtos com restrição de idade: 18+</span>
        <div className="footer__payments">
          {paymentMethods.map((m) => (
            <span key={m} className="footer__payment-chip">
              {m}
            </span>
          ))}
        </div>
      </div>

      {ok && (
        <div className="footer__ok-toast" role="status" aria-live="polite">
          <p className="newsletter-ok">Feito. A gente avisa quando entrar novidade.</p>
        </div>
      )}
    </footer>
  );
}
