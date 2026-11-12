// language: TypeScript, file: scripts/reset-diag-password.ts
// Reset local da senha de diag_audit: conecta como usuário da aplicação (.env.prod),
// faz SET ROLE diag_audit (membro desde a criação via admin) e troca a própria senha.
// A senha (32 bytes crypto) é gerada em processo e escrita APENAS em apps/api/.env.diag.
// sslmode removido da URL — TLS vem do objeto ssl com a CA raiz da Supabase.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tls from "node:tls";
import crypto from "node:crypto";
import { Client } from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvUrl(file: string): URL {
  const txt = readFileSync(path.join(ROOT, file), "utf8");
  const m = /DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/.exec(txt);
  if (!m) throw new Error(`DATABASE_URL ausente em ${file}`);
  return new URL(m[1].trim().replace(/^postgres(ql)?:\/\//, "postgresql://"));
}

async function main(): Promise<void> {
  const base = loadEnvUrl("apps/api/.env.prod");
  base.searchParams.delete("sslmode");

  const mod = (await import(
    pathToFileURL(path.join(ROOT, "apps/api/src/db/supabase-root-ca.ts")).href
  )) as { SUPABASE_ROOT_CA_PEM?: string };
  if (!mod.SUPABASE_ROOT_CA_PEM) throw new Error("CA raiz da Supabase indisponível");
  const ssl = { rejectUnauthorized: true, ca: [mod.SUPABASE_ROOT_CA_PEM, ...tls.rootCertificates] };

  const pw = crypto.randomBytes(32).toString("base64url");

  const client = new Client({ connectionString: base.toString(), ssl: ssl as never });
  await client.connect();
  const ctx = (await client.query("select current_user as u")).rows[0].u as string;

  // sessão do usuário da aplicação vem com default_transaction_read_only=on
  await client.query("set transaction_read_only = off");
  await client.query("set role diag_audit");
  const asDiag = (await client.query("select current_user as u")).rows[0].u as string;
  // ALTER ROLE do próprio papel — comando utilitário não aceita bind; senha é
  // base64url (apenas A-Za-z0-9_-), inline seguro
  await client.query(`alter role diag_audit password '${pw}'`);
  await client.query("reset role");
  await client.end();

  const diagUrl = new URL(base.toString());
  // pooler Supabase exige tenant no username: usuario.<project_ref>
  const tenant = base.username.includes(".") ? base.username.split(".").slice(1).join(".") : "";
  diagUrl.username = tenant ? `diag_audit.${tenant}` : "diag_audit";
  diagUrl.password = pw;
  // sem sslmode na URL — o diagnose valida a cadeia com a CA Supabase por si
  diagUrl.searchParams.delete("sslmode");
  writeFileSync(path.join(ROOT, "apps/api/.env.diag"), `DATABASE_URL=${diagUrl.toString()}\n`, "utf8");

  console.log(
    JSON.stringify({
      connected_as: ctx,
      role_set: asDiag,
      password_updated: true,
      env_written: "apps/api/.env.diag",
      password_printed: false,
    }),
  );
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
