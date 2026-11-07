// language: TS, file: apps/api/src/services/shipping.ts, target: Fastify 5
/**
 * Cálculo de frete.
 *
 * A regra de frete grátis tem UMA fonte: settings.free_shipping_from_cents no
 * banco. Quem chama (checkout, /api/shipping/quote) lê o settings e passa o
 * limite — esta função não lê ambiente nem table nada.
 */

export interface ShippingOption {
  carrier: string;
  service: string;
  days: number;
  priceCents: number;
  free: boolean;
}

export interface ShippingInput {
  zip: string;
  subtotalCents: number;
  totalWeightGrams: number;
  freeShippingFromCents: number;
}

/**
 * Frete simplificado por faixa de CEP + peso (Correios como referência).
 * Produção: trocar por integração Melhor Envio/Correios sem mudar a interface.
 * A regra de frete grátis tem UMA fonte: settings.free_shipping_from_cents no
 * banco — quem chama lê o settings e passa o limite (nunca env, nunca aqui).
 */
export function calculateShipping(input: ShippingInput): ShippingOption[] {
  const { zip, freeShippingFromCents } = input;
  const firstDigit = zip[0] ?? "0";

  const zone: Record<string, number> = {
    "0": 0, "1": 0, "2": 1, "3": 1, "4": 2, "5": 2, "6": 3, "7": 3, "8": 4, "9": 4,
  };
  const zoneIndex = zone[firstDigit] ?? 2;

  const weightKg = Math.max(1, Math.ceil(input.totalWeightGrams / 1000));
  const base = 1490 + zoneIndex * 400 + (weightKg - 1) * 600;

  const isFree = freeShippingFromCents > 0 && input.subtotalCents >= freeShippingFromCents;

  const pacPrice = isFree ? 0 : base;
  const sedexPrice = isFree ? 0 : base + 1800;

  return [
    { carrier: "Correios", service: "PAC", days: 5 + zoneIndex * 2, priceCents: pacPrice, free: isFree },
    { carrier: "Correios", service: "SEDEX", days: 2 + zoneIndex, priceCents: sedexPrice, free: isFree },
    { carrier: "Motoboy/Local", service: "Entrega local", days: 1, priceCents: 0, free: true },
  ];
}

export function getCheapestOption(options: ShippingOption[]): ShippingOption {
  const paid = options.filter((o) => !o.free);
  if (paid.length === 0) return options[0]!;
  return paid.reduce((a, b) => (a.priceCents <= b.priceCents ? a : b));
}
