// language: TS, file: apps/api/src/lib/rbac.ts tests
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { can, normalizeRole, ROLES, type Module, type Action, type Role } from "./rbac.js";

describe("B.6 — RBAC matriz papel×módulo×ação", () => {
  it("normaliza papéis legados", () => {
    expect(normalizeRole("admin")).toBe("superadmin");
    expect(normalizeRole("manager")).toBe("gerente");
    expect(normalizeRole("operator")).toBe("atendimento");
    expect(normalizeRole("viewer")).toBe("somente-leitura");
    expect(normalizeRole("superadmin")).toBe("superadmin");
    expect(normalizeRole("bogus")).toBeNull();
  });

  it("superadmin pode tudo", () => {
    const modules: Module[] = ["products","orders","users","settings","audit","payments","fraud"];
    for (const m of modules) for (const a of ["read","create","update","delete"] as Action[]) {
      expect(can("superadmin", m, a)).toBe(true);
    }
  });

  it("somente-leitura nunca escreve", () => {
    const modules: Module[] = ["products","orders","users","settings","inventory","customers"];
    for (const m of modules) for (const a of ["create","update","delete"] as Action[]) {
      expect(can("somente-leitura", m, a)).toBe(false);
    }
  });

  it("somente-leitura lê módulos expostos", () => {
    expect(can("somente-leitura", "products", "read")).toBe(true);
    expect(can("somente-leitura", "orders", "read")).toBe(true);
    expect(can("somente-leitura", "audit", "read")).toBe(true);
  });

  it("estoque gerencia estoque mas não mexe em usuários/settings/financeiro", () => {
    expect(can("estoque", "inventory", "update")).toBe(true);
    expect(can("estoque", "inventory", "delete")).toBe(true);
    expect(can("estoque", "products", "update")).toBe(true);
    expect(can("estoque", "users", "read")).toBe(false);
    expect(can("estoque", "settings", "read")).toBe(false);
    expect(can("estoque", "payments", "read")).toBe(false);
  });

  it("financeiro vê/atua em pagamentos e chargebacks, não em catálogo", () => {
    expect(can("financeiro", "payments", "read")).toBe(true);
    expect(can("financeiro", "payments", "update")).toBe(true);
    expect(can("financeiro", "chargebacks", "delete")).toBe(true);
    expect(can("financeiro", "products", "create")).toBe(false);
    expect(can("financeiro", "banners", "read")).toBe(false);
  });

  it("marketing gerencia vitrine, não pedidos/estoque/usuários", () => {
    expect(can("marketing", "banners", "create")).toBe(true);
    expect(can("marketing", "promotions", "delete")).toBe(true);
    expect(can("marketing", "homepage", "update")).toBe(true);
    expect(can("marketing", "orders", "update")).toBe(false);
    expect(can("marketing", "inventory", "read")).toBe(false);
    expect(can("marketing", "users", "read")).toBe(false);
  });

  it("atendimento atende clientes/pedidos, não apaga catálogo nem mexe em settings", () => {
    expect(can("atendimento", "customers", "update")).toBe(true);
    expect(can("atendimento", "orders", "update")).toBe(true);
    expect(can("atendimento", "products", "delete")).toBe(false);
    expect(can("atendimento", "settings", "update")).toBe(false);
  });

  it("nega papel nulo/desconhecido", () => {
    expect(can(null, "products", "read")).toBe(false);
    expect(can(normalizeRole("hacker"), "products", "read")).toBe(false);
  });

  it("declara os 7 papéis", () => {
    expect(ROLES).toEqual(["superadmin","gerente","estoque","atendimento","marketing","financeiro","somente-leitura"]);
  });
});

describe("B.6 — toda rota /api/admin declara guard (rota sem guard falha)", () => {
  const routeFiles = [
    path.resolve(__dirname, "../routes/admin.ts"),
    path.resolve(__dirname, "../routes/admin-ai.ts"),
    path.resolve(__dirname, "../routes/index.ts"),
    path.resolve(__dirname, "../routes/blog.ts"),
  ];
  it("nenhuma declaração de rota /api/admin fica sem adminGuard", () => {
    const offenders: string[] = [];
    for (const file of routeFiles) {
      const src = fs.readFileSync(file, "utf8");
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!/app\.(get|post|put|patch|delete)\(\s*["'`]\/api\/admin/.test(line)) continue;
        // A mesma linha ou as próximas 2 devem conter adminGuard ou um preHandler com rbac.
        const window = lines.slice(i, i + 3).join(" ");
        if (!window.includes("adminGuard")) offenders.push(`${path.basename(file)}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
