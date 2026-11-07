import { sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { syncSchemaColumns } from "./sync-columns.js";

/**
 * Migrações brutas, idempotentes — drizzle-kit não está configurado no pipeline.
 * Cada statement usa IF NOT EXISTS: reexecutar é seguro em dev, test e prod.
 *
 * Compatível com Postgres e PGlite (sem extensions além de gen_random_uuid,
 * que existe nativamente no PG13+ e no PGlite).
 */

async function createEnum(db: Db, name: string, values: string[]): Promise<void> {
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN
        CREATE TYPE "${name}" AS ENUM (${values.map((v) => `'${v}'`).join(", ")});
      END IF;
    END
    $$;
  `));
}

export async function migrate(db: Db) {
  // ---------------------------------------------------------------- Enums
  await createEnum(db, "order_status", [
    "aguardando_pagamento", "pagamento_em_processamento", "em_analise_antifraude",
    "aguardando_revisao_manual", "pagamento_aprovado", "separacao", "preparando_envio",
    "enviado", "entregue", "cancelado", "reembolsado", "em_disputa", "chargeback_recebido",
  ]);
  await createEnum(db, "payment_method", ["pix", "cartao", "boleto"]);
  await createEnum(db, "payment_status", [
    "pendente", "autorizado", "aprovado", "recusado", "expirado", "estornado", "chargeback",
  ]);
  await createEnum(db, "chargeback_status", [
    "notificado", "aguardando_analise", "documentacao_pendente", "defesa_preparada",
    "defesa_enviada", "em_analise", "ganho", "perdido", "encerrado",
  ]);
  await createEnum(db, "risk_level", ["baixo", "medio", "alto"]);
  await createEnum(db, "movement_type", [
    "entrada", "saida", "ajuste", "reserva", "liberacao", "transferencia",
  ]);
  await createEnum(db, "user_role", ["admin", "manager", "operator", "viewer"]);

  // ---------------------------------------------------------------- Core
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" varchar(254) NOT NULL,
      "password_hash" text NOT NULL,
      "name" varchar(120) NOT NULL,
      "role" user_role NOT NULL DEFAULT 'operator',
      "mfa_enabled" boolean NOT NULL DEFAULT false,
      "totp_secret" text,
      "active" boolean NOT NULL DEFAULT true,
      "last_login_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
  `);
  // Evolui role: enum legado → varchar(32) para os 7 papéis (B.6/B.8). Idempotente.
  await db.execute(sql.raw(`ALTER TABLE "users" ALTER COLUMN "role" TYPE varchar(32) USING "role"::text;`));
  await db.execute(sql.raw(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'atendimento';`));
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_last_used_step" integer;`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sessions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "token_hash" text,
      "refresh_token_hash" text,
      "user_agent" text,
      "ip" varchar(45),
      "expires_at" timestamptz NOT NULL,
      "idle_expires_at" timestamptz,
      "last_seen_at" timestamptz,
      "revoked_at" timestamptz,
      "mfa_verified_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "token_hash" text;`);
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "idle_expires_at" timestamptz;`);
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;`);
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz;`);
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mfa_verified_at" timestamptz;`);
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mfa_challenge" text;`);
  await db.execute(sql`ALTER TABLE "sessions" ALTER COLUMN "refresh_token_hash" DROP NOT NULL;`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_idx" ON "sessions" ("token_hash");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "mfa_recovery_codes" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "code_hash" text NOT NULL,
      "used_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "mfa_recovery_codes_user_idx" ON "mfa_recovery_codes" ("user_id");`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "credential_id" text NOT NULL,
      "public_key" text NOT NULL,
      "counter" bigint NOT NULL DEFAULT 0,
      "transports" text,
      "label" varchar(120),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "last_used_at" timestamptz
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "webauthn_credentials_user_idx" ON "webauthn_credentials" ("user_id");`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "webauthn_credentials_cred_idx" ON "webauthn_credentials" ("credential_id");`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "admin_invites" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" varchar(254) NOT NULL,
      "role" varchar(32) NOT NULL,
      "token_hash" text NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "used_at" timestamptz,
      "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "admin_invites_token_hash_idx" ON "admin_invites" ("token_hash");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "admin_invites_email_idx" ON "admin_invites" ("email");`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "auth_lockouts" (
      "key" varchar(320) PRIMARY KEY,
      "fail_count" integer NOT NULL DEFAULT 0,
      "locked_until" timestamptz,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "customers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(120) NOT NULL,
      "email" varchar(254) NOT NULL,
      "password_hash" text,
      "cpf" varchar(11),
      "phone" varchar(20),
      "born_at" timestamptz,
      "age_verified_at" timestamptz,
      "notes" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "customers_email_idx" ON "customers" ("email");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "customers_cpf_idx" ON "customers" ("cpf");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "customer_addresses" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
      "recipient" varchar(120) NOT NULL,
      "zip" varchar(8) NOT NULL,
      "street" varchar(160) NOT NULL,
      "number" varchar(20) NOT NULL,
      "complement" varchar(120),
      "neighborhood" varchar(80) NOT NULL,
      "city" varchar(80) NOT NULL,
      "state" varchar(2) NOT NULL,
      "country" varchar(2) NOT NULL DEFAULT 'BR',
      "is_default" boolean NOT NULL DEFAULT false
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "customer_addresses_customer_idx" ON "customer_addresses" ("customer_id");
  `);

  // ---------------------------------------------------------------- Catálogo
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "brands" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(80) NOT NULL,
      "slug" varchar(80) NOT NULL,
      "logo_url" text,
      "description" text DEFAULT '',
      "position" integer NOT NULL DEFAULT 0,
      "active" boolean NOT NULL DEFAULT true
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "brands_slug_idx" ON "brands" ("slug");
  `);
  await db.execute(sql`ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "logo_url" text;`);
  await db.execute(sql`ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '';`);
  await db.execute(sql`ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;`);
  await db.execute(sql`ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "categories" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "parent_id" uuid REFERENCES "categories"("id"),
      "name" varchar(80) NOT NULL,
      "slug" varchar(160) NOT NULL,
      "description" text DEFAULT '',
      "image_url" text,
      "age_restricted" boolean NOT NULL DEFAULT false,
      "active" boolean NOT NULL DEFAULT true,
      "position" integer NOT NULL DEFAULT 0
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "categories_slug_idx" ON "categories" ("slug");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "categories_parent_idx" ON "categories" ("parent_id");
  `);
  await db.execute(sql`ALTER TABLE "categories" ALTER COLUMN "slug" TYPE varchar(160);`);

  await db.execute(sql`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '';`);
  await db.execute(sql`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "image_url" text;`);
  await db.execute(sql`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(160) NOT NULL,
      "slug" varchar(160) NOT NULL,
      "short_description" text DEFAULT '',
      "description" text DEFAULT '',
      "category_id" uuid NOT NULL REFERENCES "categories"("id"),
      "brand_id" uuid REFERENCES "brands"("id"),
      "age_restricted" boolean NOT NULL DEFAULT false,
      "featured" boolean NOT NULL DEFAULT false,
      "published" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "condicao" varchar(20) NOT NULL DEFAULT 'novo';`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "estado_conservacao" varchar(100) DEFAULT '';`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "itens_inclusos" text DEFAULT '';`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "garantia_dias" integer NOT NULL DEFAULT 30;`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "unidade_unica" boolean NOT NULL DEFAULT false;`);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_idx" ON "products" ("slug");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products" ("category_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_published_idx" ON "products" ("published");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_created_idx" ON "products" ("created_at");
  `);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "short_description" text DEFAULT '';`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "product_variants" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "sku" varchar(64) NOT NULL,
      "name" varchar(120) NOT NULL,
      "price_cents" integer NOT NULL,
      "promo_price_cents" integer,
      "weight_grams" integer NOT NULL DEFAULT 0,
      "active" boolean NOT NULL DEFAULT true
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_sku_idx" ON "product_variants" ("sku");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_variants_product_idx" ON "product_variants" ("product_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "product_images" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "url" text NOT NULL,
      "alt" varchar(200),
      "kind" varchar(20) NOT NULL DEFAULT 'image',
      "position" integer NOT NULL DEFAULT 0
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_images_product_idx" ON "product_images" ("product_id");
  `);
  await db.execute(sql`ALTER TABLE "product_images" ADD COLUMN IF NOT EXISTS "kind" varchar(20) NOT NULL DEFAULT 'image';`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "product_specs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "key" varchar(60) NOT NULL,
      "label" varchar(120) NOT NULL,
      "value" varchar(240) NOT NULL,
      "position" integer NOT NULL DEFAULT 0
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_specs_product_idx" ON "product_specs" ("product_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_specs_key_idx" ON "product_specs" ("key");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "related_products" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "related_product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "position" integer NOT NULL DEFAULT 0
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "related_products_pair_idx" ON "related_products" ("product_id", "related_product_id");
  `);

  // ---------------------------------------------------------------- CMS
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "banners" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "title" varchar(160) NOT NULL,
      "subtitle" varchar(240) DEFAULT '',
      "eyebrow" varchar(80) DEFAULT '',
      "cta_label" varchar(60) DEFAULT '',
      "image_desktop" text,
      "image_mobile" text,
      "link" text,
      "kind" varchar(20) NOT NULL DEFAULT 'hero',
      "starts_at" timestamptz,
      "ends_at" timestamptz,
      "active" boolean NOT NULL DEFAULT true,
      "position" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "banners_active_idx" ON "banners" ("active");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "banners_position_idx" ON "banners" ("position");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "homepage_sections" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" varchar(40) NOT NULL,
      "title" varchar(120) DEFAULT '',
      "subtitle" varchar(240) DEFAULT '',
      "position" integer NOT NULL DEFAULT 0,
      "active" boolean NOT NULL DEFAULT true,
      "config" jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "homepage_sections_position_idx" ON "homepage_sections" ("position");
  `);

  // ---------------------------------------------------------------- Estoque
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "inventory" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
      "physical" integer NOT NULL DEFAULT 0,
      "reserved" integer NOT NULL DEFAULT 0,
      "min_quantity" integer NOT NULL DEFAULT 0,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "inventory_variant_idx" ON "inventory" ("variant_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "inventory_movements" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "variant_id" uuid NOT NULL REFERENCES "product_variants"("id"),
      "type" movement_type NOT NULL,
      "quantity" integer NOT NULL,
      "physical_before" integer NOT NULL,
      "physical_after" integer NOT NULL,
      "reserved_before" integer NOT NULL,
      "reserved_after" integer NOT NULL,
      "reason" text NOT NULL,
      "order_id" uuid,
      "user_id" uuid REFERENCES "users"("id"),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "inventory_movements_variant_idx" ON "inventory_movements" ("variant_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "inventory_movements_order_idx" ON "inventory_movements" ("order_id");
  `);

  // ---------------------------------------------------------------- Carrinho
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "carts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "customer_id" uuid REFERENCES "customers"("id") ON DELETE CASCADE,
      "session_key" varchar(64),
      "coupon_code" varchar(40),
      "expires_at" timestamptz,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "carts_customer_idx" ON "carts" ("customer_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "carts_session_idx" ON "carts" ("session_key");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "cart_items" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "cart_id" uuid NOT NULL REFERENCES "carts"("id") ON DELETE CASCADE,
      "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
      "quantity" integer NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_variant_idx" ON "cart_items" ("cart_id", "variant_id");
  `);

  // ---------------------------------------------------------------- Pedidos
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "orders" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "number" varchar(20) NOT NULL,
      "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
      "status" order_status NOT NULL DEFAULT 'aguardando_pagamento',
      "subtotal_cents" integer NOT NULL,
      "discount_cents" integer NOT NULL DEFAULT 0,
      "shipping_cents" integer NOT NULL DEFAULT 0,
      "total_cents" integer NOT NULL,
      "coupon_code" varchar(40),
      "payment_method" payment_method,
      "address_json" jsonb NOT NULL,
      "customer_notes" text,
      "terms_version" varchar(20),
      "terms_accepted_at" timestamptz,
      "terms_ip" varchar(45),
      "volume_day" varchar(10),
      "risk_level" risk_level,
      "risk_score" integer DEFAULT 0,
      "risk_reasons" jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "orders_number_idx" ON "orders" ("number");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "orders_customer_idx" ON "orders" ("customer_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" ("status");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "orders_created_idx" ON "orders" ("created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "orders_volume_day_idx" ON "orders" ("volume_day");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "order_items" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
      "variant_id" uuid NOT NULL,
      "sku" varchar(64) NOT NULL,
      "name" varchar(200) NOT NULL,
      "quantity" integer NOT NULL,
      "unit_price_cents" integer NOT NULL,
      "total_cents" integer NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "order_items_order_idx" ON "order_items" ("order_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "order_status_history" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
      "from_status" order_status,
      "to_status" order_status NOT NULL,
      "reason" text,
      "actor_user_id" uuid REFERENCES "users"("id"),
      "actor_system" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "order_status_history_order_idx" ON "order_status_history" ("order_id");
  `);

  // ---------------------------------------------------------------- Pagamentos
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "payments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id"),
      "provider" varchar(32) NOT NULL,
      "method" payment_method NOT NULL,
      "status" payment_status NOT NULL DEFAULT 'pendente',
      "amount_cents" integer NOT NULL,
      "authorized_cents" integer,
      "provider_transaction_id" varchar(120),
      "payload" text,
      "expires_at" timestamptz,
      "captured_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "payments_order_idx" ON "payments" ("order_id");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_tx_idx" ON "payments" ("provider", "provider_transaction_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "payment_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "payment_id" uuid REFERENCES "payments"("id"),
      "provider" varchar(32) NOT NULL,
      "event_id" varchar(160) NOT NULL,
      "type" varchar(80) NOT NULL,
      "payload" jsonb NOT NULL,
      "signature_valid" boolean,
      "processed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_event_idx" ON "payment_events" ("provider", "event_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "payment_events_payment_idx" ON "payment_events" ("payment_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "refunds" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "payment_id" uuid NOT NULL REFERENCES "payments"("id"),
      "amount_cents" integer NOT NULL,
      "reason" text,
      "provider_refund_id" varchar(120),
      "requested_by_user_id" uuid REFERENCES "users"("id"),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);

  // ---------------------------------------------------------------- Antifraude
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fraud_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "key" varchar(60) NOT NULL,
      "name" varchar(120) NOT NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "weight" integer NOT NULL DEFAULT 10,
      "threshold" integer,
      "action" varchar(20) NOT NULL DEFAULT 'soma',
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "fraud_rules_key_idx" ON "fraud_rules" ("key");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fraud_assessments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id"),
      "score" integer NOT NULL,
      "level" risk_level NOT NULL,
      "action" varchar(20) NOT NULL,
      "reasons" jsonb NOT NULL,
      "ip" varchar(45),
      "device_fingerprint" text,
      "auto_decision" boolean NOT NULL DEFAULT true,
      "reviewed_by_user_id" uuid REFERENCES "users"("id"),
      "review_note" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "fraud_assessments_order_idx" ON "fraud_assessments" ("order_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fraud_review_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "assessment_id" uuid NOT NULL REFERENCES "fraud_assessments"("id") ON DELETE CASCADE,
      "action" varchar(40) NOT NULL,
      "note" text,
      "reviewer_id" uuid REFERENCES "users"("id"),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "fraud_review_events_assessment_idx" ON "fraud_review_events" ("assessment_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "watchlist" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" varchar(20) NOT NULL,
      "value" varchar(254) NOT NULL,
      "reason" text NOT NULL,
      "added_by_user_id" uuid REFERENCES "users"("id"),
      "expires_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_kind_value_idx" ON "watchlist" ("kind", "value");
  `);

  // ---------------------------------------------------------------- Chargeback
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "chargebacks" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id"),
      "payment_id" uuid REFERENCES "payments"("id"),
      "provider" varchar(32) NOT NULL,
      "provider_dispute_id" varchar(120) NOT NULL,
      "status" chargeback_status NOT NULL DEFAULT 'notificado',
      "amount_cents" integer NOT NULL,
      "reason" varchar(120),
      "reason_code" varchar(30),
      "respond_by" timestamptz,
      "notified_at" timestamptz NOT NULL DEFAULT now(),
      "resolved_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "chargebacks_dispute_idx" ON "chargebacks" ("provider", "provider_dispute_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "chargebacks_order_idx" ON "chargebacks" ("order_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "chargebacks_respond_by_idx" ON "chargebacks" ("respond_by");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "chargeback_evidence" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "chargeback_id" uuid NOT NULL REFERENCES "chargebacks"("id") ON DELETE CASCADE,
      "kind" varchar(40) NOT NULL,
      "label" varchar(160) NOT NULL,
      "content" jsonb,
      "file_url" text,
      "added_by_user_id" uuid REFERENCES "users"("id"),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "chargeback_evidence_cb_idx" ON "chargeback_evidence" ("chargeback_id");
  `);

  // ---------------------------------------------------------------- Logística
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "shipments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id"),
      "carrier" varchar(40) NOT NULL,
      "tracking_code" varchar(60),
      "shipping_cents" integer NOT NULL DEFAULT 0,
      "estimated_days" integer,
      "shipped_at" timestamptz,
      "delivered_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "shipments_order_idx" ON "shipments" ("order_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "shipping_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
      "status" varchar(40) NOT NULL,
      "description" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "shipping_events_shipment_idx" ON "shipping_events" ("shipment_id");
  `);

  // ---------------------------------------------------------------- Promoções
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "coupons" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "code" varchar(40) NOT NULL,
      "kind" varchar(20) NOT NULL,
      "value" integer NOT NULL,
      "min_order_cents" integer NOT NULL DEFAULT 0,
      "max_uses" integer,
      "used_count" integer NOT NULL DEFAULT 0,
      "starts_at" timestamptz,
      "ends_at" timestamptz,
      "active" boolean NOT NULL DEFAULT true
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_idx" ON "coupons" ("code");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "promotions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(120) NOT NULL,
      "kind" varchar(30) NOT NULL,
      "content" jsonb NOT NULL,
      "starts_at" timestamptz,
      "ends_at" timestamptz,
      "active" boolean NOT NULL DEFAULT true
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "order_volume_limits" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "max_orders_per_day" integer NOT NULL DEFAULT 0,
      "max_revenue_per_day_cents" bigint NOT NULL DEFAULT 0,
      "max_orders_per_customer_per_day" integer NOT NULL DEFAULT 0,
      "max_order_value_cents" integer NOT NULL DEFAULT 0,
      "action_when_exceeded" varchar(20) NOT NULL DEFAULT 'bloquear_checkout',
      "enabled" boolean NOT NULL DEFAULT false,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gateway_configs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "provider" varchar(32) NOT NULL,
      "credentials_encrypted" text,
      "enabled" boolean NOT NULL DEFAULT false,
      "is_default" boolean NOT NULL DEFAULT false,
      "methods" jsonb NOT NULL DEFAULT '["pix","cartao","boleto"]'::jsonb,
      "capture_after_review" boolean NOT NULL DEFAULT false,
      "require3ds" boolean NOT NULL DEFAULT false,
      "pix_discount_percent" integer NOT NULL DEFAULT 0,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "updated_by_user_id" uuid REFERENCES "users"("id")
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "gateway_configs_provider_idx" ON "gateway_configs" ("provider");
  `);

  // ---------------------------------------------------------------- Operação
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "audit_logs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "actor_user_id" uuid REFERENCES "users"("id"),
      "actor_label" varchar(120),
      "action" varchar(80) NOT NULL,
      "entity" varchar(60) NOT NULL,
      "entity_id" varchar(64),
      "before_json" text,
      "after_json" text,
      "ip" varchar(45),
      "correlation_id" varchar(64),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" ("actor_user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" ("entity", "entity_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_logs_created_idx" ON "audit_logs" ("created_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "system_settings" (
      "key" varchar(60) PRIMARY KEY,
      "value" jsonb NOT NULL,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "notifications" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" varchar(40) NOT NULL,
      "title" varchar(160) NOT NULL,
      "body" text,
      "severity" varchar(10) NOT NULL DEFAULT 'info',
      "read_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "notifications_created_idx" ON "notifications" ("created_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "daily_metrics" (
      "day" varchar(10) PRIMARY KEY,
      "orders_created" integer NOT NULL DEFAULT 0,
      "orders_approved" integer NOT NULL DEFAULT 0,
      "orders_cancelled" integer NOT NULL DEFAULT 0,
      "gross_cents" bigint NOT NULL DEFAULT 0,
      "refunded_cents" bigint NOT NULL DEFAULT 0,
      "chargebacks_received" integer NOT NULL DEFAULT 0,
      "chargeback_amount_cents" bigint NOT NULL DEFAULT 0,
      "tickets_cents" bigint NOT NULL DEFAULT 0,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" varchar(254) NOT NULL,
      "source" varchar(40) NOT NULL DEFAULT 'homepage',
      "consent" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_email_idx" ON "newsletter_subscribers" ("email");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "support_tickets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
      "name" varchar(120) NOT NULL,
      "email" varchar(254) NOT NULL,
      "subject" varchar(160) NOT NULL,
      "message" text NOT NULL,
      "status" varchar(20) NOT NULL DEFAULT 'aberto',
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON "support_tickets" ("status");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "support_tickets_created_idx" ON "support_tickets" ("created_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "blog_posts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "title" varchar(200) NOT NULL,
      "slug" varchar(220) NOT NULL,
      "excerpt" text DEFAULT '',
      "content" text NOT NULL,
      "cover_image" text,
      "author" varchar(120) DEFAULT 'Equipe Airsoft Americana',
      "category" varchar(60) DEFAULT 'Guias',
      "tags" text DEFAULT '',
      "reading_minutes" integer NOT NULL DEFAULT 4,
      "seo_title" varchar(200),
      "seo_description" varchar(320),
      "published" boolean NOT NULL DEFAULT false,
      "published_at" timestamptz NOT NULL DEFAULT now(),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_slug_idx" ON "blog_posts" ("slug");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "blog_posts_published_idx" ON "blog_posts" ("published");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "blog_posts_published_at_idx" ON "blog_posts" ("published_at");
  `);

  // Colunas novas no schema sem tabela nova: o CREATE TABLE IF NOT EXISTS acima
  // não altera tabela existente, então o banco ficaria velho e as queries
  // caem com "column does not exist". Este passo fecha a diferença.
  const applied = await syncSchemaColumns(db);
  if (applied.length > 0) {
    console.log(`↻ ${applied.length} coluna(s) adicionada(s): ${applied.join(", ")}`);
  }
}

export default migrate;
