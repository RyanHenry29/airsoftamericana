#!/usr/bin/env node
// language: TS, file: apps/api/src/cli/admin-reset-mfa.ts, target: Node CLI
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getDb, closeDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { config } from "../config.js";
import { resetMfaForEmail } from "../services/admin-reset-mfa.js";

async function typedConfirm(email: string): Promise<boolean> {
  if (!input.isTTY || !output.isTTY) {
    console.error("Confirmação digitada obrigatória: execute este comando em um terminal interativo.");
    return false;
  }
  const rl = createInterface({ input, output });
  try {
    const expected = `RESET MFA ${email}`;
    console.log("Operação sensível: reset emergencial de MFA.");
    console.log(`Digite exatamente para confirmar: ${expected}`);
    const answer = (await rl.question("> ")).trim();
    return answer === expected;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const email = String(process.argv[2] ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("Uso: npm run admin:reset-mfa -- <email>");
    process.exit(2);
  }

  if (config.NODE_ENV === "production") {
    // Em produção, execução somente em servidor autorizado (operador com acesso ao host).
    // Confirmação digitada continua obrigatória; nenhuma flag silenciosa é aceita.
    console.log("Ambiente: production (execução autorizada no servidor).");
  } else {
    console.log(`Ambiente: ${config.NODE_ENV} (execução local).`);
  }

  const ok = await typedConfirm(email);
  if (!ok) {
    console.error("Confirmação inválida. Nenhuma alteração realizada.");
    process.exit(1);
  }

  const db = await getDb();
  try {
    await migrate(db);
    const result = await resetMfaForEmail(db, email, "cli:admin-reset-mfa");
    console.log(`MFA removido para a conta informada. Sessões invalidadas: ${result.sessionsRevoked}.`);
    console.log("No próximo login será exigida nova configuração de MFA.");
  } catch (e: any) {
    const msg = e?.code === "not_found" ? "Usuário não encontrado." : "Falha ao executar o reset de MFA.";
    console.error(msg);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error("Falha ao executar o reset de MFA.");
  process.exit(1);
});
