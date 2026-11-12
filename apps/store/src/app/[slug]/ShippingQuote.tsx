// language: TSX, file: apps/store/src/app/[slug]/ShippingQuote.tsx, target: Next.js App Router
// Calculadora de frete por CEP na PDP — máscara ao digitar, auto-submit
// ao completar 8 dígitos, debounce, cache e feedback inline.
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Truck, CheckCircle2, AlertCircle } from "lucide-react";

const API_URL = "";

type Option = {
  carrier: string;
  service: string;
  days: number;
  priceCents: number;
  free: boolean;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function cepDigits(value: string): string {
  return value.replace(/\D+/g, "").slice(0, 8);
}

function formatCep(value: string): string {
  const d = cepDigits(value);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

function isCompleteCep(value: string): boolean {
  return cepDigits(value).length === 8;
}

/* ───────── hook de CEP para cotação (debounce + cache) ───────── */
function useShippingQuote(variantId: string, subtotalCents: number, weightGrams: number) {
  const [zip, setZip] = useState("");
  const [options, setOptions] = useState<Option[] | null>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const doneRef = useRef<Record<string, Option[]>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const quote = useCallback(async (digits: string) => {
    if (doneRef.current[digits]) {
      setOptions(doneRef.current[digits]);
      setStatus("ok");
      setErrorMsg("");
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("busy");
    setErrorMsg("");

    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/shipping/quote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            zip: digits,
            subtotalCents,
            items: [{ variantId, quantity: 1 }],
            weightGrams,
          }),
        });
        const json = (await res.json()) as { options?: Option[]; error?: { message?: string } };
        if (!res.ok || !json.options) {
          setErrorMsg(json.error?.message ?? "Não foi possível calcular o frete.");
          setOptions(null);
          setStatus("error");
          return;
        }
        doneRef.current[digits] = json.options;
        setOptions(json.options);
        setStatus("ok");
      } catch {
        setErrorMsg("Erro de conexão com a API.");
        setOptions(null);
        setStatus("error");
      }
    }, 180);
  }, [variantId, subtotalCents, weightGrams]);

  const onZipChange = useCallback((value: string) => {
    const masked = formatCep(value);
    setZip(masked);
    if (isCompleteCep(masked)) {
      quote(cepDigits(masked));
    } else {
      setOptions(null);
      setStatus("idle");
      setErrorMsg("");
    }
  }, [quote]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setZip("");
    setOptions(null);
    setStatus("idle");
    setErrorMsg("");
  }, []);

  return { zip, options, status, errorMsg, onZipChange, reset, quote };
}

export function ShippingQuote({
  variantId,
  subtotalCents,
  weightGrams,
  freeShippingFrom,
}: {
  variantId: string;
  subtotalCents: number;
  weightGrams: number;
  freeShippingFrom: number;
}) {
  const { zip, options, status, errorMsg, onZipChange, reset, quote } = useShippingQuote(variantId, subtotalCents, weightGrams);
  const qualifiesFree = freeShippingFrom > 0 && subtotalCents >= freeShippingFrom;

  return (
    <div className="ship">
      <form className="ship__form" onSubmit={(e) => { e.preventDefault(); if (isCompleteCep(zip)) quote(cepDigits(zip)); }}>
        <label htmlFor="cep-pdp" className="ship__label">
          <Truck size={16} /> Calcular frete e prazo
        </label>
        <div className="ship__row">
          <div className="relative flex-1">
            <input
              id="cep-pdp"
              value={zip}
              onChange={(e) => onZipChange(e.target.value)}
              placeholder="00000-000"
              inputMode="numeric"
              maxLength={9}
              className="ship__input pr-12"
              disabled={status === "busy"}
            />
            {status === "busy" && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary" aria-hidden="true">
                <Loader2 size={18} className="animate-spin" />
              </span>
            )}
            {status === "ok" && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--primary-dark)]" aria-hidden="true">
                <CheckCircle2 size={18} strokeWidth={3} />
              </span>
            )}
            {status === "error" && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#f87171]" aria-hidden="true">
                <AlertCircle size={18} strokeWidth={2.2} />
              </span>
            )}
          </div>
          <button type="submit" className="btn-primary btn-sm" disabled={status === "busy" || !isCompleteCep(zip)}>
            {status === "busy" ? <Loader2 size={14} className="animate-spin" /> : "Calcular"}
          </button>
        </div>

        <p className="mt-1.5 text-sm" style={{
          color: status === "busy" ? "var(--primary)" :
                 status === "ok" ? "var(--primary-dark)" :
                 status === "error" ? "#f87171" : "var(--muted-foreground)"
        }}>
          {status === "busy" && "Consultando frete…"}
          {status === "ok" && "Frete calculado — escolha a opção abaixo."}
          {status === "error" && errorMsg}
        </p>

        {qualifiesFree && (
          <p className="ship__note mt-2">Seu pedido já garante frete grátis nesta compra.</p>
        )}

        <button type="button" className="btn-ghost btn-sm mt-2" onClick={reset}>
          Limpar CEP
        </button>
      </form>

      {options && options.length > 0 && (
        <ul className="ship__options mt-4">
          {options.map((o) => (
            <li key={`${o.carrier}-${o.service}`} className="ship__option">
              <span className="ship__carrier">
                {o.carrier} <strong>{o.service}</strong>
              </span>
              <span className="ship__days">
                {o.days} {o.days === 1 ? "dia útil" : "dias úteis"}
              </span>
              <span className="ship__price">{o.free ? "Grátis" : brl(o.priceCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}