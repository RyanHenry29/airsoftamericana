import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";

export async function listChargebacks(db: Db, status?: string) {
  const rows = status
    ? await db.select().from(schema.chargebacks).where(eq(schema.chargebacks.status, status as never)).orderBy(schema.chargebacks.notifiedAt)
    : await db.select().from(schema.chargebacks).orderBy(schema.chargebacks.notifiedAt);
  return rows;
}

export async function getChargebackWithEvidence(db: Db, id: string) {
  const cbRows = await db.select().from(schema.chargebacks).where(eq(schema.chargebacks.id, id));
  const cb = cbRows[0];
  if (!cb) throw notFound("Chargeback NÃO encontrado");
  const evidences = await db.select().from(schema.chargebackEvidence).where(eq(schema.chargebackEvidence.chargebackId, id));
  const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, cb.orderId));
  const order = orderRows[0];
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, cb.orderId));
  const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, cb.orderId)).orderBy(schema.orderStatusHistory.createdAt);
  const paymentRows = await db.select().from(schema.payments).where(eq(schema.payments.orderId, cb.orderId));
  const customer = order ? (await db.select().from(schema.customers).where(eq(schema.customers.id, order.customerId)))[0] : undefined;
  const assessmentRows = await db.select().from(schema.fraudAssessments).where(eq(schema.fraudAssessments.orderId, cb.orderId));
  const paymentEvents = paymentRows[0]
    ? await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.paymentId, paymentRows[0].id))
    : [];
  return { chargeback: cb, evidences, order, items, history, payments: paymentRows, customer, assessments: assessmentRows, paymentEvents };
}

export async function updateChargebackStatus(
  db: Db,
  input: { id: string; status: string; note?: string; actorUserId: string; actorLabel?: string; ip?: string },
) {
  const rows = await db.select().from(schema.chargebacks).where(eq(schema.chargebacks.id, input.id));
  const before = rows[0];
  if (!before) throw notFound("Chargeback NÃO encontrado");

  const resolved = ["ganho", "perdido", "encerrado"].includes(input.status) ? new Date() : null;
  await db
    .update(schema.chargebacks)
    .set({ status: input.status as never, resolvedAt: resolved })
    .where(eq(schema.chargebacks.id, input.id));

  if (input.note) {
    await db.insert(schema.chargebackEvidence).values({
      id: crypto.randomUUID(),
      chargebackId: input.id,
      kind: "nota",
      label: input.note.slice(0, 160),
      content: { note: input.note },
      addedByUserId: input.actorUserId,
      createdAt: new Date(),
    });
  }

  await audit(db, {
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    action: "chargeback.status",
    entity: "chargeback",
    entityId: input.id,
    before: { status: before.status },
    after: { status: input.status, note: input.note },
    ip: input.ip,
  });
}

export async function addEvidence(
  db: Db,
  input: { chargebackId: string; kind: string; label: string; content?: unknown; fileUrl?: string; actorUserId: string },
) {
  await db.insert(schema.chargebackEvidence).values({
    id: crypto.randomUUID(),
    chargebackId: input.chargebackId,
    kind: input.kind,
    label: input.label,
    content: input.content as never,
    fileUrl: input.fileUrl ?? null,
    addedByUserId: input.actorUserId,
    createdAt: new Date(),
  });
}

/**
 * Exportação em PDF mínimo válido (texto puro) — pronto para envio ao banco/gateway.
 * Sem dependência externa: gera PDF 1.4 à mão. Acima de 50 evidências, trunca com aviso.
 */
export async function exportEvidencePdf(db: Db, chargebackId: string): Promise<Buffer> {
  const { chargeback, evidences, order, items, customer, assessments, history } =
    await getChargebackWithEvidence(db, chargebackId);

  const lines: string[] = [
    "AIRSOFT AMERICANA - DOSSIER DE DEFESA DE CHARGEBACK",
    `Disputa: ${chargeback.providerDisputeId} (${chargeback.provider})`,
    `Pedido: ${order?.number ?? "-"} | Status dispute: ${chargeback.status}`,
    `Valor contestado: R$ ${(chargeback.amountCents / 100).toFixed(2)} | Motivo: ${chargeback.reason ?? "-"} ${chargeback.reasonCode ?? ""}`,
    `Notificado em: ${chargeback.notifiedAt.toISOString()} | Prazo do provedor: ${chargeback.respondBy?.toISOString() ?? "não informado"}`,
    "",
    `Cliente: ${customer?.name ?? "-"} | ${customer?.email ?? "-"} | CPF: ${customer?.cpf ?? "-"}`,
    `Endereco de entrega: ${JSON.stringify(order?.addressJson ?? {})}`,
    "",
    "ITENS DO PEDIDO",
    ...(items ?? []).map((i) => `- ${i.sku} [${i.variantId.slice(0, 8)}] "${i.name}" x${i.quantity} @ R$ ${(i.unitPriceCents / 100).toFixed(2)} = R$ ${(i.totalCents / 100).toFixed(2)}`),
    "",
    `Termos aceitos: v${order?.termsVersion ?? "-"} em ${order?.termsAcceptedAt?.toISOString() ?? "-"} IP ${order?.termsIp ?? "-"}`,
    "",
    "análise ANTIFRAUDE",
    ...((assessments ?? []) as unknown as { score: number; level: string; reasons: { name: string }[] }[]).map(
      (a) => `- score ${a.score}/100 nivel=${a.level} motivos=${(a.reasons ?? []).map((r) => r.name).join("; ")}`,
    ),
    "",
    "histórico DO PEDIDO",
    ...((history ?? []) as unknown as { fromStatus: string | null; toStatus: string; createdAt: Date }[]).map(
      (h) => `- ${h.fromStatus ?? "inicial"} -> ${h.toStatus} em ${new Date(h.createdAt).toISOString()}`,
    ),
    "",
    `EVIDENCIAS (${evidences.length})`,
  ];

  for (const ev of (evidences ?? []).slice(0, 50)) {
    lines.push(`- [${ev.kind}] ${ev.label}`);
    if (ev.fileUrl) lines.push(`  URL: ${ev.fileUrl}`);
    if (ev.content) lines.push(`  conteúdo: ${JSON.stringify(ev.content).slice(0, 300)}`);
  }
  if ((evidences ?? []).length > 50) lines.push(`... e mais ${evidences.length - 50} evidencias`);

  return buildMinimalPdf(lines);
}

function buildMinimalPdf(lines: string[]): Buffer {
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, (c) => "?");
  const streamLines = lines.map(esc).join("\\nTj\\nT* 8");
  const stream = `BT /F1 11 Tf 50 770 Td (${esc(lines[0] ?? "")}) Tj T* 14 ${streamLines} ET`;
  const objects: string[] = [];
  objects[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objects[2] = "<</Type/Pages/Kids[3 0 R]/Count 1>>";
  objects[3] = "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>";
  objects[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  objects[5] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}