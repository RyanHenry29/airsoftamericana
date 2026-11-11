// language: TS, file: apps/api/src/routes/customer-account.test.ts, target: vitest
// Perfil, endereços e foto do cliente: PUT /api/auth/me + CRUD
// /api/customer/addresses + /api/customer/avatar (upload/serve/remove).
// Sessão via Bearer (customerToken lê authorization/cookie), app.inject real.
import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { eq } from "drizzle-orm";
import { routes } from "./index.js";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { signJwt } from "../middleware/auth.js";

let db: any;
let app: any;

const ownerEmail = `perfil-owner-${Date.now()}@airsoftamericana.com.br`;
const intruderEmail = `perfil-intruder-${Date.now()}@airsoftamericana.com.br`;
let ownerToken = "";
let intruderToken = "";
let ownerId = "";

async function buildApp() {
  const instance = fastify();
  await instance.register(fastifyCookie);
  await routes(instance, config as any, db);
  await instance.ready();
  return instance;
}

function addressPayload(overrides: Record<string, unknown> = {}) {
  return {
    recipient: "Joana Pereira",
    zip: "01310100",
    street: "Avenida Paulista",
    number: "1000",
    complement: "apto 121",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "sp",
    ...overrides,
  };
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  const owner = await db
    .insert(schema.customers)
    .values({ name: "Joana Pereira", email: ownerEmail, passwordHash: null })
    .returning();
  ownerId = owner[0].id;
  ownerToken = await signJwt({ sub: ownerId, role: "customer", type: "customer" });
  const intruder = await db
    .insert(schema.customers)
    .values({ name: "Intruso Teste", email: intruderEmail, passwordHash: null })
    .returning();
  intruderToken = await signJwt({ sub: intruder[0].id, role: "customer", type: "customer" });
  app = await buildApp();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("PUT /api/auth/me — edição dos próprios dados", () => {
  it("recusa sem sessão (401)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/auth/me", payload: { name: "Joana Pereira" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthorized");
  });

  it("recusa CPF fora do formato (400 com detalhe em português)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/auth/me",
      headers: auth(ownerToken),
      payload: { name: "Joana Pereira", cpf: "123" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
    const issues = res.json().error.details?.fieldErrors ?? res.json().error.details;
    expect(JSON.stringify(issues)).toContain("CPF deve conter 11 dígitos");
  });

  it("grava nome, CPF e telefone e devolve o cliente atualizado", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/auth/me",
      headers: auth(ownerToken),
      payload: { name: "Joana Pereira Souza", cpf: "12345678901", phone: "(11) 99999-0000" },
    });
    expect(res.statusCode).toBe(200);
    const { customer } = res.json();
    expect(customer.name).toBe("Joana Pereira Souza");
    expect(customer.cpf).toBe("12345678901");
    expect(customer.phone).toBe("(11) 99999-0000");

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: auth(ownerToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().customer.cpf).toBe("12345678901");
    const row = (await db.select().from(schema.customers).where(eq(schema.customers.id, ownerId)))[0];
    expect(row.name).toBe("Joana Pereira Souza");
    expect(row.phone).toBe("(11) 99999-0000");
  });

  it("limpa CPF/telefone quando enviados vazios", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/auth/me",
      headers: auth(ownerToken),
      payload: { name: "Joana Pereira Souza", cpf: "", phone: "" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().customer.cpf).toBeNull();
    expect(res.json().customer.phone).toBeNull();
  });
});

