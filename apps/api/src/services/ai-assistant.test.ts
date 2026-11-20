// language: TS, file: apps/api/src/services/ai-assistant.test.ts, target: vitest
// Unitário do assistente (sem banco): orçamento de tokens do Groq — plano free tem
// TPM de 8.000 tokens/min somando input+output e cada imagem custa 2.048 fixos —,
// grounding indexado #n → id real, corpo do erro upstream visível na mensagem e
// retry único em 413/429 esperando a janela de reset.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import {
  AI_HISTORY_MESSAGES,
  AI_MAX_IMAGES,
  GROUNDING_PRODUCT_LIMIT,
  buildSystemPrompt,
  groqTurn,
  resolveGroundingId,
  type ChatMessage,
  type Grounding,
} from "./ai-assistant.js";
import { AppError } from "../lib/errors.js";

const config = { GROQ_API_KEY: "gsk_test_key_never_printed", GROQ_MODEL: "qwen/qwen3.8-27b" } as any;
const messages: ChatMessage[] = [{ role: "system", content: "prompt" }];

const CAT_ID = "00000000-0000-0000-0000-000000000001";
const BRAND_ID = "00000000-0000-0000-0000-0000000000b1";

function grounding(): Grounding {
  return {
    categories: [
      { id: CAT_ID, name: "Rifle AEG", path: "Armas de Airsoft > Rifle AEG" },
      { id: "00000000-0000-0000-0000-000000000002", name: "Carregador", path: "Acessórios > Carregador" },
    ],
    brands: [{ id: BRAND_ID, name: "Specna Arms" }],
    recentProducts: [{ name: "Réplica M4 CQB", slug: "replica-m4-cqb" }],
    commercial: {
      pix_discount_percent: 10,
      installments: 6,
      installment_interest_free: true,
      min_installment_cents: 10_000,
      free_shipping_from_cents: 30_000,
    },
  } as Grounding;
}

function okResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  } as unknown as Response;
}

function errorResponse(status: number, message: string, retryAfter: string | null = null) {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? retryAfter : null) },
    text: async () => JSON.stringify({ error: { message } }),
  } as unknown as Response;
}

const TPM_413 =
  "Request too large for model 'qwen/qwen3.8-27b' on tokens per minute (TPM): Limit 8000, Requested 12345";

let fetchMock: ReturnType<typeof vi.fn>;
let sleepMock: Mock<(ms: number) => Promise<void>>;

beforeEach(() => {
  fetchMock = vi.fn();
  sleepMock = vi.fn(async (_ms: number) => {});
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveGroundingId — índice #n vira id real", () => {
  const ids = ["id-a", "id-b", "id-c"];

  it("aceita UUID já enviado (retrocompatível com conversa antiga)", () => {
    expect(resolveGroundingId("id-b", ids)).toBe("id-b");
  });

  it("resolve #2 e 2 para a posição certa", () => {
    expect(resolveGroundingId("#2", ids)).toBe("id-b");
    expect(resolveGroundingId("2", ids)).toBe("id-b");
    expect(resolveGroundingId(" #3 ", ids)).toBe("id-c");
  });

  it("recusa índice fora da lista, texto aleatório e vazio — nunca id inventado", () => {
    expect(resolveGroundingId("#4", ids)).toBeNull();
    expect(resolveGroundingId("#0", ids)).toBeNull();
    expect(resolveGroundingId("armas", ids)).toBeNull();
    expect(resolveGroundingId("", ids)).toBeNull();
  });
});

