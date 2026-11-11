// language: TS, file: vitest/conta-menu.test.ts, target: vitest (suite da raiz)
// Menu lateral da conta: fonte única dos dois acessos. O item ativo vem da
// rota — /conta marca "Minha conta", /conta/pedidos marca "Meus pedidos".
import { describe, it, expect } from "vitest";
import { initialsOf, menuFor, type ContaActiveKey, type MenuLink } from "../apps/store/src/app/conta/conta-menu";

function links(active: ContaActiveKey): MenuLink[] {
  return menuFor(active, false).filter((m): m is MenuLink => m.kind === "link");
}

describe("menuFor", () => {
  it("mantém os quatro acessos na ordem da lateral", () => {
    expect(menuFor("conta", false).map((m) => m.label)).toEqual([
      "Minha conta",
      "Meus pedidos",
      "Rastrear pedido",
      "Atendimento",
    ]);
  });

  it("aponta cada item pra sua rota", () => {
    expect(links("conta").map((m) => m.href)).toEqual([
      "/conta",
      "/conta/pedidos",
      "/rastreamento",
      "/atendimento",
    ]);
  });

  it("ativa somente o link da rota atual", () => {
    const onConta = links("conta");
    expect(onConta.find((m) => m.href === "/conta")?.active).toBe(true);
    expect(onConta.find((m) => m.href === "/conta/pedidos")?.active).toBe(false);

    const onPedidos = links("pedidos");
    expect(onPedidos.find((m) => m.href === "/conta/pedidos")?.active).toBe(true);
    expect(onPedidos.find((m) => m.href === "/conta")?.active).toBe(false);
  });

  it("só oferece sair da conta quando há sessão", () => {
    const labels = (authed: boolean) => menuFor("conta", authed).map((m) => m.label);
    expect(labels(true)).toContain("Sair da conta");
    expect(labels(false)).not.toContain("Sair da conta");
  });

  it("o item de sair é ação, não link — não navega pra lugar nenhum", () => {
    const logout = menuFor("pedidos", true).find((m) => m.label === "Sair da conta");
    expect(logout?.kind).toBe("action");
  });
});

describe("initialsOf", () => {
  it("nome completo vira as duas primeiras letras", () => {
    expect(initialsOf("Joana Pereira")).toBe("JP");
  });

  it("três nomes cortam nas duas primeiras iniciais", () => {
    expect(initialsOf("Joana Pereira Souza")).toBe("JP");
  });

  it("um termo só usa a inicial dele", () => {
    expect(initialsOf("Madonna")).toBe("M");
  });

  it("normaliza pra maiúsculas", () => {
    expect(initialsOf("joana pereira")).toBe("JP");
  });

  it("nome vazio devolve string vazia, sem estourar", () => {
    expect(initialsOf("")).toBe("");
  });
});