describe("CRUD /api/customer/addresses", () => {
  let firstId = "";
  let secondId = "";

  it("exige sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/customer/addresses" });
    expect(res.statusCode).toBe(401);
  });

  it("primeiro endereço salvo vira o padrão", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/customer/addresses",
      headers: auth(ownerToken),
      payload: addressPayload(),
    });
    expect(res.statusCode).toBe(201);
    const { address } = res.json();
    expect(address.isDefault).toBe(true);
    expect(address.state).toBe("SP"); // sigla normalizada na gravação
    firstId = address.id;
  });

  it("segundo endereço entra sem tirar o padrão do primeiro", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/customer/addresses",
      headers: auth(ownerToken),
      payload: addressPayload({
        recipient: "Joana Pereira (trabalho)",
        zip: "20040002",
        street: "Rua da Assembleia",
        number: "200",
        complement: "",
        neighborhood: "Centro",
        city: "Rio de Janeiro",
        state: "rj",
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().address.isDefault).toBe(false);
    secondId = res.json().address.id;

    const list = await app.inject({ method: "GET", url: "/api/customer/addresses", headers: auth(ownerToken) });
    expect(list.statusCode).toBe(200);
    const items = list.json().items;
    expect(items).toHaveLength(2);
    expect(items.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
    expect(items.find((a: { isDefault: boolean }) => a.isDefault).id).toBe(firstId);
    // listagem vem com o padrão primeiro (pré-preenchimento do checkout)
    expect(items[0].id).toBe(firstId);
  });

  it("PUT com isDefault promove o endereço e rebaixa os demais", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/customer/addresses/${secondId}`,
      headers: auth(ownerToken),
      payload: addressPayload({ isDefault: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().address.isDefault).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/customer/addresses", headers: auth(ownerToken) });
    const items = list.json().items;
    expect(items.find((a: { id: string }) => a.id === firstId).isDefault).toBe(false);
    expect(items.find((a: { id: string }) => a.id === secondId).isDefault).toBe(true);
  });

  it("recusa endereço inválido (CEP com 6 dígitos → 400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/customer/addresses",
      headers: auth(ownerToken),
      payload: addressPayload({ zip: "123456" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
  });

  it("não deixa outro cliente mexer no endereço (404 nos dois verbos)", async () => {
    const put = await app.inject({
      method: "PUT",
      url: `/api/customer/addresses/${firstId}`,
      headers: auth(intruderToken),
      payload: addressPayload({ recipient: "Ave Maria" }),
    });
    expect(put.statusCode).toBe(404);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/customer/addresses/${firstId}`,
      headers: auth(intruderToken),
    });
    expect(del.statusCode).toBe(404);
    const stillThere = await db
      .select()
      .from(schema.customerAddresses)
      .where(eq(schema.customerAddresses.id, firstId));
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].recipient).toBe("Joana Pereira");
  });

  it("id fora do formato UUID responde 404 (sem erro 500 do banco)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/customer/addresses/nao-e-uuid",
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE do padrão promove o endereço restante", async () => {
    // secondId é o padrão agora; apaga e o firstId deve assumir
    const del = await app.inject({
      method: "DELETE",
      url: `/api/customer/addresses/${secondId}`,
      headers: auth(ownerToken),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().success).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/customer/addresses", headers: auth(ownerToken) });
    const items = list.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(firstId);
    expect(items[0].isDefault).toBe(true);
  });

  it("o cliente intruso continua com a lista vazia", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/customer/addresses",
      headers: auth(intruderToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(0);
  });
});

describe("Foto de perfil /api/customer/avatar", () => {
  // O servidor só confere magic bytes (não decodifica): assinatura PNG/JPEG
  // + lixo é suficiente pra exercitar a rota inteira.
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngB64 = Buffer.concat([PNG_SIG, Buffer.alloc(64, 7)]).toString("base64");
  const jpegB64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]).toString("base64");

  it("exige sessão nos três verbos (401)", async () => {
    expect((await app.inject({ method: "GET", url: "/api/customer/avatar" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/customer/avatar", payload: { image: pngB64 } })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/api/customer/avatar" })).statusCode).toBe(401);
  });

  it("GET sem foto responde 404 (o fallback da UI são as iniciais)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/customer/avatar", headers: auth(ownerToken) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("POST sem campo image é 400 com o campo nomeado", async () => {
    const res = await app.inject({ method: "POST", url: "/api/customer/avatar", headers: auth(ownerToken), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
  });

  it("POST de conteúdo que não é imagem é 400 image_type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/customer/avatar",
      headers: auth(ownerToken),
      payload: { image: Buffer.from("sou um texto, nao uma foto").toString("base64") },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("image_type");
  });

  it("POST acima de 1 MB é 400 image_too_large", async () => {
    const big = Buffer.alloc(1024 * 1024 + 1, 0);
    PNG_SIG.copy(big, 0);
    const res = await app.inject({
      method: "POST",
      url: "/api/customer/avatar",
      headers: auth(ownerToken),
      payload: { image: big.toString("base64") },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("image_too_large");
  });

  it("POST aceita PNG e o GET devolve os mesmos bytes com o mime certo", async () => {
    const up = await app.inject({
      method: "POST",
      url: "/api/customer/avatar",
      headers: auth(ownerToken),
      payload: { image: `data:image/png;base64,${pngB64}` },
    });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ avatar: true, mime: "image/png" });

    const get = await app.inject({ method: "GET", url: "/api/customer/avatar", headers: auth(ownerToken) });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toContain("image/png");
    expect(get.rawPayload.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    const rows = await db.select().from(schema.customerAvatars).where(eq(schema.customerAvatars.customerId, ownerId));
    expect(rows).toHaveLength(1);
  });

  it("segundo upload substitui o primeiro (uma foto por conta, não acumula)", async () => {
    const up = await app.inject({
      method: "POST",
      url: "/api/customer/avatar",
      headers: auth(ownerToken),
      payload: { image: jpegB64 },
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().mime).toBe("image/jpeg");

    const rows = await db.select().from(schema.customerAvatars).where(eq(schema.customerAvatars.customerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].mime).toBe("image/jpeg");

    const get = await app.inject({ method: "GET", url: "/api/customer/avatar", headers: auth(ownerToken) });
    expect(get.headers["content-type"]).toContain("image/jpeg");
  });

  it("outro cliente não enxerga a foto alheia (404)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/customer/avatar", headers: auth(intruderToken) });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE remove a foto e o GET volta a 404", async () => {
    const del = await app.inject({ method: "DELETE", url: "/api/customer/avatar", headers: auth(ownerToken) });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/customer/avatar", headers: auth(ownerToken) })).statusCode).toBe(404);
    const rows = await db.select().from(schema.customerAvatars).where(eq(schema.customerAvatars.customerId, ownerId));
    expect(rows).toHaveLength(0);
  });
});
