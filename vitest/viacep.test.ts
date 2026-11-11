// language: TS, file: vitest/viacep.test.ts, target: vitest (suite da raiz)
// ViaCEP da loja: mascara progressiva, guarda de 8 digitos, contrato da
// resposta (falha = null, nunca excecao) e o merge que NAO sobrescreve o que
// o cliente ja digitou — numero e complemento sao dele.
import { describe, it, expect, vi } from "vitest";
import {
  cepDigits,
  fetchViaCep,
  formatCep,
  isCompleteCep,
  mergeCepLookup,
  type CepForm,
  type ViaCepResult,
} from "../apps/store/src/app/lib/viacep";

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function fakeFetch(payload: unknown, ok = true): FetchLike & ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload }));
  return fn as unknown as FetchLike & ReturnType<typeof vi.fn>;
}

const FOUND: ViaCepResult = {
  zip: "13500-000",
  street: "Rua das Palmeiras",
  neighborhood: "Centro",
  city: "Americana",
  state: "SP",
};

function form(partial: Partial<CepForm> = {}): CepForm {
  return {
    zip: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    ...partial,
  };
}

describe("mascara de CEP", () => {
  it("entra o traco no sexto digito, na cadencia da digitacao", () => {
    expect(formatCep("1")).toBe("1");
    expect(formatCep("13500")).toBe("13500");
    expect(formatCep("135000")).toBe("13500-0");
    expect(formatCep("13500000")).toBe("13500-000");
  });

  it("e idempotente: valor ja mascarado volta igual", () => {
    expect(formatCep("13500-000")).toBe("13500-000");
    expect(formatCep(formatCep("13500000"))).toBe("13500-000");
  });

  it("cepDigits corta lixo e satura em 8", () => {
    expect(cepDigits("13.500-000")).toBe("13500000");
    expect(cepDigits("13500000999")).toBe("13500000");
    expect(cepDigits("abc")).toBe("");
  });

  it("isCompleteCep so com 8 digitos", () => {
    expect(isCompleteCep("13500-000")).toBe(true);
    expect(isCompleteCep("13500-00")).toBe(false);
    expect(isCompleteCep("")).toBe(false);
  });
});

describe("fetchViaCep", () => {
  it("consulta o endpoint com os digitos puros", async () => {
    const fetchImpl = fakeFetch({ erro: false, cep: "13500-000", localidade: "Americana", uf: "SP" });
    await fetchViaCep("13500-000", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("https://viacep.com.br/ws/13500000/json/");
  });

  it("mapeia a resposta e normaliza a UF", async () => {
    const fetchImpl = fakeFetch({
      erro: false,
      cep: "13500-000",
      logradouro: "  Rua das Palmeiras ",
      bairro: "Centro",
      localidade: "Americana",
      uf: "sp",
    });
    const found = await fetchViaCep("13500000", fetchImpl);
    expect(found).toEqual({
      zip: "13500-000",
      street: "Rua das Palmeiras",
      neighborhood: "Centro",
      city: "Americana",
      state: "SP",
    });
  });

  it("CEP inexistente (erro: true) vira null", async () => {
    const fetchImpl = fakeFetch({ erro: true });
    expect(await fetchViaCep("00000000", fetchImpl)).toBeNull();
  });

  it("HTTP de erro vira null", async () => {
    const fetchImpl = fakeFetch({ message: "not found" }, false);
    expect(await fetchViaCep("13500000", fetchImpl)).toBeNull();
  });

  it("queda de rede vira null, nunca excecao", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as FetchLike;
    expect(await fetchViaCep("13500000", fetchImpl)).toBeNull();
  });

  it("resposta sem logradouro e sem cidade nao preenche nada", async () => {
    const fetchImpl = fakeFetch({ erro: false, cep: "13500-000", uf: "SP" });
    expect(await fetchViaCep("13500000", fetchImpl)).toBeNull();
  });

  it("menos de 8 digitos nem consulta", async () => {
    const fetchImpl = fakeFetch({});
    expect(await fetchViaCep("13500", fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("mergeCepLookup", () => {
  it("preenche so os campos vazios", () => {
    const merged = mergeCepLookup(form(), FOUND);
    expect(merged.street).toBe("Rua das Palmeiras");
    expect(merged.neighborhood).toBe("Centro");
    expect(merged.city).toBe("Americana");
    expect(merged.state).toBe("SP");
    expect(merged.zip).toBe("13500-000");
  });

  it("numero e complemento do cliente nunca sao sobrescritos", () => {
    const merged = mergeCepLookup(form({ number: "452", complement: "fundos" }), FOUND);
    expect(merged.number).toBe("452");
    expect(merged.complement).toBe("fundos");
  });

  it("campo que o cliente ja digitou antes do lookup fica intacto", () => {
    const merged = mergeCepLookup(form({ street: "Rua do Cliente", city: "" }), FOUND);
    expect(merged.street).toBe("Rua do Cliente");
    expect(merged.city).toBe("Americana");
  });

  it("mantem chaves extras do form chamador (ex.: isDefault da conta)", () => {
    const withFlag = { ...form(), isDefault: true };
    const merged = mergeCepLookup(withFlag, FOUND);
    expect(merged.isDefault).toBe(true);
    expect(merged.street).toBe("Rua das Palmeiras");
  });
});
