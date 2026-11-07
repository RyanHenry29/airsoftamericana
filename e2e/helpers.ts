import { createHmac } from "node:crypto";
import * as OTPAuth from "otpauth";
import { request as pwRequest, type APIRequestContext } from "@playwright/test";

export const API = process.env.E2E_API_URL || "http://localhost:4000";
export const ADMIN = process.env.E2E_ADMIN_URL || "http://localhost:3001";

export function totpFromSecretBase32(secretBase32: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "Airsoft Americana",
    label: "e2e",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.generate();
}

export function secretFromOtpauth(otpauthUrl: string): string {
  return new URL(otpauthUrl).searchParams.get("secret") ?? "";
}

export async function apiContext(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { "content-type": "application/json" } });
}
