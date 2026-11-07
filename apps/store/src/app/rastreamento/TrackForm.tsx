// language: TSX, file: apps/store/src/app/rastreamento/TrackForm.tsx, target: Next.js App Router
// Consulta de rastreamento: número do pedido + e-mail.
"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, PackageSearch } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type TrackResult = {
  order: {
    number: string;
    status: string;
    subtotalCents: number;
    discountCents: number;
    shippingCents: number;
    totalCents: number;
    paymentMethod: string | null;
    createdAt: string;
  };
  items: { name: string; quantity: number; unitPriceCents: number; totalCents: number }[];
  shipment: {
    carrier: string;
    trackingCode: string | null;
    estimatedDays: number | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  } | null;
  events: { status: string; description: string | null; createdAt: string }[];
  history: { toStatus: string; reason: string | null; createdAt: string }[];
};

const STATUS_LABEL: Record<string, string> = {
  aguardando_pagamento: "Aguardando pagamento",
  pagamento_em_processamento: "Pagamento em processamento",
  em_analise_antifraude: "Em análise antifraude",
  aguardando_revisao_manual: "Aguardando revisão",
  pagamento_aprovado: "Pagamento aprovado",
  separacao: "Em separação",
  preparando_envio: "Preparando envio",
  enviado: "Enviado",
  entregue: "Entregue",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
  em_disputa: "Em disputa",
  chargeback_recebido: "Chargeback recebido",
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateBr(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function TrackForm() {
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function track(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(
        `${API_URL}/api/store/orders/track?number=${encodeURIComponent(number)}&email=${encodeURIComponent(email)}`,
        { credentials: "include" },
      );
      const json = (await res.json()) as TrackResult & { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "Não foi possível localizar o pedido.");
        return;
      }
      setResult(json);
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={track} className="track__form">
        <div>
          <label htmlFor="track-number">Número do pedido</label>
          <input
            id="track-number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="AA-2026-0001"
            required
          />
        </div>
        <div>
          <label htmlFor="track-email">E-mail da compra</label>
          <input
            id="track-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com"
            required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <PackageSearch size={16} />}
          Consultar
        </button>
      </form>

      {error && <p className="track__error">{error}</p>}

      {result && (
        <div className="track__result">
          <div className="track__head">
            <div>
              <span className="sec-kicker">Pedido {result.order.number}</span>
              <p className="track__status">
                {STATUS_LABEL[result.order.status] ?? result.order.status}
              </p>
            </div>
            <span className="track__total">{brl(result.order.totalCents)}</span>
          </div>

          {result.shipment && (
            <div className="track__shipment">
              <strong>
                {result.shipment.carrier}
                {result.shipment.trackingCode ? ` · ${result.shipment.trackingCode}` : ""}
              </strong>
              {result.shipment.estimatedDays && (
                <span>Previsão de {result.shipment.estimatedDays} dias úteis</span>
              )}
            </div>
          )}

          <ul className="track__items">
            {result.items.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <span>
                  {item.quantity}× {item.name}
                </span>
                <span>{brl(item.totalCents)}</span>
              </li>
            ))}
          </ul>

          {result.events.length > 0 && (
            <div className="track__timeline">
              {result.events.map((ev, index) => (
                <div key={`${ev.status}-${index}`} className="track__event">
                  <span className="track__dot" />
                  <div>
                    <strong>{ev.description ?? ev.status}</strong>
                    <span>{dateBr(ev.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Link href="/atendimento" className="sec-link">
            Precisa de ajuda? Falar com o atendimento
          </Link>
        </div>
      )}
    </>
  );
}
