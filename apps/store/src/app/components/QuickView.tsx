// language: TSX, file: apps/store/src/app/components/QuickView.tsx, target: Next.js App Router
// ESPIAR: modal com foto, preço, estoque e opções do produto — renderizado só
// com os dados já presentes no card (nenhum fetch). Comprar leva a /{slug}#comprar.
"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShoppingCart, X } from "lucide-react";
import type { CommercialSettings, StoreProduct } from "../lib/store";
import { formatBRL, installmentsFor, pixPrice } from "../lib/store";
import { effectiveVariantPrice, variantChips } from "../lib/buy";

type Props = {
  product: StoreProduct;
  settings: CommercialSettings;
  onClose: () => void;
};

export function QuickView({ product, settings, onClose }: Props) {
  // Esc fecha; trava o scroll do fundo enquanto o modal está aberto.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const image = product.images?.[0]?.url ?? null;
  const price = product.priceCents;
  const listPrice = product.listPriceCents;
  const hasDiscount = listPrice > price && price > 0;
  const pix = pixPrice(price, settings);
  const inst = installmentsFor(price, settings);
  const out = product.available <= 0;
  const { chips } = variantChips(product.variants ?? []);

  const description = (product.description || product.shortDescription || "").trim();
  const lead = description.length > 220 ? `${description.slice(0, 220).trimEnd()}…` : description;

  return (
    <div
      className="qv"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="qv__panel" role="dialog" aria-modal="true" aria-label={`Espiar ${product.name}`}>
        <header className="qv__head">
          <span className="qv__kicker">ESPIAR</span>
          <button type="button" className="qv__close" onClick={onClose} aria-label="Fechar">
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        <div className="qv__body">
          <div className="qv__media">
            {image ? (
              <Image
                src={image}
                alt={product.images?.[0]?.alt ?? product.name}
                fill
                sizes="(max-width: 640px) 90vw, 260px"
                className="qv__img"
              />
            ) : (
              <span className="pcard-img__fallback">{product.name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>

          <div className="qv__info">
            {product.brandName && <span className="qv__brand">{product.brandName}</span>}
            <h2 className="qv__title">{product.name}</h2>
            {product.shortDescription && <p className="qv__lead">{product.shortDescription}</p>}

            <div className="qv__prices">
              {hasDiscount && (
                <span className="pdp__was">
                  {formatBRL(listPrice)}
                  <em>−{Math.round(((listPrice - price) / listPrice) * 100)}%</em>
                </span>
              )}
              <span className="qv__price">{formatBRL(price)}</span>
              {settings.pix_discount_percent > 0 && pix > 0 && (
                <span className="pcard-pix">{formatBRL(pix)} no PIX</span>
              )}
              {price > 0 && (
                <span className="pcard-inst">
                  {inst.count}x de {formatBRL(inst.valueCents)}
                  {inst.interestFree ? " sem juros" : ""}
                </span>
              )}
            </div>

            <span className={`qv__stock ${out ? "is-out" : ""}`}>
              {out
                ? "Sem estoque"
                : product.available <= 5
                  ? `Últimas ${product.available} un.`
                  : `${product.available} unidades em estoque`}
            </span>

            {chips.length > 1 && (
              <ul className="qv__opts" aria-label="Opções disponíveis">
                {chips.map((c) => (
                  <li key={c.id} className={`qv__opt ${c.available <= 0 ? "is-out" : ""}`}>
                    <span>{c.label}</span>
                    <span>
                      {formatBRL(effectiveVariantPrice(c))}
                      {c.available <= 0 ? " · esgotado" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {lead && <p className="qv__desc">{lead}</p>}

            <div className="qv__actions">
              <Link href={`/${product.slug}#comprar`} className="btn-primary" onClick={onClose}>
                <ShoppingCart size={15} strokeWidth={2} aria-hidden="true" />
                Comprar
              </Link>
              <Link href={`/${product.slug}`} className="btn-ghost" onClick={onClose}>
                Ver detalhes
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
