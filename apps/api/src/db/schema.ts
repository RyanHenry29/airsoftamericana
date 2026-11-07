import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  varchar,
  index,
  uniqueIndex,
  jsonb,
  uuid,
  bigint,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orderStatusEnum = pgEnum("order_status", [
  "aguardando_pagamento",
  "pagamento_em_processamento",
  "em_analise_antifraude",
  "aguardando_revisao_manual",
  "pagamento_aprovado",
  "separacao",
  "preparando_envio",
  "enviado",
  "entregue",
  "cancelado",
  "reembolsado",
  "em_disputa",
  "chargeback_recebido",
]);

export const paymentMethodEnum = pgEnum("payment_method", ["pix", "cartao", "boleto"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pendente",
  "autorizado",
  "aprovado",
  "recusado",
  "expirado",
  "estornado",
  "chargeback",
]);
export const chargebackStatusEnum = pgEnum("chargeback_status", [
  "notificado",
  "aguardando_analise",
  "documentacao_pendente",
  "defesa_preparada",
  "defesa_enviada",
  "em_analise",
  "ganho",
  "perdido",
  "encerrado",
]);
export const riskLevelEnum = pgEnum("risk_level", ["baixo", "medio", "alto"]);
export const movementTypeEnum = pgEnum("movement_type", [
  "entrada",
  "saida",
  "ajuste",
  "reserva",
  "liberacao",
  "transferencia",
]);
// Legado: mantido para compatibilidade de import; papéis reais em lib/rbac.ts (7 papéis).
export const userRoleEnum = { enumValues: ["admin","manager","operator","viewer","superadmin","gerente","estoque","atendimento","marketing","financeiro","somente-leitura"] as const };

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    role: varchar("role", { length: 32 }).notNull().default("atendimento"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    totpSecret: text("totp_secret"),
    totpLastUsedStep: integer("totp_last_used_step"),
    needsRoleReview: boolean("needs_role_review").notNull().default(false),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 hex do cookie opaco (256 bits). Nunca armazenar o token cru. */
    tokenHash: text("token_hash"),
    /** Legado (refresh token) — mantido para compatibilidade de leitura. */
    refreshTokenHash: text("refresh_token_hash"),
    userAgent: text("user_agent"),
    ip: varchar("ip", { length: 45 }),
    /** Validade absoluta (8h). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Validade ociosa (30 min, rolante). */
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    mfaChallenge: text("mfa_challenge"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_token_hash_idx").on(t.tokenHash)],
);

export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("mfa_recovery_codes_user_idx").on(t.userId)],
);

export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports"),
    label: varchar("label", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    index("webauthn_credentials_user_idx").on(t.userId),
    uniqueIndex("webauthn_credentials_cred_idx").on(t.credentialId),
  ],
);

export const adminInvites = pgTable(
  "admin_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    role: varchar("role", { length: 32 }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("admin_invites_token_hash_idx").on(t.tokenHash),
    index("admin_invites_email_idx").on(t.email),
  ],
);

