// language: TS, file: apps/store/src/app/lib/filters.ts, target: Next.js App Router
// Presets de faixa de preço usados nos filtros de /catalogo e /busca.
// Fonte única: os limites em centavos aparecem nos dois lados do mesmo jeito.

export type PriceBand = {
  label: string;
  min: string;
  max: string;
};

export const PRICE_BANDS: PriceBand[] = [
  { label: "Até R$ 150", min: "", max: "15000" },
  { label: "R$ 150 a R$ 400", min: "15000", max: "40000" },
  { label: "R$ 400 a R$ 900", min: "40000", max: "90000" },
  { label: "Acima de R$ 900", min: "90000", max: "" },
];
