// language: TS, file: apps/api/index.ts, target: Vercel Node Function (serverless)
// Diagnóstico: Fastify com app.inject() para processar o request.
import fastify from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url ?? "/";

  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
    return;
  }

  if (url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ name: "Airsoft Americana API", version: "0.1.0" }));
    return;
  }

  if (url === "/__injecttest") {
    try {
      const app = fastify({ logger: { level: "silent" } });
      app.get("/ping", async () => ({ pong: true }));
      await app.ready();
      const result = await app.inject({
        method: "GET",
        url: "/ping",
        headers: {},
      });
      res.writeHead(result.statusCode, { "content-type": "application/json" });
      res.end(result.payload);
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ name: "Airsoft Americana API", version: "0.1.0", path: url }));
}

export async function createServer() {
  const app = fastify({ logger: { level: "silent" } });
  await app.ready();
  return app;
}
