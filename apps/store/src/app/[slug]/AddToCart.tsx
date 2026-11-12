// language: TSX, file: apps/store/src/app/[slug]/AddToCart.tsx, target: Next.js App Router
// Seção de compra da PDP (#comprar): seletor de opção (tamanho/cor — derivado
// do nome real das variantes), quantidade limitada pelo estoque restante e os
// dois destinos: Adicionar (soma no carrinho) e Comprar agora (carrinho).
// POST /api/cart/items grava quantidade absoluta — o alvo é sempre
// carrinho + escolhido (regra do OrderDetailModal); 409 mostra o disponível.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, ShoppingCart, Zap } from "lucide-react";
import { API_URL, formatBRL, pixPrice, type CommercialSettings, type StoreProduct } from "../lib/store";
import { effectiveVariantPrice, maxAddQuantity, nextCartQuantity, variantChips } from "../lib/buy";

type Props = {
  product: StoreProduct;
  settings: CommercialSettings;
};

type CartQty = Record<string, number>;

export function AddToCart({ product, settings }: Props) {
  const router = useRouter();
  const variants = useMemo(
    () => (product.variants ?? []).filter((v) => v.active),
    [product.variants],
  );
  const { header, chips } = useMemo(() => variantChips(variants), [variants]);
  const [variantId, setVariantId] = useState(
    () => variants.find((v) => v.available > 0)?.id ?? variants[0]?.id ?? "",
  );
  const [qty, setQty] = useState(1);
  const [cartQty, setCartQty] = useState<CartQty>({});
  const [busy, setBusy] = useState<"" | "add" | "buy">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const selected = variants.find((v) => v.id === variantId) ?? null;
  const inCart = selected ? (cartQty[selected.id] ?? 0) : 0;
  const unidadeUnica = Boolean(product.unidade_unica);
  const maxAdd = selected
    ? maxAddQuantity({ available: selected.available, inCart, unidadeUnica })
    : 0;
  const canBuyNow = Boolean(selected) && (maxAdd > 0 || inCart > 0);
  const unit = selected ? effectiveVariantPrice(selected) : product.priceCents;
  const unitPix = pixPrice(unit, settings);

  // Uma leitura do carrinho: stepper limita pelo estoque restante e o POST soma.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
        const json = (await res.json().catch(() => ({}))) as {
          items?: Array<{ variantId: string; quantity: number }>;
        };
        if (!alive) return;
        const map: CartQty = {};
        for (const item of json.items ?? []) map[item.variantId] = item.quantity;
        setCartQty(map);
      } catch {
        // sem carrinho lido segue com 0 — o POST do servidor continua a fonte da verdade
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Rede de segurança do link /{slug}#comprar: se a âncora não rolar sozinha
  // (render dinâmico atrasado), rola agora — evita brigar com o scroll nativo.
  useEffect(() => {
    if (window.location.hash !== "#comprar") return;
    const el = document.getElementById("comprar");
    if (!el) return;
    const timer = setTimeout(() => {
      const top = el.getBoundingClientRect().top;
      if (top < -10 || top > 260) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  function clampQty(value: number): number {
    const ceiling = unidadeUnica ? 1 : Math.max(1, Math.min(999, maxAdd || 1));
    if (!Number.isFinite(value)) return 1;
    return Math.min(ceiling, Math.max(1, Math.floor(value)));
  }

  async function submit(goToCart: boolean) {
    if (!selected || busy) return;
    if (!goToCart && maxAdd <= 0) return;
    if (goToCart && !canBuyNow) return;

    // já está tudo no carrinho: comprar agora só leva para lá
    if (maxAdd <= 0 && inCart > 0) {
      router.push("/cart");
      return;
    }

    setBusy(goToCart ? "buy" : "add");
    setError("");
    try {
      const target = nextCartQuantity(inCart, qty);
      const res = await fetch(`${API_URL}/api/cart/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ variantId: selected.id, quantity: target }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        items?: Array<{ variantId: string; quantity: number }>;
        error?: { code?: string; message?: string; available?: number };
      };
      if (!res.ok) {
        if (res.status === 409 && json.error?.code === "insufficient_stock") {
          const available = json.error.available ?? 0;
          setError(
            available <= 0
              ? "Sem estoque no momento."
              : `Só ${available} unidade${available > 1 ? "s" : ""} em estoque${inCart > 0 ? ` e você já tem ${inCart} no carrinho` : ""}.`,
          );
        } else {
          setError(json.error?.message ?? "Falha ao adicionar.");
        }
        return;
      }

      if (goToCart) {
        router.push("/cart");
        return;
      }
      setCartQty((m) => ({ ...m, [selected.id]: target }));
      setDone(true);
      setTimeout(() => setDone(false), 1600);
      router.refresh();
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy("");
    }
  }

  if (variants.length === 0) {
    return <p className="buy__nostock">Sem variações cadastradas para este item.</p>;
  }

  const out = selected ? selected.available <= 0 : true;

  return (
    <div className="buy">
      {chips.length > 1 && (
        <div className="buy__group">
          {header && <span className="buy__label">{header}</span>}
          <div className="buy__chips" role="radiogroup" aria-label={header ?? "Opção"}>
            {chips.map((c) => {
              const on = c.id === variantId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`buy__chip ${on ? "is-on" : ""} ${c.available <= 0 ? "is-out" : ""}`}
                  onClick={() => {
                    setVariantId(c.id);
                    setQty(1);
                    setError("");
                  }}
                >
                  <span className="buy__chip-name">{c.label}</span>
                  <span className="buy__chip-price">{formatBRL(effectiveVariantPrice(c))}</span>
                  {c.available <= 0 && <span className="buy__chip-out">esgotado</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {chips.length > 1 && selected && (
        <p className="buy__sel">
          {selected.name} · <strong>{formatBRL(unit)}</strong>
          {settings.pix_discount_percent > 0 && unitPix > 0 && (
            <span className="buy__sel-pix"> {formatBRL(unitPix)} no PIX</span>
          )}
        </p>
      )}

      <div className="buy__row">
        <span className="buy__label">Quantidade</span>
        {unidadeUnica ? (
          <span className="buy__single">Unidade única</span>
        ) : (
          <div className="buy__qty" aria-label="Quantidade">
            <button
              type="button"
              onClick={() => setQty((q) => clampQty(q - 1))}
              disabled={qty <= 1 || Boolean(busy)}
              aria-label="Diminuir quantidade"
            >
              <Minus size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
            <input
              type="number"
              min={1}
              max={Math.max(1, Math.min(999, maxAdd || 1))}
              value={qty}
              aria-label="Quantidade"
              onChange={(e) => setQty(clampQty(Number(e.target.value)))}
            />
            <button
              type="button"
              onClick={() => setQty((q) => clampQty(q + 1))}
              disabled={qty >= Math.max(1, Math.min(999, maxAdd || 1)) || Boolean(busy)}
              aria-label="Aumentar quantidade"
            >
              <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        )}
        <span className={`buy__stock ${out ? "is-out" : ""}`}>
          {out
            ? "Esgotado"
            : inCart > 0 && maxAdd <= 0
              ? `No carrinho: ${inCart}`
              : selected && selected.available <= 5
                ? `Últimas ${selected.available} un.`
                : selected
                  ? `${selected.available} disp.`
                  : ""}
        </span>
      </div>

      <div className="buy__actions">
        <button
          type="button"
          className="buy__btn buy__btn--primary"
          onClick={() => void submit(false)}
          disabled={Boolean(busy) || maxAdd <= 0}
        >
          <ShoppingCart size={15} strokeWidth={2} aria-hidden="true" />
          {busy === "add" ? "Adicionando…" : done ? "Adicionado" : "Adicionar ao carrinho"}
        </button>
        <button
          type="button"
          className="buy__btn buy__btn--now"
          onClick={() => void submit(true)}
          disabled={Boolean(busy) || !canBuyNow}
        >
          <Zap size={15} strokeWidth={2} aria-hidden="true" />
          {busy === "buy" ? "Levando ao carrinho…" : "Comprar agora"}
        </button>
      </div>

      {error && (
        <p className="buy__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
