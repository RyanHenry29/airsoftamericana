// language: TS, file: apps/api/api/index.ts, target: Vercel Node Function (serverless)
/**
 * Entry point serverless da API Fastify no Vercel.
 *
 * Um único handler atende todas as rotas: vercel.json reescreve /(.*) para
 * /api/index e o Fastify (factory de src/server.ts) processa a requisição.
 * O servidor é criado uma vez por instância fria (migrações/seed NÃO rodam
 * aqui em produção — ver createServer: DDL pertence ao db:bootstrap).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "../src/server.js";

const appPromise = createServer();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await appPromise;
  await app.ready();
  app.server.emit("request", req, res);
}
