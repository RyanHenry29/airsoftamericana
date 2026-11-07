import { config } from "../config.js";

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
}

/**
 * Frete simplificado por faixa de CEP + peso (Correios como referência).
 * Produção: trocar por integração Melhor Envio/Correios sem mudar a interface.
 */
export function calculateShipping(input: ShippingInput): ShippingOption[] {
  const { zip, subtotalCents, totalWeightGrams } = input;
  const firstDigit = zip[0] ?? "0";

  const zone: Record<string, number> = {
    "0": 0, "1": 0, "2": 1, "3": 1, "4": 2, "5": 2, "6": 3, "7": 3, "8": 4, "9": 4,
  };
  const zoneIndex = zone[firstDigit] ?? 2;

  const weightKg = Math.max(1, Math.ceil(totalWeightGrams / 1000));
  const base = 1490 + zoneIndex * 400 + (weightKg - 1) * 600;

  const freeThreshold = config.FRETE_GRATIS_APARTIR_DE;
  const isFree = freeThreshold > 0 && subtotalCents >= freeThreshold;

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
