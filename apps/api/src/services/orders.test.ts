// language: TS, file: apps/api/src/services/orders.test.ts, target: vitest
// getOrderDetailForCustomer: pedido do dono + itens com slug e variantes
// ativas do produto (base do ESPIAR/COMPRAR), escopo de cliente e 404.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { getOrderDetailForCustomer } from "./orders.js";

let db: any;

const TAG = `ordtest${Date.now()}`;
const EMAIL_DONO = `${TAG}-dono@test.local`;
const EMAIL_OUTRO = `${TAG}-outro@test.local`;

let donoId: string;
let outroId: string;
let productId: string;
let varianteAtiva: string;
let varianteInativa: string;
let orderId: string;

async function ensureCustomer(email: string, name: string): Promise<string> {
  const rows = await db.select().from(schema.customers).where(eq(schema.customers.email, email));
  if (rows[0]) return rows[0].id;
  const [inserted] = await db
    .insert(schema.customers)
    .values({ name, email, passwordHash: "hash", cpf: "12345678901", phone: "19999999999" })
    .returning();
  return inserted.id;
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

beforeEach(async () => {
  donoId = await ensureCustomer(EMAIL_DONO, "Dono do Pedido");
  outroId = await ensureCustomer(EMAIL_OUTRO, "Outro Cliente");

  let [cat] = await db.select().from(schema.categories).limit(1);
  if (!cat) {
    [cat] = await db
      .insert(schema.categories)
      .values({ name: "Acessórios", slug: `acessorios-${TAG}`, ageRestricted: false, active: true })
      .returning();
  }

  const runId = `${TAG}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // orders.number é varchar(20) — número curto e único por execução
  const orderNumber = `${Date.now().toString(36).slice(-9)}${Math.random().toString(36).slice(2, 7)}`;

  const [prod] = await db
    .insert(schema.products)
    .values({ name: "Produto Pedido", slug: `${runId}-produto`, categoryId: cat.id, published: true })
    .returning();
  productId = prod.id;

  const variantes = await db
    .insert(schema.productVariants)
    .values([
      { productId, sku: `${runId}-PRETO`, name: "Preto", priceCents: 19900, active: true },
      { productId, sku: `${runId}-VERDE`, name: "Verde", priceCents: 20900, active: true },
      { productId, sku: `${runId}-OFF`, name: "Descontinuada", priceCents: 9900, active: false },
    ])
    .returning();
  varianteAtiva = variantes[0].id;
  varianteInativa = variantes[2].id;

  const [order] = await db
    .insert(schema.orders)
    .values({
      number: orderNumber,
      customerId: donoId,
      subtotalCents: 19900,
      totalCents: 19900,
      addressJson: { city: "Americana", state: "SP" },
    })
    .returning();
  orderId = order.id;

  await db.insert(schema.orderItems).values({
    orderId,
    variantId: varianteAtiva,
    sku: `${runId}-PRETO`,
    name: "Produto Pedido Preto",
    quantity: 1,
    unitPriceCents: 19900,
    totalCents: 19900,
  });
  runSlug = `${runId}-produto`;
  runSkuPreto = `${runId}-PRETO`;
});

let runSlug: string;
let runSkuPreto: string;

describe("getOrderDetailForCustomer", () => {
  it("devolve o pedido do dono com slug do produto e variantes ativas (sem a inativa)", async () => {
    const detail = await getOrderDetailForCustomer(db, { orderId, customerId: donoId });
    expect(detail.order.id).toBe(orderId);
    expect(detail.items).toHaveLength(1);
    const item = detail.items.find((i) => i.variantId === varianteAtiva)!;
    expect(item.productSlug).toBe(runSlug);
    expect(item.variantId).toBe(varianteAtiva);
    // só as duas ativas — a descontinuada não aparece para recomprar
    expect(item.variants.map((v) => v.name).sort()).toEqual(["Preto", "Verde"]);
    expect(item.variants.every((v) => v.id !== varianteInativa)).toBe(true);
    expect(item.variants.find((v) => v.id === varianteAtiva)?.priceCents).toBe(19900);
  });

  it("pedidos de outro cliente lançam 404 (escopo do dono)", async () => {
    await expect(
      getOrderDetailForCustomer(db, { orderId, customerId: outroId }),
    ).rejects.toThrow(/não encontrado/i);
  });

  it("pedido inexistente lança 404", async () => {
    await expect(
      getOrderDetailForCustomer(db, { orderId: "00000000-0000-0000-0000-000000000000", customerId: donoId }),
    ).rejects.toThrow(/não encontrado/i);
  });

  it("item cujo produto saiu do catálogo fica com slug null e variantes vazias", async () => {
    // variante órfã (pedido aponta para variante que não existe mais) simula produto removido
    const tmpSku = `${runSkuPreto}-TMP`;
    await db.insert(schema.orderItems).values({
      orderId,
      variantId: "11111111-1111-4111-8111-111111111111",
      sku: tmpSku,
      name: "Item órfão",
      quantity: 1,
      unitPriceCents: 500,
      totalCents: 500,
    });

    const detail = await getOrderDetailForCustomer(db, { orderId, customerId: donoId });
    const orfao = detail.items.find((i) => i.sku === tmpSku);
    expect(orfao).toBeTruthy();
    expect(orfao!.productSlug).toBeNull();
    expect(orfao!.variants).toEqual([]);
    // o item normal continua com slug — ESPIAR serve para os dois
    expect(detail.items.find((i) => i.variantId === varianteAtiva)!.productSlug).toBe(runSlug);
  });
});
