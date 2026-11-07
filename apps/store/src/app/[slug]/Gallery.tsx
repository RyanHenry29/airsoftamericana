// language: TSX, file: apps/store/src/app/[slug]/Gallery.tsx, target: Next.js App Router
// Galeria do produto: imagem principal + miniaturas, com zoom no hover.
"use client";

import Image from "next/image";
import { useState } from "react";
import type { StoreImage } from "../lib/store";

export function Gallery({ images, name }: { images: StoreImage[]; name: string }) {
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const list = images.length > 0 ? images : [];
  const current = list[active] ?? list[0]!;

  if (list.length === 0) {
    return (
      <div className="gallery gallery--empty">
        <span>{name.slice(0, 2).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div className="gallery">
      <div
        className="gallery__stage"
        onMouseEnter={() => setZoom(true)}
        onMouseLeave={() => setZoom(false)}
      >
        <Image
          src={current.url}
          alt={current.alt ?? name}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className={`gallery__img ${zoom ? "is-zoom" : ""}`}
        />
      </div>

      {list.length > 1 && (
        <ul className="gallery__thumbs">
          {list.map((img, index) => (
            <li key={img.id}>
              <button
                type="button"
                className={`gallery__thumb ${index === active ? "is-active" : ""}`}
                onClick={() => setActive(index)}
                aria-label={`Ver imagem ${index + 1} de ${name}`}
              >
                <Image src={img.url} alt="" fill sizes="80px" className="gallery__thumb-img" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
