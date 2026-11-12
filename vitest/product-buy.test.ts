// language: TS, file: vitest/product-buy.test.ts, target: vitest (suite da raiz)
// Lógica dos botões ESPIAR/COMPRAR: chips de opção derivados do nome real da
// variante e quantidade no carrinho (POST de carrinho é quantidade absoluta).
import { describe, it, expect } from "vitest";
import {
  effectiveVariantPrice,
  maxAddQuantity,
  nextCartQuantity,
  parseOption,
  variantChips,
} from "../apps/store/src/app/lib/buy";
import type { StoreVariant } from "../apps/store/src/app/lib/store";

function variant(over: Partial<StoreVariant>): StoreVariant {
  return {
    id: `v-${Math.random().toString(36).slice(2, 8)}`,
    sku: "SKU-1",
    name: "Padrao",
    priceCents: 19900,
    promoPriceCents: null,
    weightGrams: 500,
    active: true,
    available: 5,
    ...over,
  };
}

describe("parseOption", () => {
  it("separa chave e valor com e sem separador", () => {
    expect(parseOption("Tamanho: G")).toEqual({ key: "tamanho", value: "G" });
    expect(parseOption("Tamanho G")).toEqual({ key: "tamanho", value: "G" });
    expect(parseOption("Cor — Preto")).toEqual({ key: "cor", value: "Preto" });
    expect(parseOption("  modelo:  M4  ")).toEqual({ key: "modelo", value: "M4" });
  });

  it("não quebra palavra que começa como chave", () => {
    expect(parseOption("Corda")).toBeNull();
    expect(parseOption("Corpreto")).toBeNull();
    expect(parseOption("Cor")).toBeNull();
  });

  it("nome livre não vira opção", () => {
    expect(parseOption("Padrao")).toBeNull();
    expect(parseOption("Único")).toBeNull();
  });
});

describe("variantChips", () => {
  it("cabeçalho vira a chave quando todas as variantes usam o mesmo eixo", () => {
    const list = variantChips([
      variant({ name: "Tamanho: P" }),
      variant({ name: "Tamanho: M" }),
      variant({ name: "Tamanho G" }),
    ]);
    expect(list.header).toBe("Tamanho");
    expect(list.chips.map((c) => c.label)).toEqual(["P", "M", "G"]);
  });

  it("nomes livres ficam sem cabeçalho, com o nome cheio no chip", () => {
    const list = variantChips([variant({ name: "Padrao" }), variant({ name: "Vermelho" })]);
    expect(list.header).toBeNull();
    expect(list.chips.map((c) => c.label)).toEqual(["Padrao", "Vermelho"]);
  });

  it("mesa mista não fabrica eixo: sem cabeçalho, nomes cheios", () => {
    const list = variantChips([variant({ name: "Tamanho: G" }), variant({ name: "Cor: Preto" })]);
    expect(list.header).toBeNull();
    expect(list.chips.map((c) => c.label)).toEqual(["Tamanho: G", "Cor: Preto"]);
  });

  it("filtra inativas e preserva preço/estoque reais", () => {
    const list = variantChips([
      variant({ name: "Cor: Preto", promoPriceCents: 17900, available: 2 }),
      variant({ name: "Cor: Verde", active: false }),
    ]);
    expect(list.chips).toHaveLength(1);
    expect(list.chips[0]).toMatchObject({ label: "Preto", promoPriceCents: 17900, available: 2 });
  });

  it("sem variantes ativas devolve lista vazia", () => {
    expect(variantChips([])).toEqual({ header: null, chips: [] });
    expect(variantChips([variant({ active: false })])).toEqual({ header: null, chips: [] });
  });
});

describe("effectiveVariantPrice", () => {
  it("promoção tem prioridade sobre preço de lista", () => {
    expect(effectiveVariantPrice({ priceCents: 19900, promoPriceCents: 17900 })).toBe(17900);
    expect(effectiveVariantPrice({ priceCents: 19900, promoPriceCents: null })).toBe(19900);
  });
});

describe("nextCartQuantity", () => {
  it("soma com o que já está no carrinho", () => {
    expect(nextCartQuantity(0, 1)).toBe(1);
    expect(nextCartQuantity(3, 2)).toBe(5);
  });

  it("respeita o teto de 999 do servidor", () => {
    expect(nextCartQuantity(998, 5)).toBe(999);
    expect(nextCartQuantity(1200, 1)).toBe(999);
  });

  it("entrada inválida vira 1", () => {
    expect(nextCartQuantity(Number.NaN, Number.NaN)).toBe(1);
    expect(nextCartQuantity(-2, 0)).toBe(1);
  });
});

describe("maxAddQuantity", () => {
  it("estoque restante = disponível menos o carrinho", () => {
    expect(maxAddQuantity({ available: 5, inCart: 2, unidadeUnica: false })).toBe(3);
    expect(maxAddQuantity({ available: 5, inCart: 9, unidadeUnica: false })).toBe(0);
  });

  it("sem estoque não dá para adicionar", () => {
    expect(maxAddQuantity({ available: 0, inCart: 0, unidadeUnica: false })).toBe(0);
  });

  it("unidade única trava em 1 e some quando já está no carrinho", () => {
    expect(maxAddQuantity({ available: 9, inCart: 0, unidadeUnica: true })).toBe(1);
    expect(maxAddQuantity({ available: 9, inCart: 1, unidadeUnica: true })).toBe(0);
  });
});
