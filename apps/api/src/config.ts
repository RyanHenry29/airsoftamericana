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
  // Cloudflare Access (opcional) — defesa em profundidade no admin.
  CF_ACCESS_TEAM_DOMAIN: z.string().optional().default(""),
  CF_ACCESS_AUD: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

/** Segredo padrão — nunca válido em produção. */
export const DefaultJwtSecret = "dev-insecure-secret-troque-em-producao";

export interface EnvProblem {
  variable: string;
  message: string;
}

function isLocal(url: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}

/**
 * Checklist de arranque em produção.
 *
 * Função pura: recebe o ambiente e devolve a lista de problemas. Quem chama
 * decide o que fazer (a API encerra o processo; o teste só confere a lista).
 */
export function assertProductionEnv(env: NodeJS.ProcessEnv): EnvProblem[] {
  const problems: EnvProblem[] = [];

  const jwt = (env.JWT_SECRET ?? "").trim();
  if (!jwt) {
    problems.push({
      variable: "JWT_SECRET",
      message:
        "JWT_SECRET ausente — a API não sobe sem segredo de assinatura. Gere com: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    });
  } else if (jwt === DefaultJwtSecret) {
    problems.push({
      variable: "JWT_SECRET",
      message:
        "JWT_SECRET ainda é o valor padrão de desenvolvimento — troque por um segredo gerado antes de subir em produção.",
    });
  }

  const key = (env.GATEWAY_SECRETS_KEY ?? "").trim();
  if (!key) {
    problems.push({
      variable: "GATEWAY_SECRETS_KEY",
      message:
        "GATEWAY_SECRETS_KEY ausente — as credenciais de gateway ficam cifradas no banco e não podem ser lidas sem ela. Gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    });
  } else {
    const decoded = Buffer.from(key, "base64");
    if (decoded.length !== 32) {
      problems.push({
        variable: "GATEWAY_SECRETS_KEY",
        message:
          `GATEWAY_SECRETS_KEY inválida — decodifica em ${decoded.length} byte(s) e a cifragem AES-256-GCM exige exatamente 32 bytes em base64.`,
      });
    }
  }

  if (!(env.DATABASE_URL ?? "").trim()) {
    problems.push({
      variable: "DATABASE_URL",
      message:
        "DATABASE_URL ausente — em produção a API exige Postgres (o PGlite em arquivo é só para desenvolvimento e teste).",
    });
  }

  for (const variable of ["STORE_URL", "ADMIN_URL"] as const) {
    const url = (env[variable] ?? "").trim();
    if (!url) {
      problems.push({ variable, message: `${variable} ausente — a loja e o painel precisam da URL pública.` });
      continue;
    }
    if (isLocal(url)) {
      problems.push({
        variable,
        message: `${variable} ainda aponta para localhost (${url}) — em produção a URL pública precisa do domínio real.`,
      });
      continue;
    }
    if (!url.startsWith("https://")) {
      problems.push({
        variable,
        message: `${variable} não é HTTPS (${url}) — cookie de sessão e MFA exigem TLS em produção.`,
      });
    }
  }

  // CSRF obrigatório em produção — desligar explicitamente é recusa de arranque.
  if ((env.NODE_ENV ?? "") === "production" && (env.CSRF_ENFORCE ?? "").toLowerCase() === "false") {
    problems.push({
      variable: "CSRF_ENFORCE",
      message: "CSRF_ENFORCE=false em produção — a API recusou subir. Proteção CSRF é obrigatória no painel.",
    });
  }

  return problems;
}

/**
 * Em produção a API NÃO sobe com configuração incompleta: segredo JWT padrão,
 * chave de criptografia ausente, banco ausente ou URL pública inválida são
 * falhas de arranque, não avisos no log.
 */
if (parsed.data.NODE_ENV === "production") {
  const problems = assertProductionEnv(process.env);
  if (problems.length > 0) {
    console.error(
      `A API recusou subir em produção (${problems.length} problema(s) de configuração):\n` +
        problems.map((p) => `  - [${p.variable}] ${p.message}`).join("\n"),
    );
    process.exit(1);
  }
}

export const config = parsed.data;
export type Config = typeof config;
