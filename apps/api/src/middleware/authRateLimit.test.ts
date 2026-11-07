import { describe, it, expect } from "vitest";
import { authRateLimit } from "./authRateLimit.js";

/** Fakes mínimos: o limiter só usa request.ip e o reply (header/status/send). */
function fakeRequest(ip: string) {
  return { ip } as never;
}

function fakeReply() {
  const sent: {
    statusCode: number;
    payload: unknown;
    headers: Record<string, string>;
  }[] = [];

  const reply = {
    headers: {} as Record<string, string>,
    header(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return reply;
    },
    status(code: number) {
      sent.push({ statusCode: code, payload: undefined, headers: reply.headers });
      return reply;
    },
    send(payload: unknown) {
      const last = sent[sent.length - 1];
      if (last) last.payload = payload;
      return reply;
    },
    sent,
  };

  return reply;
}

describe("authRateLimit", () => {
  it("libera as tentativas dentro do limite e bloqueia a próxima", async () => {
    const limit = authRateLimit({
      scope: "test.login",
      max: 5,
      windowMs: 60_000,
      blockMs: 15 * 60_000,
      message: "Muitas tentativas. Espera 15 minutos.",
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const reply = fakeReply();
      await limit(fakeRequest("203.0.113.10"), reply as never);
      expect(reply.sent).toHaveLength(0);
    }

    const blocked = fakeReply();
    await limit(fakeRequest("203.0.113.10"), blocked as never);

    expect(blocked.sent).toHaveLength(1);
    expect(blocked.sent[0]?.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("900");

    const payload = blocked.sent[0]?.payload as {
      error: { code: string; message: string; details: { retryAfterSeconds: number } };
    };
    expect(payload.error.code).toBe("rate_limited");
    expect(payload.error.message).toContain("15 minutos");
    expect(payload.error.details.retryAfterSeconds).toBe(900);
  });

  it("separa os escopos — login não bloqueia cadastro do mesmo IP", async () => {
    const login = authRateLimit({
      scope: "test.scope.login",
      max: 1,
      windowMs: 60_000,
      blockMs: 60_000,
      message: "bloqueado",
    });
    const register = authRateLimit({
      scope: "test.scope.register",
      max: 1,
      windowMs: 60_000,
      blockMs: 60_000,
      message: "bloqueado",
    });

    const loginReply = fakeReply();
    await login(fakeRequest("203.0.113.20"), loginReply as never);
    await login(fakeRequest("203.0.113.20"), loginReply as never);
    expect(loginReply.sent).toHaveLength(1);

    const registerReply = fakeReply();
    await register(fakeRequest("203.0.113.20"), registerReply as never);
    expect(registerReply.sent).toHaveLength(0);
  });
});
