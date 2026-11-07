// language: TSX, file: apps/store/src/app/[slug]/ShippingQuote.tsx, target: Next.js App Router
// Calculadora de frete por CEP na PDP — consulta a API real de cotação.
"use client";

import { useState } from "react";
import { Loader2, Truck } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
  const [zip, setZip] = useState("");
  const [options, setOptions] = useState<Option[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function quote(e: React.FormEvent) {
    e.preventDefault();
    const digits = zip.replace(/\D/g, "");
    if (digits.length !== 8) {
      setError("Digite um CEP válido com 8 dígitos.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/shipping/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          zip: digits,
          subtotalCents: 0,
          items: [{ variantId, quantity: 1 }],
        }),
      });
      const json = (await res.json()) as { options?: Option[]; error?: { message?: string } };
      if (!res.ok || !json.options) {
        setError(json.error?.message ?? "Não foi possível calcular o frete.");
        setOptions(null);
        return;
      }
      setOptions(json.options);
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  const qualifiesFree = freeShippingFrom > 0 && subtotalCents >= freeShippingFrom;

  return (
    <div className="ship">
      <form onSubmit={quote} className="ship__form">
        <label htmlFor="cep-pdp" className="ship__label">
          <Truck size={16} />
          Calcular frete e prazo
        </label>
        <div className="ship__row">
          <input
            id="cep-pdp"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            placeholder="00000-000"
            inputMode="numeric"
            maxLength={9}
            className="ship__input"
          />
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : "Calcular"}
          </button>
        </div>
        {error && <p className="ship__error">{error}</p>}
        {qualifiesFree && (
          <p className="ship__note">Seu pedido já garante frete grátis nesta compra.</p>
        )}
      </form>

      {options && (
        <ul className="ship__options">
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
