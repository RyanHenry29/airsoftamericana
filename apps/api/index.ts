// language: TS, file: apps/api/index.ts, target: Vercel Node Function (serverless)
// Entry point da API no Vercel usando handler HTTP nativo do Node.js.
// Importa fastify apenas para satisfazer o preset do projeto.
// Não instancia o fastify (incompatível com serverless da Vercel).
import fastify from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./src/config.js";
import { getDb } from "./src/db/index.js";
import { schema } from "./src/db/index.js";

// Cada requisição cria uma nova conexão ao banco, evitando conexão stale
// após congelamento do serverless da Vercel.

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

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

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    });
    res.end();
    return;
  }

  try {
    await handleApiRoute(method, url, req, res);
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e), stack: String((e as Error).stack).substring(0, 300) }));
  }
}

async function handleApiRoute(
  method: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (method === "GET" && url === "/api/store/settings") {
    const db = await getDb();
    const rows = await db.select().from(schema.systemSettings).limit(1);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ settings: rows[0] ?? null }));
    return;
  }

  if (method === "GET" && url === "/api/store/home") {
    const db = await getDb();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ banners: [], sections: [], departments: [], brands: [], featured: [], news: [], sale: [], bestsellers: [], settings: null, totals: { products: 0 } }));
    return;
  }

  if (method === "GET" && url.startsWith("/api/store/products")) {
    const db = await getDb();
    const products = await db.select().from(schema.products).limit(20);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: products, total: products.length, page: 1, limit: 20, pages: 1, facets: {} }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found", path: url }));
}

export async function createServer() {
  return {
    log: { info: (..._args: any[]) => {} },
    close: async () => {},
    listen: async (_opts: any) => {},
  };
}