export const authLockouts = pgTable(
  "auth_lockouts",
  {
    key: varchar("key", { length: 320 }).primaryKey(), // "acct:<email>" | "ip:<ip>"
    failCount: integer("fail_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: text("password_hash"),
    cpf: varchar("cpf", { length: 11 }),
    phone: varchar("phone", { length: 20 }),
    bornAt: timestamp("born_at", { withTimezone: true }),
    ageVerifiedAt: timestamp("age_verified_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("customers_email_idx").on(t.email), index("customers_cpf_idx").on(t.cpf)],
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    recipient: varchar("recipient", { length: 120 }).notNull(),
    zip: varchar("zip", { length: 8 }).notNull(),
    street: varchar("street", { length: 160 }).notNull(),
    number: varchar("number", { length: 20 }).notNull(),
    complement: varchar("complement", { length: 120 }),
    neighborhood: varchar("neighborhood", { length: 80 }).notNull(),
    city: varchar("city", { length: 80 }).notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    country: varchar("country", { length: 2 }).notNull().default("BR"),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [index("customer_addresses_customer_idx").on(t.customerId)],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    logoUrl: text("logo_url"),
    description: text("description").default(""),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("brands_slug_idx").on(t.slug)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id"),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    description: text("description").default(""),
    imageUrl: text("image_url"),
    ageRestricted: boolean("age_restricted").notNull().default(false),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("categories_slug_idx").on(t.slug),
    index("categories_parent_idx").on(t.parentId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    shortDescription: text("short_description").default(""),
    description: text("description").default(""),
    categoryId: uuid("category_id").notNull().references(() => categories.id),
    brandId: uuid("brand_id").references(() => brands.id),
    ageRestricted: boolean("age_restricted").notNull().default(false),
    featured: boolean("featured").notNull().default(false),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    condicao: varchar("condicao", { length: 20 }).notNull().default("novo"),
    estado_conservacao: varchar("estado_conservacao", { length: 100 }).default(""),
    itens_inclusos: text("itens_inclusos").default(""),
    garantia_dias: integer("garantia_dias").notNull().default(30),
    unidade_unica: boolean("unidade_unica").notNull().default(false),
  },
  (t) => [
    uniqueIndex("products_slug_idx").on(t.slug),
    index("products_category_idx").on(t.categoryId),
    index("products_published_idx").on(t.published),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    sku: varchar("sku", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    priceCents: integer("price_cents").notNull(),
    promoPriceCents: integer("promo_price_cents"),
    weightGrams: integer("weight_grams").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("product_variants_sku_idx").on(t.sku), index("product_variants_product_idx").on(t.productId)],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: varchar("alt", { length: 200 }),
    kind: varchar("kind", { length: 20 }).notNull().default("image"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    physical: integer("physical").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    minQuantity: integer("min_quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("inventory_variant_idx").on(t.variantId)],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    type: movementTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull(),
    physicalBefore: integer("physical_before").notNull(),
    physicalAfter: integer("physical_after").notNull(),
    reservedBefore: integer("reserved_before").notNull(),
    reservedAfter: integer("reserved_after").notNull(),
    reason: text("reason").notNull(),
    orderId: uuid("order_id"),
    userId: uuid("user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("inventory_movements_variant_idx").on(t.variantId), index("inventory_movements_order_idx").on(t.orderId)],
);

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    sessionKey: varchar("session_key", { length: 64 }),
    couponCode: varchar("coupon_code", { length: 40 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("carts_customer_idx").on(t.customerId), index("carts_session_idx").on(t.sessionKey)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  (t) => [uniqueIndex("cart_items_cart_variant_idx").on(t.cartId, t.variantId)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    number: varchar("number", { length: 20 }).notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    status: orderStatusEnum("status").notNull().default("aguardando_pagamento"),
    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    shippingCents: integer("shipping_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    couponCode: varchar("coupon_code", { length: 40 }),
    paymentMethod: paymentMethodEnum("payment_method"),
    addressJson: jsonb("address_json").notNull(),
    customerNotes: text("customer_notes"),
    termsVersion: varchar("terms_version", { length: 20 }),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    termsIp: varchar("terms_ip", { length: 45 }),
    volumeDay: varchar("volume_day", { length: 10 }),
    riskLevel: riskLevelEnum("risk_level"),
    riskScore: integer("risk_score").default(0),
    riskReasons: jsonb("risk_reasons"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("orders_number_idx").on(t.number),
    index("orders_customer_idx").on(t.customerId),
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
    index("orders_volume_day_idx").on(t.volumeDay),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    sku: varchar("sku", { length: 64 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatusEnum("from_status"),
    toStatus: orderStatusEnum("to_status").notNull(),
    reason: text("reason"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorSystem: boolean("actor_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("order_status_history_order_idx").on(t.orderId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    provider: varchar("provider", { length: 32 }).notNull(),
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").notNull().default("pendente"),
    amountCents: integer("amount_cents").notNull(),
    authorizedCents: integer("authorized_cents"),
    providerTransactionId: varchar("provider_transaction_id", { length: 120 }),
    payload: text("payload"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("payments_order_idx").on(t.orderId),
    uniqueIndex("payments_provider_tx_idx").on(t.provider, t.providerTransactionId),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id").references(() => payments.id),
    provider: varchar("provider", { length: 32 }).notNull(),
    eventId: varchar("event_id", { length: 160 }).notNull(),
    type: varchar("type", { length: 80 }).notNull(),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("payment_events_event_idx").on(t.provider, t.eventId), index("payment_events_payment_idx").on(t.paymentId)],
);

export const refunds = pgTable("refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  providerRefundId: varchar("provider_refund_id", { length: 120 }),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const fraudRules = pgTable(
  "fraud_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 60 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    weight: integer("weight").notNull().default(10),
    threshold: integer("threshold"),
    action: varchar("action", { length: 20 }).notNull().default("soma"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("fraud_rules_key_idx").on(t.key)],
);

export const fraudAssessments = pgTable(
  "fraud_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    score: integer("score").notNull(),
    level: riskLevelEnum("level").notNull(),
    action: varchar("action", { length: 20 }).notNull(),
    reasons: jsonb("reasons").notNull(),
    ip: varchar("ip", { length: 45 }),
    deviceFingerprint: text("device_fingerprint"),
    autoDecision: boolean("auto_decision").notNull().default(true),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("fraud_assessments_order_idx").on(t.orderId)],
);

export const fraudReviewEvents = pgTable(
  "fraud_review_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id").references(() => fraudAssessments.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 40 }).notNull(),
    note: text("note"),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("fraud_review_events_assessment_idx").on(t.assessmentId)],
);

export const watchlist = pgTable(
  "watchlist",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: varchar("kind", { length: 20 }).notNull(),
    value: varchar("value", { length: 254 }).notNull(),
    reason: text("reason").notNull(),
    addedByUserId: uuid("added_by_user_id").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("watchlist_kind_value_idx").on(t.kind, t.value)],
);

export const chargebacks = pgTable(
  "chargebacks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerDisputeId: varchar("provider_dispute_id", { length: 120 }).notNull(),
    status: chargebackStatusEnum("status").notNull().default("notificado"),
    amountCents: integer("amount_cents").notNull(),
    reason: varchar("reason", { length: 120 }),
    reasonCode: varchar("reason_code", { length: 30 }),
    respondBy: timestamp("respond_by", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("chargebacks_dispute_idx").on(t.provider, t.providerDisputeId),
    index("chargebacks_order_idx").on(t.orderId),
    index("chargebacks_respond_by_idx").on(t.respondBy),
  ],
);

export const chargebackEvidence = pgTable(
  "chargeback_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chargebackId: uuid("chargeback_id").notNull().references(() => chargebacks.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    content: jsonb("content"),
    fileUrl: text("file_url"),
    addedByUserId: uuid("added_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("chargeback_evidence_cb_idx").on(t.chargebackId)],
);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    carrier: varchar("carrier", { length: 40 }).notNull(),
    trackingCode: varchar("tracking_code", { length: 60 }),
    shippingCents: integer("shipping_cents").notNull().default(0),
    estimatedDays: integer("estimated_days"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("shipments_order_idx").on(t.orderId)],
);

export const shippingEvents = pgTable(
  "shipping_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 40 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("shipping_events_shipment_idx").on(t.shipmentId)],
);

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 40 }).notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    value: integer("value").notNull(),
    minOrderCents: integer("min_order_cents").notNull().default(0),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("coupons_code_idx").on(t.code)],
);

export const promotions = pgTable("promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull(),
  content: jsonb("content").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
});

export const orderVolumeLimits = pgTable("order_volume_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  maxOrdersPerDay: integer("max_orders_per_day").notNull().default(0),
  maxRevenuePerDayCents: bigint("max_revenue_per_day_cents", { mode: "number" }).notNull().default(0),
  maxOrdersPerCustomerPerDay: integer("max_orders_per_customer_per_day").notNull().default(0),
  maxOrderValueCents: integer("max_order_value_cents").notNull().default(0),
  actionWhenExceeded: varchar("action_when_exceeded", { length: 20 }).notNull().default("bloquear_checkout"),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const gatewayConfigs = pgTable(
  "gateway_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull(),
    credentialsEncrypted: text("credentials_encrypted"),
    enabled: boolean("enabled").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    methods: jsonb("methods").notNull().default(["pix", "cartao", "boleto"]),
    captureAfterReview: boolean("capture_after_review").notNull().default(false),
    require3ds: boolean("require3ds").notNull().default(false),
    pixDiscountPercent: integer("pix_discount_percent").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  },
  (t) => [uniqueIndex("gateway_configs_provider_idx").on(t.provider)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorLabel: varchar("actor_label", { length: 120 }),
    action: varchar("action", { length: 80 }).notNull(),
    entity: varchar("entity", { length: 60 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    ip: varchar("ip", { length: 45 }),
    correlationId: varchar("correlation_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("audit_logs_actor_idx").on(t.actorUserId), index("audit_logs_entity_idx").on(t.entity, t.entityId), index("audit_logs_created_idx").on(t.createdAt)],
);

export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 60 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: varchar("kind", { length: 40 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    body: text("body"),
    severity: varchar("severity", { length: 10 }).notNull().default("info"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("notifications_created_idx").on(t.createdAt)],
);

export const dailyMetrics = pgTable("daily_metrics", {
  day: varchar("day", { length: 10 }).primaryKey(),
  ordersCreated: integer("orders_created").notNull().default(0),
  ordersApproved: integer("orders_approved").notNull().default(0),
  ordersCancelled: integer("orders_cancelled").notNull().default(0),
  grossCents: bigint("gross_cents", { mode: "number" }).notNull().default(0),
  refundedCents: bigint("refunded_cents", { mode: "number" }).notNull().default(0),
  chargebacksReceived: integer("chargebacks_received").notNull().default(0),
  chargebackAmountCents: bigint("chargeback_amount_cents", { mode: "number" }).notNull().default(0),
  ticketsCents: bigint("tickets_cents", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    source: varchar("source", { length: 40 }).notNull().default("homepage"),
    consent: boolean("consent").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("newsletter_subscribers_email_idx").on(t.email)],
);


export const banners = pgTable(
  "banners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 160 }).notNull(),
    subtitle: varchar("subtitle", { length: 240 }).default(""),
    eyebrow: varchar("eyebrow", { length: 80 }).default(""),
    ctaLabel: varchar("cta_label", { length: 60 }).default(""),
    imageDesktop: text("image_desktop"),
    imageMobile: text("image_mobile"),
    link: text("link"),
    kind: varchar("kind", { length: 20 }).notNull().default("hero"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("banners_active_idx").on(t.active),
    index("banners_position_idx").on(t.position),
  ],
);

export const homepageSections = pgTable(
  "homepage_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: varchar("kind", { length: 40 }).notNull(),
    title: varchar("title", { length: 120 }).default(""),
    subtitle: varchar("subtitle", { length: 240 }).default(""),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("homepage_sections_position_idx").on(t.position)],
);

export const productSpecs = pgTable(
  "product_specs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 60 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    value: varchar("value", { length: 240 }).notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("product_specs_product_idx").on(t.productId),
    index("product_specs_key_idx").on(t.key),
  ],
);

export const relatedProducts = pgTable(
  "related_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    relatedProductId: uuid("related_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("related_products_pair_idx").on(t.productId, t.relatedProductId)],
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    subject: varchar("subject", { length: 160 }).notNull(),
    message: text("message").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("aberto"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("support_tickets_status_idx").on(t.status),
    index("support_tickets_created_idx").on(t.createdAt),
  ],
);

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 220 }).notNull(),
    excerpt: text("excerpt").default(""),
    content: text("content").notNull(),
    coverImage: text("cover_image"),
    author: varchar("author", { length: 120 }).default("Equipe Airsoft Americana"),
    category: varchar("category", { length: 60 }).default("Guias"),
    tags: text("tags").default(""),
    readingMinutes: integer("reading_minutes").notNull().default(4),
    seoTitle: varchar("seo_title", { length: 200 }),
    seoDescription: varchar("seo_description", { length: 320 }),
    published: boolean("published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("blog_posts_slug_idx").on(t.slug),
    index("blog_posts_published_idx").on(t.published),
    index("blog_posts_published_at_idx").on(t.publishedAt),
  ],
);

export const categoriesParentFk = foreignKey({ columns: [categories.parentId], foreignColumns: [categories.id] });

export type OrderStatusType = (typeof orderStatusEnum)["enumValues"][number];
export type PaymentMethodType = (typeof paymentMethodEnum)["enumValues"][number];
export type PaymentStatusType = (typeof paymentStatusEnum)["enumValues"][number];
export type ChargebackStatusType = (typeof chargebackStatusEnum)["enumValues"][number];
export type RiskLevelType = (typeof riskLevelEnum)["enumValues"][number];
export type MovementTypeType = (typeof movementTypeEnum)["enumValues"][number];
export type UserRoleType = (typeof userRoleEnum)["enumValues"][number];