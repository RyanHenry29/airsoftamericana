// language: TS, file: apps/store/src/app/lib/buy.ts, target: Next.js App Router
// Lógica pura da compra: rótulo de opção derivado do nome real da variante e
// quantidade no carrinho. POST /api/cart/items grava quantidade ABSOLUTA —
// quem soma com o que já está lá é o cliente (mesma regra do OrderDetailModal).
import type { StoreVariant } from "./store";

export type BuyChip = {
  id: string;
  label: string;
  priceCents: number;
  promoPriceCents: number | null;
  available: number;
};

export type ChipList = { header: string | null; chips: BuyChip[] };

// Chaves que o admin escreve no início do nome da variante ("Tamanho: G").
const OPTION_KEYS = [
  "tamanho",
  "cor",
  "modelo",
  "estilo",
  "voltagem",
  "capacidade",
  "material",
  "conteudo",
  "conteúdo",
] as const;

type ParsedOption = { key: string; value: string };

/**
 * "Tamanho: G" / "Tamanho G" → { key: "tamanho", value: "G" }.
 * Exige separador depois da chave: "Corda" não vira { cor, "da" }.
 */
export function parseOption(name: string): ParsedOption | null {
  const raw = name.trim().replace(/\s+/g, " ");
  for (const key of OPTION_KEYS) {
    if (raw.length <= key.length + 1) continue;
    if (raw.slice(0, key.length).toLowerCase() !== key) continue;
    const rest = raw.slice(key.length);
    const value = rest.match(/^[\s:;\-–—/]+(.+)$/)?.[1]?.trim();
    if (value) return { key, value };
  }
  return null;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Chips de opção para o seletor da PDP. Quando TODAS as variantes ativas
 * começam pela mesma chave, o cabeçalho vira a chave ("Tamanho") e cada chip
 * mostra só o valor ("G"); caso contrário sem cabeçalho e chip com o nome cheio.
 * Variantes inativas ficam de fora.
 */
export function variantChips(variants: StoreVariant[]): ChipList {
  const active = variants.filter((v) => v.active);
  if (active.length === 0) return { header: null, chips: [] };

  const parsed = active.map((v) => parseOption(v.name));
  const first = parsed[0] ?? null;
  const firstKey = first?.key ?? null;
  const uniform = firstKey !== null && parsed.every((p) => p && p.key === firstKey);

  return {
    header: uniform && firstKey !== null ? capitalize(firstKey) : null,
    chips: active.map((v, i) => {
      const op = parsed[i] ?? null;
      return {
        id: v.id,
        label: uniform && op ? op.value : v.name,
        priceCents: v.priceCents,
        promoPriceCents: v.promoPriceCents,
        available: v.available,
      };
    }),
  };
}

/** Preço efetivo da variante: promoção quando existe, senão lista (espelho da API). */
export function effectiveVariantPrice(v: { priceCents: number; promoPriceCents: number | null }): number {
  return v.promoPriceCents ?? v.priceCents;
}

/**
 * Alvo do POST /api/cart/items: soma do que já está no carrinho com o que o
 * cliente escolheu, sempre limitado ao teto de 999 do servidor.
 */
export function nextCartQuantity(inCart: number, desiredAdd: number, cap = 999): number {
  const base = Number.isFinite(inCart) ? Math.max(0, Math.floor(inCart)) : 0;
  const add = Number.isFinite(desiredAdd) ? Math.max(1, Math.floor(desiredAdd)) : 1;
  return Math.min(cap, base + add);
}

/**
 * Quanto ainda dá para adicionar da variante selecionada:
 * estoque disponível menos o que já está no carrinho (0 = completou).
 * Unidade única trava em 1 — e em 0 quando já está no carrinho.
 */
export function maxAddQuantity(input: { available: number; inCart: number; unidadeUnica: boolean }): number {
  const already = Number.isFinite(input.inCart) ? Math.max(0, Math.floor(input.inCart)) : 0;
  if (input.unidadeUnica) return already > 0 ? 0 : 1;
  if (input.available <= 0) return 0;
  return Math.max(0, Math.min(999, input.available - already));
}
