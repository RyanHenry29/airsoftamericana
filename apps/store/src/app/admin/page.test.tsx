import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEnv = (env: Record<string, string | undefined>) => {
  vi.stubGlobal("process", { ...process, env: { ...process.env, ...env } });
};

const resetEnv = () => {
  vi.unstubAllGlobals();
};

describe("Admin redirect logic", () => {
  beforeEach(() => {
    resetEnv();
  });

  it("Development sem variáveis → localhost:3001", async () => {
    mockEnv({ NODE_ENV: "development" });
    const { getAdminUrl } = await import("./page");
    expect(getAdminUrl()).toBe("http://localhost:3001");
  });

  it("Development com NODE_ENV=development e VERCEL_ENV=development → localhost:3001", async () => {
    mockEnv({ NODE_ENV: "development", VERCEL_ENV: "development" });
    const { getAdminUrl } = await import("./page");
    expect(getAdminUrl()).toBe("http://localhost:3001");
  });

  it("Preview com URL de Preview válida → Preview Admin", async () => {
    mockEnv({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_ADMIN_URL_PREVIEW: "https://airsoftamericana-admin-preview.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(getAdminUrl()).toBe("https://airsoftamericana-admin-preview.vercel.app");
  });

  it("Preview com URL de produção na variável de Preview → REJEITA (hostname mismatch)", async () => {
    mockEnv({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_ADMIN_URL_PREVIEW: "https://airsoftamericana-admin-henna.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Preview URL hostname mismatch");
  });

  it("Preview com variável de produção preenchida indevidamente → USA apenas variável de preview", async () => {
    mockEnv({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_ADMIN_URL: "https://airsoftamericana-admin-henna.vercel.app",
      NEXT_PUBLIC_ADMIN_URL_PREVIEW: "https://airsoftamericana-admin-preview.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(getAdminUrl()).toBe("https://airsoftamericana-admin-preview.vercel.app");
  });

  it("Preview sem variável → ERRO explícito", async () => {
    mockEnv({ VERCEL_ENV: "preview" });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Preview requer NEXT_PUBLIC_ADMIN_URL_PREVIEW configurada");
  });

  it("Production com URL de produção válida → Production Admin", async () => {
    mockEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ADMIN_URL: "https://airsoftamericana-admin-henna.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(getAdminUrl()).toBe("https://airsoftamericana-admin-henna.vercel.app");
  });

  it("Production com URL de Preview → REJEITA (hostname mismatch)", async () => {
    mockEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ADMIN_URL: "https://airsoftamericana-admin-preview.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Production URL hostname mismatch");
  });

  it("Production sem variável → ERRO explícito", async () => {
    mockEnv({ VERCEL_ENV: "production" });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Produção requer NEXT_PUBLIC_ADMIN_URL configurada");
  });

  it("URL com credenciais → REJEITA", async () => {
    mockEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ADMIN_URL: "https://user:pass@airsoftamericana-admin-henna.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("credentials");
  });

  it("URL com query string → REJEITA", async () => {
    mockEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ADMIN_URL: "https://airsoftamericana-admin-henna.vercel.app?foo=bar",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("query string");
  });

  it("URL com fragmento → REJEITA", async () => {
    mockEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ADMIN_URL: "https://airsoftamericana-admin-henna.vercel.app#section",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("fragment");
  });

  it("Protocolo HTTP em produção → REJEITA", async () => {
    mockEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ADMIN_URL: "http://airsoftamericana-admin-henna.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Production requires HTTPS");
  });

  it("Protocolo HTTP em preview → REJEITA", async () => {
    mockEnv({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_ADMIN_URL_PREVIEW: "http://airsoftamericana-admin-preview.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Preview requires HTTPS");
  });

  it("Protocolo HTTPS em development → USA localhost (ignora variável)", async () => {
    mockEnv({
      NODE_ENV: "development",
      NEXT_PUBLIC_ADMIN_URL: "https://airsoftamericana-admin-henna.vercel.app",
    });
    const { getAdminUrl } = await import("./page");
    expect(getAdminUrl()).toBe("http://localhost:3001");
  });

  it("Hostname não permitido em preview → REJEITA", async () => {
    mockEnv({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_ADMIN_URL_PREVIEW: "https://malicious.example.com",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Preview URL hostname mismatch");
  });

  it("Hostname não permitido em production → REJEITA", async () => {
    mockEnv({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ADMIN_URL: "https://malicious.example.com",
    });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Production URL hostname mismatch");
  });

  it("Ambiente desconhecido → ERRO explícito", async () => {
    mockEnv({ NODE_ENV: "test" });
    const { getAdminUrl } = await import("./page");
    expect(() => getAdminUrl()).toThrow("Ambiente não reconhecido");
  });
});