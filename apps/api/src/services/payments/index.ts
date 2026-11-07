import { registerAdapter } from "./types.js";
import { SandboxAdapter } from "./sandbox.js";
import { MercadoPagoAdapter } from "./mercadopago.js";
import { PagBankAdapter } from "./pagbank.js";
import { CieloAdapter } from "./cielo.js";
import { config } from "../../config.js";
import { decryptCredentials, loadGatewayConfig } from "./types.js";
import type { Db } from "../../db/index.js";

export async function initAdapters(db: Db): Promise<void> {
  registerAdapter(new SandboxAdapter());

  const mpRow = await loadGatewayConfig(db, "mercadopago");
  if (mpRow && mpRow.enabled) {
    const creds = decryptCredentials(mpRow);
    const token = creds.accessToken ?? creds.MERCADOPAGO_ACCESS_TOKEN;
    if (token) registerAdapter(new MercadoPagoAdapter(token));
  } else if (config.MERCADOPAGO_ACCESS_TOKEN) {
    registerAdapter(new MercadoPagoAdapter(config.MERCADOPAGO_ACCESS_TOKEN));
  }

  const pgRow = await loadGatewayConfig(db, "pagbank");
  if (pgRow && pgRow.enabled) {
    const creds = decryptCredentials(pgRow);
    const key = creds.apiKey ?? creds.PAGBANK_API_KEY;
    if (key) registerAdapter(new PagBankAdapter(key));
  } else if (config.PAGBANK_API_KEY) {
    registerAdapter(new PagBankAdapter(config.PAGBANK_API_KEY));
  }

  const clRow = await loadGatewayConfig(db, "cielo");
  if (clRow && clRow.enabled) {
    const creds = decryptCredentials(clRow);
    if (creds.merchantId && creds.merchantKey) {
      registerAdapter(new CieloAdapter(creds.merchantId, creds.merchantKey));
    }
  } else if (config.CIELO_CLIENT_ID && config.CIELO_CLIENT_SECRET) {
    registerAdapter(new CieloAdapter(config.CIELO_CLIENT_ID, config.CIELO_CLIENT_SECRET));
  }
}