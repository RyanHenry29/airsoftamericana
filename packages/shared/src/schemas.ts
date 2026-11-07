import { z } from "zod";
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  CHARGEBACK_STATUSES,
  RISK_LEVELS,
} from "./domain.js";

// ------------------------------------------------------------- Auth
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("E-mail inválido — confere o formato")
  .max(254, "E-mail longo demais");
export const passwordSchema = z
  .string()
  .min(8, "Mínimo de 8 caracteres")
  .max(128, "Máximo de 128 caracteres");

/** No login basta a senha existir — a política de senha vale na criação. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Digite a senha"),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Coloque seu nome completo").max(120, "Nome longo demais"),
  email: emailSchema,
  password: passwordSchema,
  cpf: z
    .string()
    .regex(/^\d{11}$/, "CPF deve conter 11 dígitos")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().max(20, "Telefone longo demais").optional(),
});

// ------------------------------------------------------------- Endereço
export const addressSchema = z.object({
  recipient: z.string().trim().min(2).max(120),
  zip: z.string().regex(/^\d{8}$/, "CEP deve conter 8 dígitos"),
  street: z.string().trim().min(3).max(160),
  number: z.string().trim().min(1).max(20),
  complement: z.string().trim().max(120).optional().or(z.literal("")),
  neighborhood: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().length(2, "Use a sigla UF"),
  country: z.string().trim().length(2).default("BR"),
});

// ------------------------------------------------------------- Carrinho / Checkout
export const cartItemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
});

export const couponSchema = z.object({
  code: z.string().trim().min(3).max(40).toUpperCase(),
});

/**
 * O checkout envia apenas *intenções*. Preço, desconto, frete e total
 * são SEMPRE recalculados no servidor.
 */
export const checkoutSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  address: addressSchema,
  paymentMethod: z.enum(PAYMENT_METHODS),
  /** Serviço de frete escolhido pelo cliente (PAC, SEDEX, local). Recalculado no servidor. */
  shippingService: z.string().trim().max(20).optional(),
  couponCode: z.string().trim().max(40).optional(),
  customerNotes: z.string().trim().max(500).optional(),
  /** Aceite dos termos — versionado, com timestamp e IP gravados no pedido. */
  acceptedTerms: z.literal(true, {
    message: "É preciso aceitar os termos de compra",
  }),
});

// ------------------------------------------------------------- Estoque (admin)
export const stockMovementSchema = z.object({
  variantId: z.string().min(1),
  type: z.enum(["entrada", "saida", "ajuste", "transferencia"]),
  quantity: z.number().int().min(1).max(100000),
  reason: z.string().trim().min(3).max(300),
});

// ------------------------------------------------------------- Volume de pedidos (admin)
export const orderVolumeLimitsSchema = z.object({
  maxOrdersPerDay: z.number().int().min(0).max(100000),
  maxRevenuePerDayCents: z.number().int().min(0),
  maxOrdersPerCustomerPerDay: z.number().int().min(0).max(1000),
  maxOrderValueCents: z.number().int().min(0),
  actionWhenExceeded: z.enum(["bloquear_checkout", "revisao_manual"]),
  enabled: z.boolean(),
});

// ------------------------------------------------------------- Status
export const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  reason: z.string().trim().max(300).optional(),
});

export const paymentStatusSchema = z.object({
  status: z.enum(PAYMENT_STATUSES),
});

export const chargebackStatusSchema = z.object({
  status: z.enum(CHARGEBACK_STATUSES),
  note: z.string().trim().max(1000).optional(),
});

export const riskLevelSchema = z.object({
  level: z.enum(RISK_LEVELS),
  reason: z.string().trim().min(3).max(500),
});

// ------------------------------------------------------------- Produtos (admin)
export const productVariantSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  priceCents: z.number().int().min(0),
  promoPriceCents: z.number().int().min(0).nullable().optional(),
  stockPhysical: z.number().int().min(0).default(0),
  stockMin: z.number().int().min(0).default(0),
  weightGrams: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, "Slug: apenas letras minúsculas, números e hífen")
    .min(2)
    .max(160),
  description: z.string().trim().max(20000).default(""),
  categoryId: z.string().min(1),
  brandId: z.string().min(1).optional(),
  /** Restrição 18+ por categoria/produto (conformidade legal). */
  ageRestricted: z.boolean().default(false),
  featured: z.boolean().default(false),
  published: z.boolean().default(false),
  variants: z.array(productVariantSchema).min(1),
});

// ------------------------------------------------------------- Pagamentos — gateway (admin)
export const gatewayConfigSchema = z.object({
  provider: z.enum(["sandbox", "mercadopago", "pagbank", "cielo"]),
  /** Credenciais cifradas no servidor; aqui chegam em texto puro e nunca voltam. */
  credentials: z.record(z.string(), z.string()),
  enabled: z.boolean().default(true),
  methods: z.array(z.enum(PAYMENT_METHODS)).min(1),
  /** Captura posterior: pagar só depois da análise antifraude. */
  captureAfterReview: z.boolean().default(false),
  require3ds: z.boolean().default(false),
});

/** Admin cria cliente manualmente (senha opcional — vira conta sem login). */
export const adminCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema.optional(),
  cpf: z
    .string()
    .regex(/^\d{11}$/, "CPF deve conter 11 dígitos")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type AdminCustomerInput = z.infer<typeof adminCustomerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type GatewayConfigInput = z.infer<typeof gatewayConfigSchema>;
export type OrderVolumeLimitsInput = z.infer<typeof orderVolumeLimitsSchema>;
