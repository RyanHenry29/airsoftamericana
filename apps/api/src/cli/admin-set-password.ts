#!/usr/bin/env node
// language: TS, file: apps/api/src/cli/admin-set-password.ts, target: Node CLI
//
// Definição emergencial de senha de operador (produção).
// Uso:
//   npm run admin:set-password -- <email> <senha> [--reset-mfa]
// Fora de terminal interativo exige a frase:
//   --confirm "SET PASSWORD <email>"
// Alternativa por variável (para `vercel env run`, que engole flags do filho):
//   SET_PASSWORD_CONFIRM / SET_PASSWORD_RESET_MFA=1
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import "./env-guards.js";
import { getDb, closeDb } from "../db/index.js";
import { config } from "../config.js";
import { setAdminPassword } from "../services/admin-set-password.js";

async function typedConfirm(email: string, phraseArg: string | null): Promise<boolean> {
  const expected = `SET PASSWORD ${email}`;
  if (phraseArg !== null) {
    // caminho não interativo (CI/pipe): a frase completa ainda é obrigatória
    if (phraseArg === expected) return true;
    console.error(`Confirmação inválida. Esperado: ${expected}`);
    return false;
  }
  if (!input.isTTY || !output.isTTY) {
    console.error("Terminal não interativo: use --confirm \"SET PASSWORD <email>\".");
    return false;
  }
  const rl = createInterface({ input, output });
  try {
    console.log("Operação sensível: troca de senha de operador + revogação de sessões.");
    console.log(`Digite exatamente para confirmar: ${expected}`);
    const answer = (await rl.question("> ")).trim();
    return answer === expected;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = String(args[0] ?? "").trim().toLowerCase();
  const password = String(args[1] ?? "");
  const resetMfa = args.includes("--reset-mfa") || process.env.SET_PASSWORD_RESET_MFA === "1";
  const confirmIdx = args.indexOf("--confirm");
  const phraseArg =
    confirmIdx >= 0
      ? String(args[confirmIdx + 1] ?? "")
      : process.env.SET_PASSWORD_CONFIRM ?? null;

  if (!email || !email.includes("@") || !password) {
    console.error('Uso: npm run admin:set-password -- <email> <senha> [--reset-mfa] [--confirm "SET PASSWORD <email>"]');
    process.exit(2);
  }
  if (password.length < 8) {
    console.error("A senha precisa de pelo menos 8 caracteres.");
    process.exit(2);
  }

  console.log(
    config.NODE_ENV === "production"
      ? "Ambiente: production (execução autorizada no servidor)."
      : `Ambiente: ${config.NODE_ENV} (execução local).`,
  );

  const ok = await typedConfirm(email, phraseArg);
  if (!ok) {
    console.error("Confirmação inválida. Nenhuma alteração realizada.");
    process.exit(1);
  }

  const db = await getDb();
  try {
    // Sem migrate(): produção roda com papel sem DDL e o schema já está lá —
    // o CLI só toca DML (users, sessions, auth_lockouts, audit_logs).
    const r = await setAdminPassword(db, email, password, {
      resetMfa,
      actorLabel: "cli:admin-set-password",
    });
    console.log(`Senha atualizada para ${r.email}.`);
    console.log(`Sessões revogadas: ${r.sessionsRevoked}. Lockouts limpos: ${r.lockoutsCleared}.`);
    console.log(
      r.mfaReset
        ? "MFA resetado: o próximo login pede nova configuração do segundo fator."
        : "MFA mantido: se houver segundo fator ativo, o login continuará pedindo o código.",
    );
  } catch (e: any) {
    const msg =
      e?.code === "not_found"
        ? "Usuário não encontrado."
        : e?.code === "invalid_input"
          ? String(e?.message ?? "Entrada inválida.")
          : `Falha ao definir a senha: ${e?.message ?? e}`;
    console.error(msg);
    if (process.env.DEBUG && e?.stack) console.error(e.stack);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main().catch(() => {
  console.error("Falha ao executar a definição de senha.");
  process.exit(1);
});
