// language: TSX, file: apps/store/src/app/components/AuthShowcase.tsx, target: Next.js App Router
// Manifesto da marca nas telas de acesso: posicionamento, checklist do que a
// conta entrega e as condições comerciais — tudo lido do settings (fonte
// única); sem número digitado aqui. Sem animação por elemento: o shell já
// tem a entrada única em CSS.
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { API_URL, type CommercialSettings } from "../lib/store";

type Variant = "entrar" | "cadastro";

const CHECKLIST: Record<Variant, readonly string[]> = {
  entrar: [
    "Pedidos e rastreio na mesma tela",
    "Checkout com seus dados já preenchidos",
    "Seus dados guardados conforme a LGPD",
  ],
  cadastro: [
    "Pedidos, rastreio e seus dados na mesma tela",
    "Sem taxa de adesão e sem assinatura",
    "Produtos 18+ sinalizados no catálogo",
  ],
};

const fmt = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Condições comerciais do banco — linha some quando o dado não existe. */
function commercialRows(variant: Variant, s: CommercialSettings): { k: string; v: string }[] {
  const rows: { k: string; v: string }[] = [];
  if (variant === "cadastro") rows.push({ k: "Conta", v: "sem taxa de adesão" });
  if (s.pix_discount_percent > 0) rows.push({ k: "Pagamento", v: `PIX −${s.pix_discount_percent}%` });
  if (s.installments > 1)
    rows.push({
      k: "Parcelamento",
      v: `${s.installments}x${s.installment_interest_free ? " sem juros" : ""}`,
    });
  if (s.free_shipping_from_cents > 0)
    rows.push({ k: "Frete grátis", v: `acima de ${fmt(s.free_shipping_from_cents)}` });
  if (s.shipping_carriers.length > 0)
    rows.push({ k: "Envio", v: s.shipping_carriers.join(" e ") });
  const city = [s.address.city, s.address.state].filter(Boolean).join(", ");
  if (city) rows.push({ k: "Loja física", v: city });
  return rows;
}

function useSettings() {
  const [settings, setSettings] = useState<CommercialSettings | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/store/settings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (alive) setSettings(j);
      })
      .catch(() => {
        /* sem rede o manifesto sai sem as linhas de condição — nada inventado */
      });
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

export function AuthShowcase({ variant }: { variant: Variant }) {
  const settings = useSettings();
  const rows = settings ? commercialRows(variant, settings) : null;
  const isSignup = variant === "cadastro";
  const hours = settings?.service_hours.trim() ?? "";
  const instagram = settings?.social.instagram.trim() ?? "";

  return (
    <section className="auth-hero">
      {/* Marca */}
      <Link href="/" className="auth-brand">
        <Image
          src="/emblema.png"
          alt=""
          width={537}
          height={512}
          className="h-13 w-13 object-contain"
          priority
        />
        <div>
          <p className="auth-brand__name">Airsoft Americana</p>
          <p className="auth-brand__sub">Equipamentos e acessórios</p>
        </div>
      </Link>

      {/* Manifesto */}
      <div className="auth-manifesto">
        <p className="auth-kicker">
          {isSignup ? "Nova ficha // sem taxa" : "Acesso // ficha existente"}
        </p>
        {/* O h1 da página é o título do formulário — aqui é texto de vitrine */}
        <p className="auth-headline">
          {isSignup ? (
            <>
              Abra sua
              <br />
              <em>ficha.</em>
            </>
          ) : (
            <>
              Volta pro
              <br />
              <em>campo.</em>
            </>
          )}
        </p>
        <p className="auth-lead">
          {isSignup
            ? "Leva um minuto. Cadastra uma vez e as próximas compras resolvem conta, pagamento e rastreio sem você repetir nada."
            : "Entra com o e-mail que você cadastrou: pedidos, rastreio e checkout pronto pro próximo tiro."}
        </p>

        <ul className="auth-checks">
          {CHECKLIST[variant].map((item) => (
            <li key={item} className="check-item">
              <CheckCircle2 size={18} className="mt-0.5 flex-none text-[var(--primary)]" strokeWidth={2.2} />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        {/* Ficha técnica — só linhas com dado real; esqueleto até o settings chegar */}
        {rows && rows.length > 0 ? (
          <div className="spec-plate">
            {rows.map((row) => (
              <div key={row.k} className="spec-plate__row">
                <span className="spec-plate__k">{row.k}</span>
                <span className="spec-plate__v">{row.v}</span>
              </div>
            ))}
          </div>
        ) : rows ? null : (
          <div className="spec-plate" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="spec-plate__row">
                <span className="auth-skel auth-skel--label" />
                <span className="auth-skel auth-skel--value" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Horário e instagram do settings + carimbo 18+ */}
      <div className="auth-hero__foot">
        {settings ? (
          (hours || instagram) && (
            <div>
              {hours && <p className="auth-hours">{hours}</p>}
              {instagram && <p className="auth-handle">@{instagram} · Entrega Brasil</p>}
            </div>
          )
        ) : (
          <span className="auth-skel auth-skel--line" aria-hidden="true" />
        )}
        <div
          className="age-stamp"
          aria-label="Produtos com restrição de idade: 18 anos ou mais"
        >
          <span>18+</span>
          <small>ANOS</small>
        </div>
      </div>
    </section>
  );
}
