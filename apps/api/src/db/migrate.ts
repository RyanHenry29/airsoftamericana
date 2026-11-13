import { sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { syncSchemaColumns } from "./sync-columns.js";
import { migrateLegacyRoles } from "./migrate-roles.js";

/**
 * Migrações brutas, idempotentes — drizzle-kit não está configurado no pipeline.
 * Cada statement usa IF NOT EXISTS: reexecutar é seguro em dev, test e prod.
 *
 * Compatível com Postgres e PGlite (sem extensions além de gen_random_uuid,
 * que existe nativamente no PG13+ e no PGlite).
 * Enums são criados inline como varchar + CHECK constraints.
 */

export async function migrate(db: Db) {
  // ---------------------------------------------------------------- Core: users & auth
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" varchar(254) NOT NULL,
      "password_hash" text NOT NULL,
      "name" varchar(120) NOT NULL,
      "role" varchar(32) NOT NULL DEFAULT 'atendimento',
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
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_last_used_step" integer;`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "needs_role_review" boolean NOT NULL DEFAULT false;`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passkey_credential_id" text;`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passkey_public_key" text;`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passkey_sign_count" integer NOT NULL DEFAULT 0;`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passkey_aaguid" text;`);

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
      "mfa_challenge" text,
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

  // ---------------------------------------------------------------- Clientes
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

  // Foto de perfil do cliente: uma por conta (índice único) — o upload faz
  // upsert e o GET devolve os bytes com o mime gravado.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "customer_avatars" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
      "mime" varchar(64) NOT NULL,
      "bytes" bytea NOT NULL,
      "size_bytes" integer NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "customer_avatars_customer_uniq" ON "customer_avatars" ("customer_id");
  `);

  // Redefinição de senha: token sha256 (nunca o valor puro), TTL de 60 min,
  // consumo marcado por used_at — a comparação é atômica em transação.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "password_resets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
      "token_hash" varchar(64) NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "used_at" timestamptz,
      "requested_ip" varchar(45),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "password_resets_token_idx" ON "password_resets" ("token_hash");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "password_resets_customer_idx" ON "password_resets" ("customer_id");
  `);

  // ---------------------------------------------------------------- Catálogo: brands, categories, products, variants
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "brands" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(120) NOT NULL,
      "slug" varchar(140) NOT NULL,
      "description" text,
      "logo_url" text,
      "active" boolean NOT NULL DEFAULT true,
      "position" integer NOT NULL DEFAULT 0,
      "seo_title" varchar(160),
      "seo_description" varchar(320),
      "seo_canonical" text,
      "seo_og_image" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "seo_title" varchar(160);`);
  await db.execute(sql`ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "seo_description" varchar(320);`);
  await db.execute(sql`ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "seo_canonical" text;`);
  await db.execute(sql`ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "seo_og_image" text;`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "brands_slug_idx" ON "brands" ("slug");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "brands_active_idx" ON "brands" ("active");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "brands_position_idx" ON "brands" ("position");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "categories" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(120) NOT NULL,
      "slug" varchar(140) NOT NULL,
      "description" text,
      "age_restricted" boolean NOT NULL DEFAULT false,
      "active" boolean NOT NULL DEFAULT true,
      "parent_id" uuid REFERENCES "categories"("id") ON DELETE SET NULL,
      "position" integer NOT NULL DEFAULT 0,
      "image_url" text,
      "seo_title" varchar(160),
      "seo_description" varchar(320),
      "seo_canonical" text,
      "seo_og_image" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "seo_title" varchar(160);`);
  await db.execute(sql`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "seo_description" varchar(320);`);
  await db.execute(sql`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "seo_canonical" text;`);
  await db.execute(sql`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "seo_og_image" text;`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "categories_slug_idx" ON "categories" ("slug");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "categories_parent_idx" ON "categories" ("parent_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "categories_active_idx" ON "categories" ("active");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(160) NOT NULL,
      "slug" varchar(180) NOT NULL,
      "short_description" text,
      "description" text,
      "technical_description" text,
      "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
      "brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL,
      "age_restricted" boolean NOT NULL DEFAULT true,
      "featured" boolean NOT NULL DEFAULT false,
      "published" boolean NOT NULL DEFAULT false,
      "active" boolean NOT NULL DEFAULT true,
      "condicao" varchar(20) DEFAULT 'novo',
      "cost_cents" integer,
      "tags" text,
      "seo_title" varchar(200),
      "seo_description" varchar(320),
      "seo_canonical" text,
      "seo_og_image" text,
      "videos" jsonb,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "published_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "technical_description" text;`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cost_cents" integer;`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tags" text;`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "seo_title" varchar(200);`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "seo_description" varchar(320);`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "seo_canonical" text;`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "seo_og_image" text;`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "videos" jsonb;`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "published_at" timestamptz;`);
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_idx" ON "products" ("slug");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products" ("category_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_brand_idx" ON "products" ("brand_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_active_idx" ON "products" ("published", "active");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "product_variants" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "sku" varchar(64) NOT NULL,
      "name" varchar(120) NOT NULL,
      "price_cents" integer NOT NULL,
      "promo_price_cents" integer,
      "weight_grams" integer NOT NULL DEFAULT 0,
      "active" boolean NOT NULL DEFAULT true,
      "condicao" varchar(20) DEFAULT 'novo',
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "promo_price_cents" integer;`);
  await db.execute(sql`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "weight_grams" integer NOT NULL DEFAULT 0;`);
  await db.execute(sql`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;`);
  await db.execute(sql`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();`);
  await db.execute(sql`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "condicao" varchar(20) DEFAULT 'novo';`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_sku_idx" ON "product_variants" ("sku");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_variants_product_idx" ON "product_variants" ("product_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_variants_active_idx" ON "product_variants" ("active");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "product_images" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "url" text NOT NULL,
      "alt" text,
      "kind" varchar(20) NOT NULL DEFAULT 'image',
      "position" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now()
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
      "key" varchar(80) NOT NULL,
      "value" text NOT NULL,
      "position" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_specs_product_idx" ON "product_specs" ("product_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "related_products" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "related_product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "position" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "related_products_pair_idx" ON "related_products" ("product_id", "related_product_id");
  `);

  // ---------------------------------------------------------------- CMS
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "banner_images" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "mime" varchar(64) NOT NULL,
      "bytes" bytea NOT NULL,
      "size_bytes" integer NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "banner_images_created_idx" ON "banner_images" ("created_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "banners" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "title" varchar(160) NOT NULL,
      "subtitle" varchar(240) DEFAULT '',
      "eyebrow" varchar(80) DEFAULT '',
      "cta_label" varchar(60) DEFAULT '',
      "image_desktop" text,
      "image_mobile" text,
      "image_upload_id" uuid REFERENCES "banner_images"("id") ON DELETE SET NULL,
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
    ALTER TABLE "banners" ADD COLUMN IF NOT EXISTS "image_upload_id" uuid REFERENCES "banner_images"("id") ON DELETE SET NULL;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "banners_image_upload_idx" ON "banners" ("image_upload_id");
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

  // Seções removidas da home (a loja não renderiza mais): some também das
  // linhas já gravadas no CMS — idempotente, roda no bootstrap e nos testes.
  await db.execute(sql`
    DELETE FROM "homepage_sections" WHERE "kind" IN ('benefits', 'institutional', 'newsletter');
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
      "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
      "type" varchar(20) NOT NULL,
      "quantity" integer NOT NULL,
      "physical_before" integer NOT NULL,
      "physical_after" integer NOT NULL,
      "reserved_before" integer NOT NULL,
      "reserved_after" integer NOT NULL,
      "reason" text,
      "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "inventory_movements_variant_idx" ON "inventory_movements" ("variant_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "inventory_movements_type_idx" ON "inventory_movements" ("type");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "inventory_movements_created_idx" ON "inventory_movements" ("created_at");
  `);

  // ---------------------------------------------------------------- Carrinho (after product_variants)
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
      "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE RESTRICT,
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
      "status" varchar(32) NOT NULL DEFAULT 'aguardando_pagamento',
      "subtotal_cents" integer NOT NULL,
      "discount_cents" integer NOT NULL DEFAULT 0,
      "shipping_cents" integer NOT NULL DEFAULT 0,
      "total_cents" integer NOT NULL,
      "coupon_code" varchar(40),
      "payment_method" varchar(32),
      "address_json" jsonb NOT NULL,
      "customer_notes" text,
      "terms_version" varchar(20),
      "terms_accepted_at" timestamptz,
      "terms_ip" varchar(45),
      "volume_day" varchar(10),
      "risk_level" varchar(16),
      "risk_score" integer DEFAULT 0,
      "risk_reasons" jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "orders_status_check" CHECK ("status" IN ('aguardando_pagamento','pagamento_em_processamento','em_analise_antifraude','aguardando_revisao_manual','pagamento_aprovado','separacao','preparando_envio','enviado','entregue','cancelado','reembolsado','em_disputa','chargeback_recebido')),
      CONSTRAINT "orders_payment_method_check" CHECK ("payment_method" IN ('pix','cartao','boleto')),
      CONSTRAINT "orders_risk_level_check" CHECK ("risk_level" IN ('baixo','medio','alto'))
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "order_items" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
      "variant_id" uuid,
      "sku" varchar(64) NOT NULL,
      "name" varchar(160) NOT NULL,
      "quantity" integer NOT NULL,
      "unit_price_cents" integer NOT NULL,
      "total_cents" integer NOT NULL
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
    CREATE TABLE IF NOT EXISTS "order_status_history" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
      "from_status" varchar(32),
      "to_status" varchar(32) NOT NULL,
      "actor_type" varchar(20) NOT NULL,
      "actor_id" uuid,
      "reason" text,
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
      "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
      "provider" varchar(32) NOT NULL,
      "method" varchar(32) NOT NULL,
      "status" varchar(32) NOT NULL DEFAULT 'pendente',
      "amount_cents" integer NOT NULL,
      "authorized_cents" integer,
      "provider_transaction_id" varchar(128),
      "payload" text,
      "expires_at" timestamptz,
      "captured_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "payments_order_idx" ON "payments" ("order_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" ("status");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "payments_provider_idx" ON "payments" ("provider");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "payment_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "payment_id" uuid REFERENCES "payments"("id") ON DELETE CASCADE,
      "type" varchar(40) NOT NULL,
      "payload" jsonb NOT NULL,
      "processed_at" timestamptz
    );
  `);
  // AUD-15: payment_id é NULLABLE — evento de webhook que chega na corrida
  // checkout×webhook (cobrança criada, INSERT local ainda não commitado)
  // fica estacionado sem paymentId e é aplicado depois pelo checkout
  // (applyPendingEventsForPayment). processed_at também fica NULL até aplicar.
  await db.execute(sql`
    ALTER TABLE "payment_events" ALTER COLUMN "payment_id" DROP NOT NULL;
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE "payment_events" ALTER COLUMN "processed_at" DROP NOT NULL;
  `).catch(() => {});
  // Revisão v3 (ponto A): fila de recuperação com tentativas, backoff e
  // dead-letter. ALTER idempotentes — produção só com autorização.
  await db.execute(sql`
    ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamptz;
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "last_error" text;
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "dead_letter" boolean NOT NULL DEFAULT false;
  `).catch(() => {});
  // Revisão v4: lease do claim (exclusão de reivindicação entre instâncias).
  await db.execute(sql`
    ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamptz;
  `).catch(() => {});
  // Revisão v5: fencing token do lease — conclusão exige posse atual.
  await db.execute(sql`
    ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "lease_token" varchar(64);
  `).catch(() => {});
  // Revisão v5 (item 4): primeira observação `null` persistida — confirmação
  // de ausência exige consultas em passadas distintas.
  await db.execute(sql`
    ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "not_found_first_seen_at" timestamptz;
  `).catch(() => {});
  // Revisão v5: lease de manutenção entre INSTÂNCIAS (exclusão no banco,
  // não no processo) — uma instância varre por vez.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "system_locks" (
      "name" varchar(64) PRIMARY KEY,
      "lease_token" varchar(64),
      "lease_expires_at" timestamptz,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `).catch(() => {});
  await db.execute(sql`
    INSERT INTO "system_locks" ("name") VALUES ('payment_maintenance') ON CONFLICT DO NOTHING;
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "payment_events_payment_idx" ON "payment_events" ("payment_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "refunds" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "payment_id" uuid NOT NULL REFERENCES "payments"("id") ON DELETE CASCADE,
      "amount_cents" integer NOT NULL,
      "status" varchar(20) NOT NULL DEFAULT 'pendente',
      "reason" text,
      "gateway_refund_id" varchar(128),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "refunds_payment_idx" ON "refunds" ("payment_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gateway_configs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "provider" varchar(32) NOT NULL,
      "is_default" boolean NOT NULL DEFAULT false,
      "enabled" boolean NOT NULL DEFAULT true,
      "credentials" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "decryption_failures" integer NOT NULL DEFAULT 0,
      "last_decryption_failure_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "gateway_configs_provider_idx" ON "gateway_configs" ("provider");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "gateway_configs_default_idx" ON "gateway_configs" ("is_default");
  `);

  // ---------------------------------------------------------------- Chargebacks
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "chargebacks" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "payment_id" uuid NOT NULL REFERENCES "payments"("id") ON DELETE CASCADE,
      "gateway" varchar(32) NOT NULL,
      "gateway_chargeback_id" varchar(128),
      "amount_cents" integer NOT NULL,
      "reason_code" varchar(32),
      "reason_description" text,
      "status" varchar(32) NOT NULL DEFAULT 'notificado',
      "deadline_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "chargebacks_status_check" CHECK ("status" IN ('notificado','aguardando_analise','documentacao_pendente','defesa_preparada','defesa_enviada','em_analise','ganho','perdido','encerrado'))
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "chargebacks_payment_idx" ON "chargebacks" ("payment_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "chargebacks_status_idx" ON "chargebacks" ("status");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "chargebacks_deadline_idx" ON "chargebacks" ("deadline_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "chargeback_evidence" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "chargeback_id" uuid NOT NULL REFERENCES "chargebacks"("id") ON DELETE CASCADE,
      "type" varchar(32) NOT NULL,
      "content" text,
      "file_path" text,
      "mime" varchar(64),
      "size_bytes" integer,
      "submitted_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "chargeback_evidence_chargeback_idx" ON "chargeback_evidence" ("chargeback_id");
  `);

  // ---------------------------------------------------------------- Fraud
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fraud_assessments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
      "level" varchar(16) NOT NULL,
      "score" integer NOT NULL,
      "reasons" jsonb,
      "decision" varchar(20),
      "reviewed_at" timestamptz,
      "reviewer_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "fraud_assessments_level_check" CHECK ("level" IN ('baixo','medio','alto'))
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "fraud_assessments_order_idx" ON "fraud_assessments" ("order_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "fraud_assessments_level_idx" ON "fraud_assessments" ("level");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fraud_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "key" varchar(64) NOT NULL,
      "description" text,
      "action" varchar(20) NOT NULL,
      "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "enabled" boolean NOT NULL DEFAULT true,
      "priority" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "fraud_rules_key_idx" ON "fraud_rules" ("key");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "watchlist" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" varchar(20) NOT NULL,
      "value" text NOT NULL,
      "reason" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_kind_value_idx" ON "watchlist" ("kind", "value");
  `);

  // ---------------------------------------------------------------- Fraud (cont.)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fraud_review_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "assessment_id" uuid REFERENCES "fraud_assessments"("id") ON DELETE CASCADE,
      "action" varchar(40) NOT NULL,
      "note" text,
      "reviewer_id" uuid REFERENCES "users"("id"),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "fraud_review_events_assessment_idx" ON "fraud_review_events" ("assessment_id");
  `);

  // ---------------------------------------------------------------- Envios
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

  // ---------------------------------------------------------------- Limites de volume
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

  // ---------------------------------------------------------------- Notificações
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

  // ---------------------------------------------------------------- Métricas diárias
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

  // ---------------------------------------------------------------- Histórico de produtos
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "product_change_history" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "actor_label" varchar(120),
      "field" varchar(80) NOT NULL,
      "before_value" text,
      "after_value" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_change_history_product_idx" ON "product_change_history" ("product_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "product_change_history_created_idx" ON "product_change_history" ("created_at");
  `);

  // ---------------------------------------------------------------- Chaves de idempotência
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "idempotency_keys" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "key" varchar(255) NOT NULL UNIQUE,
      "action" varchar(80) NOT NULL,
      "payload_hash" varchar(64),
      "result" jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_key_idx" ON "idempotency_keys" ("key");
  `);

  // ---------------------------------------------------------------- Produtos compatíveis
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "compatible_products" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "compatible_product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
      "position" integer NOT NULL DEFAULT 0
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "compatible_products_pair_idx" ON "compatible_products" ("product_id", "compatible_product_id");
  `);

  // ---------------------------------------------------------------- Cupons
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "coupons" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "code" varchar(32) NOT NULL,
      "kind" varchar(20) NOT NULL,
      "value" integer NOT NULL,
      "min_order_cents" integer NOT NULL DEFAULT 0,
      "max_uses" integer,
      "used_count" integer NOT NULL DEFAULT 0,
      "starts_at" timestamptz,
      "ends_at" timestamptz,
      "active" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_idx" ON "coupons" ("code");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "coupons_active_idx" ON "coupons" ("active");
  `);

  // ---------------------------------------------------------------- Newsletter
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" varchar(254) NOT NULL,
      "active" boolean NOT NULL DEFAULT true,
      "source" varchar(40),
      "confirmed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_email_idx" ON "newsletter_subscribers" ("email");
  `);

  // ---------------------------------------------------------------- Webhooks
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "webhooks" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "source" varchar(32) NOT NULL,
      "event" varchar(64) NOT NULL,
      "payload" jsonb NOT NULL,
      "processed" boolean NOT NULL DEFAULT false,
      "error" text,
      "processed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "webhooks_processed_idx" ON "webhooks" ("processed");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "webhooks_source_idx" ON "webhooks" ("source");
  `);

  // ---------------------------------------------------------------- Settings
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "system_settings" (
      "key" varchar(64) PRIMARY KEY,
      "value" jsonb NOT NULL,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "updated_by" uuid
    );
  `);

  // ---------------------------------------------------------------- Fraud
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fraud_assessments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
      "level" varchar(16) NOT NULL,
      "score" integer NOT NULL,
      "reasons" jsonb,
      "decision" varchar(20),
      "reviewed_at" timestamptz,
      "reviewer_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "fraud_assessments_level_check" CHECK ("level" IN ('baixo','medio','alto'))
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "fraud_assessments_order_idx" ON "fraud_assessments" ("order_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "fraud_assessments_level_idx" ON "fraud_assessments" ("level");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fraud_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "key" varchar(64) NOT NULL,
      "description" text,
      "action" varchar(20) NOT NULL,
      "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "enabled" boolean NOT NULL DEFAULT true,
      "priority" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "fraud_rules_key_idx" ON "fraud_rules" ("key");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "watchlist" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" varchar(20) NOT NULL,
      "value" text NOT NULL,
      "reason" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_kind_value_idx" ON "watchlist" ("kind", "value");
  `);

  // ---------------------------------------------------------------- Blog
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "blog_posts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "title" varchar(200) NOT NULL,
      "slug" varchar(220) NOT NULL,
      "excerpt" text,
      "content" text NOT NULL,
      "cover_url" text,
      "category" varchar(60),
      "tags" text,
      "published" boolean NOT NULL DEFAULT false,
      "published_at" timestamptz,
      "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "seo_title" varchar(200),
      "seo_description" varchar(320),
      "seo_canonical" text,
      "seo_og_image" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_slug_idx" ON "blog_posts" ("slug");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "blog_posts_published_idx" ON "blog_posts" ("published");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "blog_posts_category_idx" ON "blog_posts" ("category");
  `);

  // ---------------------------------------------------------------- AI Assistant
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ai_conversations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "title" varchar(200) DEFAULT '',
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_conversations_actor_idx" ON "ai_conversations" ("actor_user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_conversations_created_idx" ON "ai_conversations" ("created_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ai_messages" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
      "role" varchar(16) NOT NULL,
      "content" text NOT NULL,
      "upload_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_messages_conversation_idx" ON "ai_messages" ("conversation_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ai_uploads" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "filename" varchar(200) NOT NULL,
      "mime" varchar(64) NOT NULL,
      "bytes" bytea NOT NULL,
      "size_bytes" integer NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE "ai_uploads" ADD COLUMN IF NOT EXISTS "filename" varchar(200) NOT NULL DEFAULT '';`);
  await db.execute(sql`ALTER TABLE "ai_uploads" ADD COLUMN IF NOT EXISTS "mime" varchar(64) NOT NULL DEFAULT '';`);
  await db.execute(sql`ALTER TABLE "ai_uploads" ADD COLUMN IF NOT EXISTS "bytes" bytea NOT NULL DEFAULT '';`);
  await db.execute(sql`ALTER TABLE "ai_uploads" ADD COLUMN IF NOT EXISTS "size_bytes" integer NOT NULL DEFAULT 0;`);
  await db.execute(sql`ALTER TABLE "ai_uploads" ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now();`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_uploads_actor_idx" ON "ai_uploads" ("actor_user_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ai_drafts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
      "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "status" varchar(20) NOT NULL DEFAULT 'pendente',
      "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "flags" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "upload_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "product_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE;`);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;`);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'pendente';`);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "payload" jsonb NOT NULL DEFAULT '{}'::jsonb;`);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "flags" jsonb NOT NULL DEFAULT '{}'::jsonb;`);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "upload_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;`);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "product_id" uuid;`);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now();`);
  await db.execute(sql`ALTER TABLE "ai_drafts" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_drafts_conversation_idx" ON "ai_drafts" ("conversation_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_drafts_status_idx" ON "ai_drafts" ("status");
  `);

  // ---------------------------------------------------------------- Suporte
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "support_tickets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
      "subject" varchar(200) NOT NULL,
      "body" text NOT NULL,
      "status" varchar(20) NOT NULL DEFAULT 'aberto',
      "priority" varchar(20) NOT NULL DEFAULT 'normal',
      "assignee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "closed_at" timestamptz,
      "closed_by" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "support_tickets_customer_idx" ON "support_tickets" ("customer_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON "support_tickets" ("status");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "support_messages" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
      "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "body" text NOT NULL,
      "is_internal" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "support_messages_ticket_idx" ON "support_messages" ("ticket_id");
  `);

  // ---------------------------------------------------------------- Auditoria
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "audit_logs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "actor_label" varchar(120),
      "action" varchar(64) NOT NULL,
      "entity" varchar(64) NOT NULL,
      "entity_id" uuid,
      "before_json" jsonb,
      "after_json" jsonb,
      "ip" varchar(45),
      "correlation_id" varchar(64),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Trigger para imutabilidade: impede UPDATE e DELETE
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION prevent_audit_modification()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is immutable';
    END;
    $$ LANGUAGE plpgsql;
  `));
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS prevent_audit_update ON "audit_logs";`));
  await db.execute(sql.raw(`
    CREATE TRIGGER prevent_audit_update
    BEFORE UPDATE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification()
  `));
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS prevent_audit_delete ON "audit_logs";`));
  await db.execute(sql.raw(`
    CREATE TRIGGER prevent_audit_delete
    BEFORE DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification()
  `));
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" ("actor_user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" ("entity", "entity_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_logs_created_idx" ON "audit_logs" ("created_at");
  `);

  // ---------------------------------------------------------------- Sync schema columns (idempotent)
  await syncSchemaColumns(db);

  // ---------------------------------------------------------------- Migrate legacy roles (idempotent)
  await migrateLegacyRoles(db);
}