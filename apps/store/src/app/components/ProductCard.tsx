// language: TSX, file: apps/store/src/app/components/ProductCard.tsx, target: Next.js App Router
// Card de produto no padrão da referência: foto real, preço, condição PIX e parcelamento.
// Inclui botão direto "Adicionar ao carrinho" para converter da grade.
"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import type { CommercialSettings, StoreProduct } from "../lib/store";
import { formatBRL, installmentsFor, pixPrice } from "../lib/store";

type Props = {
  product: StoreProduct;
  settings: CommercialSettings;
  compact?: boolean;
};

export function ProductCard({ product, settings, compact = false }: Props) {
  const image = product.images?.[0]?.url ?? null;
  const price = product.priceCents;
  const listPrice = product.listPriceCents;
  const hasDiscount = listPrice > price && price > 0;
  const offPercent = hasDiscount ? Math.round(((listPrice - price) / listPrice) * 100) : 0;
  const pix = pixPrice(price, settings);
  const inst = installmentsFor(price, settings);
  const out = product.available <= 0;
  const firstVariant = product.variants?.[0];
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function addToCart() {
    if (!firstVariant || busy || out) return;
    setBusy(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/cart/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ variantId: firstVariant.id, quantity: 1 }),
      });
      if (res.ok) {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }
    } catch {
      /* offline */
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="pcard-item">
      <Link href={`/${product.slug}`} className="pcard-img" aria-label={product.name}>
        {image ? (
          <Image
            src={image}
            alt={product.images?.[0]?.alt ?? product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="pcard-img__el"
          />
        ) : (
          <span className="pcard-img__fallback">{product.name.slice(0, 2).toUpperCase()}</span>
        )}

        <span className="pcard-tags">
          {out && <span className="pcard-tag pcard-tag--out">Esgotado</span>}
          {!out && hasDiscount && <span className="pcard-tag pcard-tag--off">-{offPercent}%</span>}
          {product.condicao === "usado" && <span className="pcard-tag pcard-tag--used">Usado</span>}
          {product.condicao === "seminovo" && <span className="pcard-tag pcard-tag--semi">Seminovo</span>}
          {product.ageRestricted && <span className="pcard-tag pcard-tag--age">18+</span>}
        </span>

        {product.brandName && <span className="pcard-brand">{product.brandName}</span>}
      </Link>

      <div className="pcard-info">
        {!compact && product.categoryName && (
          <span className="pcard-cat">{product.categoryName}</span>
        )}
        <h3 className="pcard-title">
          <Link href={`/${product.slug}`}>{product.name}</Link>
        </h3>

        {hasDiscount && <span className="pcard-was">{formatBRL(listPrice)}</span>}

        <div className="pcard-prices">
          <span className="pcard-price">{formatBRL(price)}</span>
          {settings.pix_discount_percent > 0 && pix > 0 && (
            <span className="pcard-pix">{formatBRL(pix)} no PIX</span>
          )}
        </div>

        {price > 0 && (
          <span className="pcard-inst">
            {inst.count}x de {formatBRL(inst.valueCents)}
            {inst.interestFree ? " sem juros" : ""}
          </span>
        )}

        {!out && (
          <span className="pcard-stock">
            {product.available <= 5 ? `Últimas ${product.available} un.` : "Em estoque"}
          </span>
        )}

        {!out && firstVariant ? (
          <button
            type="button"
            className="pcard-add"
            onClick={addToCart}
            disabled={busy}
            aria-label={`Adicionar ${product.name} ao carrinho`}
          >
            {busy ? (
              <ShoppingCart size={14} className="animate-spin" aria-hidden="true" />
            ) : done ? (
              <span className="text-[10px] font-black">OK</span>
            ) : (
              <>
                <ShoppingCart size={14} aria-hidden="true" />
                <span>Adicionar</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </li>
  );
}
