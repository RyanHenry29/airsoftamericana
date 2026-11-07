import { test, expect } from "@playwright/test";
import { API } from "./helpers";

test.describe("FASE 3 — Catálogo loja (API, segurança/contrato)", () => {
  test.skip(!process.env.E2E_READY, "Requer E2E_READY=1 com API isolada");

  test("custo interno nunca aparece em rotas públicas de produto", async ({ request }) => {
    // usa produtos DEMO do seed padrão (seed.ts cria [DEMO] produtos); busca lista e PDP
    const list = await request.get(`${API}/api/store/products?limit=24`);
    expect(list.ok()).toBe(true);
    const lj = await list.json();
    const items = lj.items || [];
    for (const p of items) {
      expect(p).not.toHaveProperty("costCents");
      expect(p).not.toHaveProperty("cost_cents");
      for (const v of p.variants || []) {
        expect(v).not.toHaveProperty("costCents");
        expect(v).not.toHaveProperty("cost_cents");
      }
    }
    if (items[0]?.slug) {
      const pdp = await request.get(`${API}/api/store/products/${encodeURIComponent(items[0].slug)}`);
      expect(pdp.ok()).toBe(true);
      const pj = await pdp.json();
      expect(pj).not.toHaveProperty("costCents");
      expect(pj).not.toHaveProperty("cost_cents");
      expect(pj).not.toHaveProperty("costCents".toLowerCase());
    }
  });

  test("filtro por condição funciona no servidor", async ({ request }) => {
    for (const cond of ["novo", "usado", "seminovo"]) {
      const r = await request.get(`${API}/api/store/products?condicao=${cond}&limit=24`);
      expect(r.ok()).toBe(true);
      const j = await r.json();
      for (const p of j.items || []) {
        expect(p.condicao).toBe(cond);
      }
    }
  });
});
