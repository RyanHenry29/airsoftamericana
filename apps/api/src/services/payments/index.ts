// language: TS, file: apps/api/src/services/payments/index.ts, target: Fastify 5
/**
 * Registro de adapters de pagamento.
 *
 * Um provider com credencial cifrada ilegível NÃO derruba o processo: a
 * falha é registrada na auditoria, o provider é marcado como indisponível e
 * os outros continuam funcionando. Quando o provider quebrado é o escolhido,
 * o checkout responde 503 "gateway indisponível" — nunca "não configurado".
 */
import { registerAdapter, markCredentialFailure, clearCredentialFailure, decryptCredentials, loadGatewayConfig } from "./types.js";
import { SandboxAdapter } from "./sandbox.js";
import { MercadoPagoAdapter } from "./mercadopago.js";
import { PagBankAdapter } from "./pagbank.js";
import { CieloAdapter } from "./cielo.js";
import { config } from "../../config.js";
import { audit } from "../../lib/audit.js";
import type { Db } from "../../db/index.js";

export async function initAdapters(db: Db): Promise<void> {
  registerAdapter(new SandboxAdapter());

  const mpRow = await loadGatewayConfig(db, "mercadopago");
  if (mpRow && mpRow.enabled) {
    try {
      const creds = decryptCredentials(mpRow);
      const token = creds.accessToken ?? creds.MERCADOPAGO_ACCESS_TOKEN;
      if (token) {
        registerAdapter(new MercadoPagoAdapter(token));
        clearCredentialFailure("mercadopago");
      }
    } catch (error) {
      await recordCredentialFailure(db, "mercadopago", error);
    }
  } else if (config.MERCADOPAGO_ACCESS_TOKEN) {
    registerAdapter(new MercadoPagoAdapter(config.MERCADOPAGO_ACCESS_TOKEN));
  }

  const pgRow = await loadGatewayConfig(db, "pagbank");
  if (pgRow && pgRow.enabled) {
    try {
      const creds = decryptCredentials(pgRow);
      const key = creds.apiKey ?? creds.PAGBANK_API_KEY;
      if (key) {
        registerAdapter(new PagBankAdapter(key));
        clearCredentialFailure("pagbank");
      }
    } catch (error) {
      await recordCredentialFailure(db, "pagbank", error);
    }
  } else if (config.PAGBANK_API_KEY) {
    registerAdapter(new PagBankAdapter(config.PAGBANK_API_KEY));
  }

  const clRow = await loadGatewayConfig(db, "cielo");
  if (clRow && clRow.enabled) {
    try {
      const creds = decryptCredentials(clRow);
      if (creds.merchantId && creds.merchantKey) {
        registerAdapter(new CieloAdapter(creds.merchantId, creds.merchantKey));
        clearCredentialFailure("cielo");
      }
    } catch (error) {
      await recordCredentialFailure(db, "cielo", error);
    }
  } else if (config.CIELO_CLIENT_ID && config.CIELO_CLIENT_SECRET) {
    registerAdapter(new CieloAdapter(config.CIELO_CLIENT_ID, config.CIELO_CLIENT_SECRET));
  }
}

/** Falha de decifragem: auditoria + marcador de indisponibilidade. */
async function recordCredentialFailure(db: Db, provider: string, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  markCredentialFailure(provider, reason);
  try {
    await audit(db, {
      action: "gateway.credentials.unavailable",
      entity: "gateway_configs",
      entityId: provider,
      actorLabel: "system",
      after: { provider, reason },
    });
  } catch {
    // A auditoria é best-effort: a indisponibilidade do gateway já está
    // sinalizada pelo marcador em memória.
  }
}
