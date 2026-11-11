"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

type Variant = "entrar" | "cadastro";

type TopbarSettings = {
  free_shipping_from_cents: number;
  pix_discount_percent: number;
  installments: number;
} | null;

/* Fatos estáticos da operação — acompanham o CNPJ/contrato, não o tema. */
const STATIC_FACTS: Record<"entrar" | "cadastro", { k: string; v: string }[]> = {
  entrar: [
    { k: "Envio", v: "Correios PAC/SEDEX" },
    { k: "Loja física", v: "Americana SP" },
  ],
  cadastro: [
    { k: "Envio", v: "Correios PAC/SEDEX" },
    { k: "Loja física", v: "Americana SP" },
  ],
};

const SETTINGS_URL = `${""}/api/store/settings`;

function useCommercialFacts(variant: Variant) {
  const [settings, setSettings] = useState<TopbarSettings>(null);
  useEffect(() => {
    let alive = true;
    fetch(SETTINGS_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (alive) setSettings(j);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const fmt = (cents: number | null | undefined) =>
    cents == null || cents === 0
      ? ""
      : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  /* Condições só com número real do banco — antes disso, esqueleto na forma
     do conteúdo. Nunca inventar valor (o site antigo exibia thresholds
     divergentes entre páginas). */
  const live: { k: string; v: string }[] = [];
  if (settings) {
    if (settings.pix_discount_percent > 0) live.push({ k: "Pagamento", v: `PIX −${settings.pix_discount_percent}%` });
    if (settings.installments > 1) live.push({ k: "Parcelamento", v: `${settings.installments}x sem juros` });
    if (settings.free_shipping_from_cents > 0)
      live.push({ k: "Frete grátis", v: `acima de ${fmt(settings.free_shipping_from_cents)}` });
  }

  const spec = variant === "cadastro" && settings ? [{ k: "Conta", v: "sem taxa de adesão" }, ...live] : [...live];
  const loaded = spec.length > 0;
  return { spec: [...spec, ...STATIC_FACTS[variant]], loaded };
}

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

export function AuthShowcase({ variant }: { variant: Variant }) {
  const reduce = useReducedMotion();
  const { spec, loaded } = useCommercialFacts(variant);

  const enter = (delay: number) =>
    reduce
      ? { initial: false as const, animate: { opacity: 1, x: 0, y: 0 } }
      : {
          initial: { opacity: 0, x: -24 },
          animate: { opacity: 1, x: 0 },
          transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  const isSignup = variant === "cadastro";

  return (
    <section className="auth-hero">
      {/* Mira girando devagar — some no reduced-motion */}
      <motion.svg
        className="auth-crosshair"
        width="360"
        height="360"
        viewBox="0 0 360 360"
        fill="none"
        aria-hidden="true"
        animate={reduce ? {} : { rotate: 360 }}
        transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
      >
        <circle cx="180" cy="180" r="178" stroke="#8BCF16" strokeWidth="1.4" />
        <circle cx="180" cy="180" r="126" stroke="#8BCF16" strokeWidth="1.1" opacity="0.7" />
        <circle cx="180" cy="180" r="74" stroke="#8BCF16" strokeWidth="1" />
        <path d="M180 0v360M0 180h360" stroke="#8BCF16" strokeWidth="1.2" />
        <circle cx="180" cy="180" r="5" fill="#8BCF16" />
      </motion.svg>

      {/* Marca */}
      <div className="relative">
        <Link href="/" className="auth-brand group">
          <Image
            src="/emblema.png"
            alt=""
            width={537}
            height={512}
            className="h-13 w-13 object-contain"
            priority
          />
          <div>
            <p className="auth-brand__name">
              Airsoft{" "}
              <span className="text-[var(--primary)] group-hover:text-[var(--primary-dark)] transition-colors">
                Americana
              </span>
            </p>
            <p className="auth-brand__sub">Equipamentos e acessórios</p>
          </div>
        </Link>
      </div>

      {/* Manifesto dentro da retícula */}
      <div className="relative">
        <div className="auth-reticle">
          <span className="auth-reticle__corner auth-reticle__corner--tr" aria-hidden="true" />
          <span className="auth-reticle__corner auth-reticle__corner--bl" aria-hidden="true" />

          <motion.p {...enter(0.05)} className="auth-kicker">
            {isSignup ? "Nova ficha // sem taxa" : "Acesso // ficha existente"}
          </motion.p>

          <div className="auth-ruler" aria-hidden="true" />

          <motion.h1
            {...enter(0.12)}
            className="auth-headline"
            style={{ fontSize: "clamp(2.6rem, 6vw, 4.5rem)" }}
          >
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
          </motion.h1>

          <motion.p {...enter(0.2)} className="auth-lead mt-5">
            {isSignup
              ? "Leva um minuto. Cadastra uma vez e as próximas compras resolvem conta, pagamento e rastreio sem você repetir nada."
              : "Entra com o e-mail que você cadastrou: pedidos, rastreio e checkout pronto pro próximo tiro."}
          </motion.p>

          <ul className="mt-7 flex flex-col gap-2.5 max-w-md">
            {CHECKLIST[variant].map((item, i) => (
              <motion.li
                key={item}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.45,
                  delay: 0.26 + i * 0.09,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="check-item"
              >
                <CheckCircle2
                  size={18}
                  className="mt-0.5 flex-none text-[var(--primary)]"
                  strokeWidth={2.2}
                />
                <span>{item}</span>
              </motion.li>
            ))}
          </ul>

          {/* Ficha técnica — dados reais da operação */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.55,
              delay: 0.34,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="spec-plate mt-8"
          >
            {loaded
              ? spec.map((row) => (
                  <div key={row.k} className="spec-plate__row">
                    <span className="spec-plate__k">{row.k}</span>
                    <span className="spec-plate__v">{row.v}</span>
                  </div>
                ))
              : /* Skeleton na forma do conteúdo enquanto as condições vêm do banco */
                STATIC_FACTS[variant].map((row) => (
                  <div key={row.k} className="spec-plate__row">
                    <span className="spec-plate__k">{row.k}</span>
                    <span className="spec-plate__v spec-plate__v--skeleton">…</span>
                  </div>
                ))}
          </motion.div>
        </div>
      </div>

      {/* Rodapé técnico + carimbo 18+ */}
      <div className="relative flex items-end justify-between gap-6 border-t border-[var(--border)] pt-5">
        <div className="font-mono-t text-[0.6rem] uppercase tracking-[0.16em] text-[#929890] leading-relaxed">
          <p>Seg–sex 08h45–18h · Sáb 09h–12h</p>
          <p className="text-[#c8cbc8]">@airsoftamericana · Entrega Brasil</p>
        </div>
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