describe("buildSystemPrompt — dieta de tokens (TPM 8K/min)", () => {
  it("manda índice #n com o caminho, nunca o UUID cru", () => {
    const prompt = buildSystemPrompt(grounding());
    expect(prompt).toMatch(/#1 \| Armas de Airsoft > Rifle AEG/);
    expect(prompt).toMatch(/#1 \| Specna Arms/);
    expect(prompt).not.toContain(CAT_ID);
    expect(prompt).not.toContain(BRAND_ID);
    expect(prompt).toContain("REGRAS RÍGIDAS");
    expect(prompt).toContain('"#n"');
  });

  it("trava as constantes que estouram o TPM se alguém subir de volta", () => {
    // 1 imagem = 2.048 tokens; 3 imagens sozinhas comiam 77% do limite de 8K
    expect(AI_MAX_IMAGES).toBe(1);
    // histórico longo somava milhares de tokens de conversa velha em toda chamada
    expect(AI_HISTORY_MESSAGES).toBeLessThanOrEqual(6);
    // cada linha de produto ≈ 40 tokens no prompt do sistema
    expect(GROUNDING_PRODUCT_LIMIT).toBeLessThanOrEqual(50);
  });
});

describe("groqTurn — 413/429, detalhe upstream e orçamento de saída", () => {
  it("413 espera a janela de reset e tenta de novo: passa na segunda", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(413, TPM_413))
      .mockResolvedValueOnce(okResponse({ reply: "Rascunho pronto.", draft: null }));

    const turn = await groqTurn(config, messages, { sleep: sleepMock });

    expect(turn.reply).toBe("Rascunho pronto.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    // sem header de reset → espera o teto (8s), sempre dentro do intervalo permitido
    expect(sleepMock.mock.calls[0]![0]).toBe(8000);
  });

  it("429 lê retry-after em segundos", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, "Rate limit reached", "2"))
      .mockResolvedValueOnce(okResponse({ reply: "ok", draft: null }));

    await groqTurn(config, messages, { sleep: sleepMock });

    expect(sleepMock.mock.calls[0]![0]).toBe(2000);
  });

  it("segunda falha vira 503 com a causa do Groq na mensagem, sem vazar a chave", async () => {
    fetchMock.mockResolvedValue(errorResponse(413, TPM_413));

    const err = await groqTurn(config, messages, { sleep: sleepMock }).catch((e: AppError) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(503);
    expect((err as AppError).code).toBe("ai_upstream_error");
    expect((err as AppError).message).toContain("HTTP 413");
    expect((err as AppError).message).toContain("(TPM): Limit 8000, Requested 12345");
    expect((err as AppError).message).not.toContain("gsk_test_key_never_printed");
    expect(fetchMock).toHaveBeenCalledTimes(2); // uma repetição, nunca loop
  });

  it("401 mantém o texto de chave inválida e não repete", async () => {
    fetchMock.mockResolvedValue(errorResponse(401, "Invalid API Key"));

    const err = await groqTurn(config, messages, { sleep: sleepMock }).catch((e: AppError) => e);

    expect((err as AppError).message).toBe("Serviço de IA recusou a chamada (chave GROQ_API_KEY inválida).");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("saída limitada a 4.000 tokens: rascunho cabe e sobra folga no TPM", async () => {
    fetchMock.mockResolvedValue(okResponse({ reply: "ok", draft: null }));

    await groqTurn(config, messages, { sleep: sleepMock });

    const body = JSON.parse((fetchMock.mock.calls[0]![1]! as { body: string }).body);
    expect(body.max_completion_tokens).toBe(4000);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBeLessThanOrEqual(0.3);
  });

  it("categoryId numérica do modelo vira string no contrato (#n continua válido)", async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        reply: "ok",
        draft: {
          name: "Réplica M4 CQB",
          description: "d",
          shortDescription: "d",
          color: "",
          technical: {},
          categoryId: 3,
          brandId: "#1",
          condicao: "novo",
          estadoConservacao: "",
          tags: "",
          seoTitle: "",
          seoDescription: "",
          variantName: "Padrão",
          weightGrams: 0,
          uncertainFields: [],
        },
      }),
    );

    const turn = await groqTurn(config, messages, { sleep: sleepMock });

    expect(turn.draft).not.toBeNull();
    expect(turn.draft!.categoryId).toBe("3");
    expect(turn.draft!.brandId).toBe("#1");
  });
});
