// language: TS, file: apps/api/src/services/settings.ts, target: Fastify 5
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

/**
 * Fonte única de regras comerciais gravadas em `system_settings`.
 *
 * "Frete grátis acima de X" vive AQUI (key `commercial`, campo
 * `free_shipping_from_cents`) — nem shipping, nem checkout, nem topbar leem
 * valor de ambiente ou de constante. Config de ambiente é infra (porta,
 * segredo), regra comercial é dado do lojista.
 */
export type CommercialSettings = {
  pix_discount_percent: number;
  installments: number;
  installment_interest_free: boolean;
  min_installment_cents: number;
  free_shipping_from_cents: number;
  shipping_carriers: string[];
  whatsapp: string;
  email: string;
  address: { street: string; district: string; city: string; state: string; zip: string };
  service_hours: string;
  social: { instagram: string; whatsapp: string };
  announcement: string;
};

export const DEFAULT_COMMERCIAL: CommercialSettings = {
  pix_discount_percent: 0,
  installments: 1,
  installment_interest_free: false,
  min_installment_cents: 0,
  free_shipping_from_cents: 0,
  shipping_carriers: [],
  whatsapp: "",
  email: "",
  address: { street: "", district: "", city: "", state: "", zip: "" },
  service_hours: "",
  social: { instagram: "", whatsapp: "" },
  announcement: "",
};

/** Lê as condições comerciais do banco. Faltando, devolve o default neutro. */
export async function getCommercialSettings(db: Db): Promise<CommercialSettings> {
  const rows = await db.select().from(schema.systemSettings);
  const commercial = rows.find((r) => r.key === "commercial");
  if (!commercial) return DEFAULT_COMMERCIAL;
  const value = commercial.value;
  if (!value || typeof value !== "object") return DEFAULT_COMMERCIAL;
  const parsed = value as Partial<CommercialSettings>;
  return {
    ...DEFAULT_COMMERCIAL,
    ...parsed,
    address: { ...DEFAULT_COMMERCIAL.address, ...(parsed.address ?? {}) },
    social: { ...DEFAULT_COMMERCIAL.social, ...(parsed.social ?? {}) },
  };
}

/** Atalho usado pelo frete: uma linha, uma fonte. */
export async function getFreeShippingFromCents(db: Db): Promise<number> {
  const settings = await getCommercialSettings(db);
  const cents = Number(settings.free_shipping_from_cents);
  return Number.isFinite(cents) && cents > 0 ? Math.floor(cents) : 0;
}

/** Dados da empresa (key `empresa_dados`) — razão social e CNPJ do rodapé. */
export type CompanyData = {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  telefone: string;
  email: string;
};

/**
 * Lê os dados cadastrais da empresa. `null` quando a linha não existe ou não
 * tem CNPJ — o rodapé cai para a linha de copyright simples em vez de exibir
 * cadastro pela metade.
 */
export async function getCompanyData(db: Db): Promise<CompanyData | null> {
  const rows = await db.select().from(schema.systemSettings);
  const row = rows.find((r) => r.key === "empresa_dados");
  const value = row?.value;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string): string =>
    typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  const cnpj = text("cnpj");
  if (!cnpj) return null;
  return {
    nome_fantasia: text("nome_fantasia") || "Airsoft Americana",
    razao_social: text("razao_social"),
    cnpj,
    telefone: text("telefone_principal"),
    email: text("email_contato"),
  };
}
