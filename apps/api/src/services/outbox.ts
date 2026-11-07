// language: TS, file: apps/api/src/services/outbox.ts, target: Fastify 5
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export type NotifSeverity = "info" | "warning" | "critical";

export async function outboxNotify(
  tx: any,
  input: { kind: string; title: string; body?: string; severity?: NotifSeverity },
): Promise<void> {
  await tx.insert(schema.notifications).values({
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    severity: input.severity ?? "info",
  });
}

// helpers para os eventos exigidos em B.7
export function loginNewDeviceBody(meta: { email: string; ip?: string | null; userAgent?: string | null }) {
  return { kind: "security.login_new_device", title: "Login em dispositivo novo", severity: "warning" as const, body: `Usuário ${meta.email} autenticado de IP ${meta.ip ?? "?"} (${(meta.userAgent ?? "").slice(0, 120)})` };
}
export function roleChangedBody(meta: { targetEmail: string; from: string; to: string; by: string }) {
  return { kind: "security.role_changed", title: "Papel de usuário alterado", severity: "warning" as const, body: `${meta.by} alterou ${meta.targetEmail}: ${meta.from} → ${meta.to}` };
}
export function bulkPriceBody(meta: { count: number; by: string; mode: string }) {
  return { kind: "catalog.bulk_price_change", title: "Alteração de preço em massa", severity: "warning" as const, body: `${meta.by} alterou preços em massa (${meta.count} itens, ${meta.mode})` };
}
