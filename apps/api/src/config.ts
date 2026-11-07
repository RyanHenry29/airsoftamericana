/**
 * Configuração tipada — todas as variáveis passam por aqui.
 * Segredos nunca são logados.
 */
import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().optional().default(""),
  JWT_SECRET: z.string().default("dev-insecure-secret-troque-em-producao"),
  GATEWAY_SECRETS_KEY: z.string().optional().default(""),
  STORE_URL: z.string().default("http://localhost:3000"),
  ADMIN_URL: z.string().default("http://localhost:3001"),
  STORE_NAME: z.string().default("Airsoft Americana"),
  STORE_WHATSAPP: z.string().default(""),
  GATEWAY_ACTIVE: z.string().default("sandbox"),
  LOG_LEVEL: z.string().default("info"),
  FRETE_GRATIS_APARTIR_DE: z.coerce.number().default(0),
  FRETE_VALOR_CENTAVOS: z.coerce.number().default(0),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional().default(""),
  PAGBANK_API_KEY: z.string().optional().default(""),
  CIELO_CLIENT_ID: z.string().optional().default(""),
  CIELO_CLIENT_SECRET: z.string().optional().default(""),
  // Limite de tentativas de acesso (SKILL skill-26). Padrão: login 5/min com
  // bloqueio de 15 min; cadastro 3/h com bloqueio de 24 h. Em dev dá para
  // afrouxar por variável de ambiente sem mexer no código.
  AUTH_LOGIN_MAX: z.coerce.number().default(5),
  AUTH_LOGIN_WINDOW_MS: z.coerce.number().default(60_000),
  AUTH_LOGIN_BLOCK_MS: z.coerce.number().default(15 * 60_000),
  AUTH_REGISTER_MAX: z.coerce.number().default(3),
  AUTH_REGISTER_WINDOW_MS: z.coerce.number().default(60 * 60_000),
  AUTH_REGISTER_BLOCK_MS: z.coerce.number().default(24 * 60 * 60_000),
  // Login do painel: janela curta e bloqueio longo — o admin não pode ficar
  // fora por causa de um carregamento de tela, mas também não pode ser
  // varrido por tentativa automatizada.
  AUTH_ADMIN_MAX: z.coerce.number().default(10),
  AUTH_ADMIN_WINDOW_MS: z.coerce.number().default(60_000),
  AUTH_ADMIN_BLOCK_MS: z.coerce.number().default(15 * 60_000),
  // Guarda global de requisições. O valor cobre uma navegação real da loja
  // (home, catálogo, categorias, carrinho, configurações) sem travar o
  // painel; as rotas de acesso têm limite próprio e mais estrito.
  RATE_LIMIT_MAX: z.coerce.number().default(600),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;