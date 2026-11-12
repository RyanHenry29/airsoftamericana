// language: TSX, file: apps/store/src/app/components/ProductCard.tsx, target: Next.js App Router
// Card de produto no padrão da referência: foto real, preço, condição PIX e parcelamento.
// ESPIAR abre o QuickView com os dados já no card; COMPRAR vai direto para a
// seção de compra da PDP (/{slug}#comprar — seletor de opção, quantidade, add).
"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Eye, ShoppingCart } from "lucide-react";
import type { CommercialSettings, StoreProduct } from "../lib/store";
import { formatBRL, installmentsFor, pixPrice } from "../lib/store";
import { QuickView } from "./QuickView";

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
  const [peek, setPeek] = useState(false);

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

        <div className="pcard-actions">
          <button
            type="button"
            className="pcard-btn pcard-btn--eye"
            onClick={() => setPeek(true)}
            aria-label={`Espiar ${product.name}`}
          >
            <Eye size={14} strokeWidth={2} aria-hidden="true" />
            ESPIAR
          </button>
          <Link
            href={`/${product.slug}#comprar`}
            className="pcard-btn pcard-btn--buy"
            aria-label={`Comprar ${product.name}`}
          >
            <ShoppingCart size={14} strokeWidth={2} aria-hidden="true" />
            COMPRAR
          </Link>
        </div>
      </div>

      {peek && <QuickView product={product} settings={settings} onClose={() => setPeek(false)} />}
    </li>
  );
}
