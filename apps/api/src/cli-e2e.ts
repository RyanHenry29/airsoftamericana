// Configura env ANTES de qualquer importação
process.env.PGLITE_DIR = "data-e2e";
process.env.API_PORT = "4000";
process.env.API_HOST = "127.0.0.1";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "debug";
process.env.JWT_SECRET = "e2e-test-secret-do-not-use-in-production";
process.env.GATEWAY_SECRETS_KEY = "dGVzdC1zZWNyZXQta2V5LWZvci1lMmUtdGVzdA==";
process.env.STORE_URL = "http://localhost:3000";
process.env.ADMIN_URL = "http://localhost:3001";
process.env.COOKIE_SAMESITE = "lax";

// Dynamic import DEPOIS de configurar env
async function main(): Promise<void> {
  console.log("[E2E] Creating server...");
  const { createServer } = await import("../index.js");
  const { config } = await import("./config.js");
  console.log("[E2E] Server created, listening...");

  const app = await createServer();
  console.log("[E2E] Server created, listening...");

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "encerrando");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log("[E2E] Config:", { API_HOST: config.API_HOST, API_PORT: config.API_PORT, NODE_ENV: config.NODE_ENV });
  try {
    await app.listen({ port: config.API_PORT, host: config.API_HOST });
    console.log(`[E2E] Airsoft Americana API (E2E) em http://${config.API_HOST}:${config.API_PORT}`);
    console.log("[E2E] Server is running, waiting for connections...");
    console.log("[E2E] Server address:", app.server?.address());
    
    // Error handler for server
    app.server?.on('error', (err: Error) => {
      console.error("[E2E] Server error:", err);
    });
    
    // Keep alive logging
    setInterval(() => {
      console.log("[E2E] Heartbeat:", new Date().toISOString());
    }, 5000);
  } catch (err) {
    console.error("[E2E] Listen error:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Falha ao subir a API E2E:", err);
  process.exit(1);
});