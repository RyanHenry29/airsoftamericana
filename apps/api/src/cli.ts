import { createServer } from "./server.js";
import { config } from "./config.js";

/**
 * Entry point HTTP. `server.ts` exporta a factory (usada pelos testes com
 * app.inject); este arquivo é quem efetivamente abre a porta.
 */
async function main(): Promise<void> {
  const app = await createServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "encerrando");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info(`Airsoft Americana API em http://${config.API_HOST}:${config.API_PORT}`);
}

main().catch((err) => {
  console.error("Falha ao subir a API:", err);
  process.exit(1);
});
