"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Item = {
  variantId: string;
  sku: string;
  slug: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  available: number;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CartItems() {
  const [items, setItems] = useState<Item[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [couponCode, setCouponCode] = useState("");

  async function load() {
    try {
      const res = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
      const json = (await res.json().catch(() => ({}))) as { items?: Item[]; subtotalCents?: number };
      setItems(json.items ?? []);
      setSubtotal(json.subtotalCents ?? 0);
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const mutate = useCallback(async (method: string, url: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as { items?: Item[]; subtotalCents?: number; error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "Falha ao atualizar carrinho.");
        return;
      }
      setItems(json.items ?? []);
      setSubtotal(json.subtotalCents ?? 0);
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 px-5">
        <div className="h-24 bg-white border border-[#e5e7eb]" />
        <div className="h-24 bg-white border border-[#e5e7eb]" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-5 py-24">
        <div className="text-center">
          <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6">
            0
          </div>
          <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-[#111] mb-6">
            Carrinho vazio
          </h1>
          <p className="text-[#666] font-mono text-xs max-w-md mx-auto mb-10">
            Você ainda não adicionou nenhum item. Navegue pelo catálogo e monte sua missão.
          </p>
          <Link href="/catalogo" className="btn-primary px-8 py-3">
            CATÁLOGO
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 space-y-10">
      {error && (
        <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-6">{error}</p>
      )}

      <ul className="space-y-6">
        {items.map((item) => (
          <li key={item.variantId} className="border border-[#e5e7eb] bg-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
            <div className="flex flex-col gap-2">
              <Link href={`/${item.slug}`} className="font-display font-black text-xl uppercase leading-none tracking-tight text-[#111] group-hover:text-[#8bcf16] transition-colors">
                {item.name}
              </Link>
              <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666]">
                SKU {item.sku} · {item.available} un. em estoque
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 border border-[#e5e7eb] bg-[#000]">
                <button
                  type="button"
                  disabled={busy || item.quantity <= 1}
                  onClick={() => mutate("PATCH", `${API_URL}/api/cart/items/${item.variantId}`, { quantity: item.quantity - 1 })}
                  className="w-10 h-10 flex items-center justify-center text-[#8bcf16] font-black text-xl hover:bg-[#8bcf16] hover:text-[#000] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Diminuir quantidade"
                >
                  −
                </button>
                <span className="font-mono text-sm font-bold text-[#111] w-8 text-center">{item.quantity}</span>
                <button
                  type="button"
                  disabled={busy || item.quantity >= item.available}
                  onClick={() => mutate("PATCH", `${API_URL}/api/cart/items/${item.variantId}`, { quantity: item.quantity + 1 })}
                  className="w-10 h-10 flex items-center justify-center text-[#8bcf16] font-black text-xl hover:bg-[#8bcf16] hover:text-[#000] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Aumentar quantidade"
                >
                  +
                </button>
              </div>

              <div className="text-right">
                <p className="font-display font-black text-2xl text-[#8bcf16]">{brl(item.totalCents)}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mutate("DELETE", `${API_URL}/api/cart/items/${item.variantId}`)}
                  className="mt-2 font-mono text-[0.6rem] uppercase tracking-widest text-[#666] hover:text-[#8bcf16] transition-colors underline underline-offset-4"
                >
                  Remover
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="border border-[#e5e7eb] bg-white p-8">
        <div className="flex justify-between items-baseline mb-8">
          <span className="font-mono text-xs uppercase tracking-widest text-[#666]">Subtotal</span>
          <b className="font-display font-black text-3xl text-[#8bcf16]">{brl(subtotal)}</b>
        </div>

        <div className="flex gap-2 max-w-sm">
          <input
            type="text"
            placeholder="Cupom (ex: PIX5)"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            className="input flex-1"
          />
          <button
            type="button"
            disabled={busy || !couponCode.trim()}
            onClick={() => {
              if (!couponCode.trim()) return;
              mutate("POST", `${API_URL}/api/cart/coupon`, { code: couponCode.trim() });
              setCouponCode("");
            }}
            className="btn-primary px-6 py-3 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            APLICAR
          </button>
        </div>

        <p className="mt-4 font-mono text-[0.6rem] uppercase tracking-widest text-[#333]">
          Frete e desconto final calculados no servidor ao finalizar.
        </p>

        <Link href="/checkout" className="mt-8 block btn-primary w-full justify-center py-4">
          FINALIZAR COMPRA
        </Link>
      </div>
    </div>
  );
}
