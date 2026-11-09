// language: TSX, file: apps/store/src/app/cart/CartItems.tsx, target: Next.js App Router
// Carrinho profissional — dark theme, dados reais, cálculo no servidor
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ShoppingCart, Trash2 } from "lucide-react";

const API_URL = "";

type Item = {
  variantId: string;
  sku: string;
  slug: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  available: number;
  imageUrl?: string | null;
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

  useEffect(() => { load(); }, []);

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
      <div className="cart-skeleton">
        <div className="cart-skeleton__row" />
        <div className="cart-skeleton__row" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="cart-empty">
        <div className="cart-empty__icon" aria-hidden="true">🛒</div>
        <h2 className="cart-empty__title">Carrinho vazio</h2>
        <p className="cart-empty__text">Você ainda não adicionou nenhum item. Navegue pelo catálogo e monte sua missão.</p>
        <Link href="/catalogo" className="btn-primary">CATÁLOGO</Link>
      </div>
    );
  }

  return (
    <div className="cart">
      {error && <p className="cart__error" role="alert">{error}</p>}

      <ul className="cart__list" role="list">
        {items.map((item) => (
          <li key={item.variantId} className="cart__item">
            <div className="cart__item-media">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt=""
                  width={80}
                  height={80}
                  className="cart__item-img"
                />
              ) : (
                <div className="cart__item-img cart__item-img--empty" aria-hidden="true" />
              )}
            </div>

            <div className="cart__item-info">
              <Link href={`/${item.slug}`} className="cart__item-title">{item.name}</Link>
              <p className="cart__item-meta">SKU {item.sku} · {item.available} un. em estoque</p>
            </div>

            <div className="cart__item-qty">
              <button
                type="button"
                disabled={busy || item.quantity <= 1}
                onClick={() => mutate("PATCH", `${API_URL}/api/cart/items/${item.variantId}`, { quantity: item.quantity - 1 })}
                className="cart__qty-btn"
                aria-label="Diminuir quantidade"
              >
                <span aria-hidden="true">−</span>
              </button>
              <span className="cart__qty-value">{item.quantity}</span>
              <button
                type="button"
                disabled={busy || item.quantity >= item.available}
                onClick={() => mutate("PATCH", `${API_URL}/api/cart/items/${item.variantId}`, { quantity: item.quantity + 1 })}
                className="cart__qty-btn"
                aria-label="Aumentar quantidade"
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>

            <div className="cart__item-total">
              <p className="cart__item-price">{brl(item.totalCents)}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => mutate("DELETE", `${API_URL}/api/cart/items/${item.variantId}`)}
                className="cart__remove-btn"
                aria-label={`Remover ${item.name}`}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="cart__summary">
        <div className="cart__summary-row">
          <span className="cart__summary-label">Subtotal</span>
          <strong className="cart__summary-value">{brl(subtotal)}</strong>
        </div>

        <form className="cart__coupon" onSubmit={(e) => { e.preventDefault(); if (!couponCode.trim()) return; mutate("POST", `${API_URL}/api/cart/coupon`, { code: couponCode.trim() }); setCouponCode(""); }}>
          <label className="sr-only" htmlFor="cart-coupon">Cupom</label>
          <input
            id="cart-coupon"
            type="text"
            placeholder="Cupom (ex: PIX5)"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            className="cart__coupon-input"
            disabled={busy}
          />
          <button type="submit" className="btn-primary cart__coupon-btn" disabled={busy || !couponCode.trim()}>
            APLICAR
          </button>
        </form>

        <p className="cart__note">Frete e desconto final calculados no servidor ao finalizar.</p>

        <Link href="/checkout" className="btn-primary cart__checkout-btn">
          FINALIZAR COMPRA
        </Link>
      </div>
    </div>
  );
}

// Image import for Next.js
import Image from "next/image";