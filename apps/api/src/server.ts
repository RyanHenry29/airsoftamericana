import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { csrfGuard } from "./lib/csrf.js";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import { getDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { seed } from "./db/seed.js";
import { routes } from "./routes/index.js";
import { registerBlogRoutes } from "./routes/blog.js";
import { registerMfaRoutes } from "./routes/mfa.js";
import { config } from "./config.js";

/**
 * Rotas de acesso com limite dedicado (`authRateLimit`) — a guarda global de
 * requisições não deve consumir a cota delas.
 */
const AUTH_ROUTES_WITH_OWN_LIMIT = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/admin-login",
]);

export async function createServer() {
  const app = fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  // Middleware plugins
  await app.register(fastifyCookie);

  // CORS com lista explícita — nunca "*" com credenciais (skill-71).
  const allowedOrigins = new Set(
    [config.STORE_URL, config.ADMIN_URL]
      .filter(Boolean)
      .concat(
        config.NODE_ENV === "development"
          ? ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"]
          : [],
      ),
  );

  await app.register(fastifyCors, {
    origin: (origin, callback) => {
      // Requisição sem Origin (server-to-server, curl, healthcheck) passa.
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.has(origin));
    },
    credentials: true,
  });

  await app.register(fastifyHelmet);
  // B.3: CSRF em mutações do admin. Produção com CSRF_ENFORCE=false recusa subir (config).
  app.addHook("preHandler", csrfGuard);
  // B.9: painel/admin API nunca indexado.
  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/api/admin") || request.url.startsWith("/painel")) {
      reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    }
  });


  // Guarda global de requisições (por IP, por janela).
  //
  // Duas isenções, ambas deliberadas:
  //   1. Rotas de acesso têm limite próprio e mais estrito (authRateLimit) — a
  //      guarda global não deve competir com a cota delas.
  //   2. Em desenvolvimento, o loopback (loja e admin no mesmo host) fica
  //      isento: o dev server recarrega a tela e refaz /api/cart várias vezes
  //      por segundo, o que estourava o teto e respondia 429 até para
  //      /healthz. Em produção o limite vale para todo mundo, inclusive
  //      loopback.
  await app.register(fastifyRateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    allowList: (request) => {
      if (AUTH_ROUTES_WITH_OWN_LIMIT.has(request.url)) return true;
      if (config.NODE_ENV !== "development") return false;
      const ip = request.ip;
      return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    },
  });

  // Database setup
  const db = await getDb();
  app.decorate("db", db as any);

  if (config.NODE_ENV !== "test") {
    await migrate(db);
    // Only seed in development, not in test (tests have their own seed)
    if (config.NODE_ENV === "development") {
      await seed(db);
    }
  }

  // API routes - db passed as third parameter
  routes(app, config, db);
  registerMfaRoutes(app, db);

  // Blog editorial (leitura pública + gestão no painel)
  registerBlogRoutes(app, db);

  // Health check
  app.get("/healthz", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // Root
  app.get("/", async () => {
    return { name: "Airsoft Americana API", version: "0.1.0" };
  });

  return app;
}