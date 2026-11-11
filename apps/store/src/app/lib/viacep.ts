// language: TS, file: apps/store/src/app/lib/viacep.ts, target: Next.js App Router (client)
// Consulta de CEP via ViaCEP (via publica, sem chave). Regras:
//   1. So consulta com 8 digitos; qualquer falha (rede, 4xx, "erro": true) vira null
//      — o formulario continua manual, nunca trava o cliente.
//   2. O preenchimento so escreve em campos VAZIOS: numero e complemento sao do
//      usuario, e um campo que ele ja digitou nao pode ser sobrescrito.
//   3. Puro (sem React, sem fetch global fixo) para ser testavel em vitest.

export type ViaCepResult = {
  zip: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type CepForm = {
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

export function cepDigits(value: string): string {
  return value.replace(/\D+/g, "").slice(0, 8);
}

export function isCompleteCep(value: string): boolean {
  return cepDigits(value).length === 8;
}

/** 13500-000 — o traço entra no sexto dígito, na cadência da digitação. */
export function formatCep(value: string): string {
  const d = cepDigits(value);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

type ViaCepPayload = {
  erro?: boolean | string;
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

/**
 * Consulta o CEP. Devolve null quando nao ha o que preencher — o chamador
 * trata como "deixa o cliente digitar", nunca como erro bloqueante.
 */
export async function fetchViaCep(
  cep: string,
  fetchImpl: FetchLike = (url) => fetch(url),
): Promise<ViaCepResult | null> {
  const digits = cepDigits(cep);
  if (digits.length !== 8) return null;
  try {
    const res = await fetchImpl(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) return null;
    const data = (await res.json()) as ViaCepPayload;
    if (!data || data.erro === true || data.erro === "true") return null;
    const city = (data.localidade ?? "").trim();
    const street = (data.logradouro ?? "").trim();
    const neighborhood = (data.bairro ?? "").trim();
    if (!city && !street) return null;
    return {
      zip: formatCep(data.cep ?? digits),
      street,
      neighborhood,
      city,
      state: (data.uf ?? "").trim().toUpperCase().slice(0, 2),
    };
  } catch {
    return null;
  }
}

const empty = (value: string) => value.trim().length === 0;

/**
 * Devolve o form com os campos vazios preenchidos pelo resultado da consulta.
 * Campos ja digitados pelo cliente (numero, complemento, ou qualquer um que ele
 * tenha preenchido antes do blur) ficam exatamente como estavam.
 */
export function mergeCepLookup<T extends CepForm>(form: T, found: ViaCepResult): T {
  return {
    ...form,
    zip: formatCep(found.zip),
    street: empty(form.street) && found.street ? found.street : form.street,
    neighborhood:
      empty(form.neighborhood) && found.neighborhood ? found.neighborhood : form.neighborhood,
    city: empty(form.city) && found.city ? found.city : form.city,
    state: empty(form.state) && found.state ? found.state : form.state,
  };
}
