// language: TS, file: apps/api/src/lib/rbac.ts, target: Fastify 5
import type { FastifyRequest } from "fastify";
import { forbidden, unauthorized } from "./errors.js";

/** Papéis do painel (§1.3 / B.6). Ordem não implica hierarquia automática. */
export const ROLES = [
  "superadmin",
  "gerente",
  "estoque",
  "atendimento",
  "marketing",
  "financeiro",
  "somente-leitura",
] as const;
export type Role = (typeof ROLES)[number];

/** Mapeamento de papéis legados (schema antigo) → novos. */
const LEGACY_ROLE: Record<string, Role> = {
  admin: "superadmin",
  manager: "gerente",
  operator: "atendimento",
  viewer: "somente-leitura",
  // novos passam direto
  superadmin: "superadmin",
  gerente: "gerente",
  estoque: "estoque",
  atendimento: "atendimento",
  marketing: "marketing",
  financeiro: "financeiro",
  "somente-leitura": "somente-leitura",
};

export function normalizeRole(raw: string | undefined | null): Role | null {
  if (!raw) return null;
  return LEGACY_ROLE[raw] ?? null;
}

export type Action = "read" | "create" | "update" | "delete";
export type Module =
  | "dashboard"
  | "products"
  | "categories"
  | "brands"
  | "inventory"
  | "orders"
  | "payments"
  | "chargebacks"
  | "fraud"
  | "promotions"
  | "coupons"
  | "banners"
  | "homepage"
  | "menu"
  | "shipping"
  | "customers"
  | "content"
  | "reports"
  | "users"
  | "audit"
  | "settings";

const ALL: Action[] = ["read", "create", "update", "delete"];
const READ: Action[] = ["read"];
const RW: Action[] = ["read", "create", "update"];
const RW_NO_DELETE: Action[] = ["read", "create", "update"];

/**
 * Matriz papel × módulo × ações permitidas. ÚNICA fonte de verdade.
 * `superadmin` tem tudo — tratado no can() para não repetir.
 */
const MATRIX: Record<Exclude<Role, "superadmin">, Partial<Record<Module, Action[]>>> = {
  gerente: {
    dashboard: READ, products: ALL, categories: ALL, brands: ALL, inventory: ALL,
    orders: ALL, payments: ["read", "update"], chargebacks: ALL, fraud: ALL,
    promotions: ALL, coupons: ALL, banners: ALL, homepage: ALL, menu: ALL,
    shipping: ALL, customers: ALL, content: ALL, reports: READ, users: ["read", "create", "update"],
    audit: READ, settings: ["read", "update"],
  },
  estoque: {
    dashboard: READ, products: ["read", "update"], categories: READ, brands: READ,
    inventory: ALL, orders: ["read", "update"], reports: READ,
  },
  atendimento: {
    dashboard: READ, products: READ, categories: READ, brands: READ,
    inventory: READ, orders: ["read", "update"], payments: READ, chargebacks: ["read", "update"],
    fraud: READ, customers: ALL, content: READ, reports: READ,
  },
  marketing: {
    dashboard: READ, products: ["read", "update"], categories: ["read", "update"], brands: ["read", "update"],
    promotions: ALL, coupons: ALL, banners: ALL, homepage: ALL, menu: ALL, content: ALL, reports: READ,
  },
  financeiro: {
    dashboard: READ, orders: READ, payments: ["read", "update"], chargebacks: ALL,
    fraud: ["read", "update"], reports: READ, audit: READ,
  },
  "somente-leitura": {
    dashboard: READ, products: READ, categories: READ, brands: READ, inventory: READ,
    orders: READ, payments: READ, chargebacks: READ, fraud: READ, promotions: READ,
    coupons: READ, banners: READ, homepage: READ, menu: READ, shipping: READ,
    customers: READ, content: READ, reports: READ, users: READ, audit: READ, settings: READ,
  },
};

export function can(role: Role | null, module: Module, action: Action): boolean {
  if (!role) return false;
  if (role === "superadmin") return true;
  const allowed = MATRIX[role]?.[module];
  return !!allowed?.includes(action);
}

/** Guard declarativo por rota. Usa (request as any).user.role normalizado. */
export function requirePermission(module: Module, action: Action) {
  // Marcador para o teste "rota sem guard" inspecionar.
  (requirePermission as any)._guard = true;
  const handler = async (request: FastifyRequest) => {
    const user = (request as any).user as { role?: string } | undefined;
    if (!user) throw unauthorized();
    const role = normalizeRole(user.role);
    if (!can(role, module, action)) throw forbidden("Sem permissão para esta ação");
  };
  (handler as any).__rbac = { module, action };
  return handler;
}

/** Combina auth + permissão. */
export function adminGuard(module: Module, action: Action) {
  const perm = requirePermission(module, action);
  const handler = async (request: FastifyRequest) => {
    // authMiddleware já roda globalmente em /api/admin via registerAuth hook;
    // mas rotas podem declarar preHandler explícito — garantimos o user.
    const user = (request as any).user;
    if (!user) throw unauthorized();
    await perm(request);
  };
  (handler as any).__rbac = { module, action };
  return handler;
}
