// Entry point HTTP. server.ts exporta a factory (usada pelos testes com
// app.inject); este arquivo é quem efetivamente abre a porta.
import { createServer } from "../index.js";
import { config } from "./config.js";
import { closeDb } from "./db/index.js";

async function main(): Promise<void> {
  const app = await createServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "encerrando");
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Also handle uncaught exceptions to ensure cleanup
  process.on("uncaughtException", async (err) => {
    console.error("Uncaught exception:", err);
    try {
      await closeDb();
    } catch {
      // ignore
    }
    process.exit(1);
  });

  process.on("unhandledRejection", async (reason) => {
    console.error("Unhandled rejection:", reason);
    try {
      await closeDb();
    } catch {
      // ignore
    }
    process.exit(1);
  });

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  const url = "http://" + config.API_HOST + ":" + config.API_PORT;
  app.log.info("Airsoft Americana API em " + url);
}

main().catch((err) => {
  console.error("Falha ao subir a API:", err);
  process.exit(1);
});