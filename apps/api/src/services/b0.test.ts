// language: TS, file: apps/api/src/services/b0.test.ts, target: Vitest 5
/**
 * B0 — testes das correções críticas pequenas.
 * Cada describe cobre um item do prompt da Fase B0.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assertProductionEnv, DefaultJwtSecret } from "../config.js";
import {
  CredentialDecryptionError,
  decryptCredentials as decryptGatewayCredentialsRaw,
  decryptSecret,
  encryptSecret,
} from "../lib/crypto.js";
import { calculateShipping } from "./shipping.js";
import { decodeCursor, type AuditListQuery } from "../lib/audit.js";

// ----------------------------------------------------------------- Item 1: config produção
describe("B0.1 — config recusa subir em produção com configuração incompleta", () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    JWT_SECRET: "a".repeat(48),
    GATEWAY_SECRETS_KEY: Buffer.from("x".repeat(32)).toString("base64"),
    DATABASE_URL: "postgres://user:pass@db.internal:5432/airsoft",
    STORE_URL: "https://www.airsoftamericana.com.br",
    ADMIN_URL: "https://painel.airsoftamericana.com.br",
  };

  it("aceita configuração de produção completa", () => {
    expect(assertProductionEnv(base)).toEqual([]);
  });

  it("recusa JWT_SECRET ausente", () => {
    const problems = assertProductionEnv({ ...base, JWT_SECRET: "" });
    expect(problems.some((p) => p.variable === "JWT_SECRET")).toBe(true);
  });

  it("recusa JWT_SECRET igual ao padrão de dev", () => {
    const problems = assertProductionEnv({ ...base, JWT_SECRET: DefaultJwtSecret });
    expect(problems.some((p) => p.variable === "JWT_SECRET" && p.message.includes("padrão"))).toBe(true);
  });

  it("recusa GATEWAY_SECRETS_KEY ausente", () => {
    const problems = assertProductionEnv({ ...base, GATEWAY_SECRETS_KEY: "" });
    expect(problems.some((p) => p.variable === "GATEWAY_SECRETS_KEY")).toBe(true);
  });

  it("recusa STORE_URL localhost em produção", () => {
    const problems = assertProductionEnv({ ...base, STORE_URL: "http://localhost:3000" });
    expect(problems.some((p) => p.variable === "STORE_URL")).toBe(true);
  });

  it("recusa ADMIN_URL localhost em produção", () => {
    const problems = assertProductionEnv({ ...base, ADMIN_URL: "http://localhost:3001" });
    expect(problems.some((p) => p.variable === "ADMIN_URL")).toBe(true);
  });

  it("acumula todos os problemas (não falha no primeiro)", () => {
    const problems = assertProductionEnv({
      NODE_ENV: "production",
      JWT_SECRET: "",
      GATEWAY_SECRETS_KEY: "",
      STORE_URL: "http://localhost:3000",
      ADMIN_URL: "http://localhost:3001",
    });
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });
});

// ----------------------------------------------------------------- Item 2: decrypt não engole
describe("B0.2 — decryptCredentials/decryptSecret não engolem erro", () => {
  it("decryptSecret lança CredentialDecryptionError em payload malformado", () => {
    expect(() => decryptSecret("nao-tem-tres-partes")).toThrow(CredentialDecryptionError);
  });

  it("decryptSecret lança CredentialDecryptionError com chave/tag errada", () => {
    const ok = encryptSecret(JSON.stringify({ token: "x" }));
    const [iv, data] = ok.split(".");
    const tampered = `${iv}.${data}.dGFnZW52YWxpZG8`; // tag inválida
    try {
      decryptSecret(tampered);
      throw new Error("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialDecryptionError);
      expect((error as CredentialDecryptionError).code).toBe("gateway_unavailable");
      expect((error as CredentialDecryptionError).status).toBe(503);
    }
  });

  it("nunca devolve objeto vazio silencioso — erro tipado sempre", () => {
    let threw = false;
    try {
      decryptSecret("###");
    } catch (e) {
      threw = e instanceof CredentialDecryptionError;
    }
    expect(threw).toBe(true);
  });
});

// ----------------------------------------------------------------- Item 4: audit cursor helper (puro)
describe("B0.4 — listAudit cursor", () => {
  it("decodeCursor ignora cursor inválido (volta à primeira página)", () => {
    expect(decodeCursor("%%%lixo%%%")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("decodeCursor rejeita payload sem separador/id/data válida", () => {
    const noSep = Buffer.from("semseparador", "utf8").toString("base64url");
    expect(decodeCursor(noSep)).toBeNull();
    const badDate = Buffer.from("nao-e-data|abc", "utf8").toString("base64url");
    expect(decodeCursor(badDate)).toBeNull();
  });

  it("decodeCursor decodifica cursor bem formado", () => {
    const iso = "2026-11-07T12:00:00.000Z";
    const cur = Buffer.from(`${iso}|id-123`, "utf8").toString("base64url");
    const decoded = decodeCursor(cur);
    expect(decoded?.id).toBe("id-123");
    expect(decoded?.createdAt.toISOString()).toBe(iso);
  });
});

// ----------------------------------------------------------------- Item 5: frete grátis — fonte única (banco/settings), threshold explícito
describe("B0.5 — frete grátis: uma fonte, passada explicitamente", () => {
  it("calculateShipping cobra frete quando freeShippingFromCents é 0 (sem regra)", () => {
    const [pac] = calculateShipping({ zip: "13000000", subtotalCents: 50000, totalWeightGrams: 500, freeShippingFromCents: 0 });
    expect(pac?.priceCents).toBeGreaterThan(0);
    expect(pac?.free).toBe(false);
  });

  it("calculateShipping zera frete quando subtotal >= limite do banco", () => {
    const [pac, sedex] = calculateShipping({
      zip: "13000000",
      subtotalCents: 80000,
      totalWeightGrams: 500,
      freeShippingFromCents: 79900,
    });
    expect(pac?.priceCents).toBe(0);
    expect(pac?.free).toBe(true);
    expect(sedex?.priceCents).toBe(0);
  });

  it("calculateShipping cobra quando subtotal < limite", () => {
    const [pac] = calculateShipping({
      zip: "13000000",
      subtotalCents: 79800,
      totalWeightGrams: 500,
      freeShippingFromCents: 79900,
    });
    expect(pac?.priceCents).toBeGreaterThan(0);
  });

  it("a assinatura exige freeShippingFromCents — PAC/SEDEX seguem o limite passado", () => {
    // Motoboy/Local é sempre grátis por desenho; PAC/SEDEX obedecem ao threshold.
    const opts = calculateShipping({ zip: "01001000", subtotalCents: 1000, totalWeightGrams: 1000, freeShippingFromCents: 999999 });
    const correios = opts.filter((o) => o.carrier === "Correios");
    expect(correios.length).toBeGreaterThan(0);
    expect(correios.every((o) => !o.free)).toBe(true);
  });
});

// ----------------------------------------------------------------- Item 3: admin-login — sessão só por cookie, sem token no corpo
describe("B0.3 — admin-login não expõe token no corpo da resposta", () => {
  it("o handler de /api/auth/admin-login responde sem campo token", () => {
    const routesPath = path.resolve(__dirname, "../routes/index.ts");
    const src = fs.readFileSync(routesPath, "utf8");
    const marker = '"/api/auth/admin-login"';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1800);
    expect(block).toContain("setCookie(\"aa_session\"");
    expect(block).toContain("httpOnly: true");
    // A resposta de sucesso entrega só { user } — sem token no corpo.
    expect(block).toContain("reply.send({ user: { id: user.id, name: user.name, email: user.email, role: user.role } })");
    expect(block).not.toMatch(/reply\.send\(\{[^}]*\btoken\b/);
  });
});
