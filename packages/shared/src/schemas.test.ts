import { describe, it, expect } from "vitest";
import { emailSchema, loginSchema, registerSchema, updateProfileSchema, savedAddressSchema } from "./schemas.js";

/** Primeiro erro do Zod — pode não existir, e o teste precisa falhar se faltar. */
function firstMessage(issues: { message: string }[]): string | undefined {
  return issues[0]?.message;
}

describe("schemas de acesso", () => {
  it("recusa e-mail fora do formato com mensagem em português", () => {
    const parsed = emailSchema.safeParse("nao-e-email");
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstMessage(parsed.error.issues)).toBe(
        "E-mail inválido — confere o formato",
      );
    }
  });

  it("normaliza o e-mail (trim + lowercase)", () => {
    expect(emailSchema.parse("  Cliente@Demo.COM ")).toBe("cliente@demo.com");
  });

  it("exige nome com 2 caracteres ou mais", () => {
    const parsed = registerSchema.safeParse({
      name: "A",
      email: "cliente@demo.com",
      password: "Cliente123!",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstMessage(parsed.error.issues)).toBe("Coloque seu nome completo");
    }
  });

  it("exige senha de no mínimo 8 caracteres no cadastro", () => {
    const parsed = registerSchema.safeParse({
      name: "Cliente Demo",
      email: "cliente@demo.com",
      password: "123",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstMessage(parsed.error.issues)).toBe("Mínimo de 8 caracteres");
    }
  });

  it("recusa CPF com quantidade de dígitos diferente de 11", () => {
    const parsed = registerSchema.safeParse({
      name: "Cliente Demo",
      email: "cliente@demo.com",
      password: "Cliente123!",
      cpf: "123",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstMessage(parsed.error.issues)).toBe("CPF deve conter 11 dígitos");
    }
  });

  it("no login basta a senha existir — a política vale na criação", () => {
    expect(loginSchema.safeParse({ email: "cliente@demo.com", password: "a" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "cliente@demo.com", password: "" }).success).toBe(false);
  });
});

describe("schemas da conta (perfil + endereço salvo)", () => {
  it("updateProfileSchema exige nome e aceita CPF/telefone vazios", () => {
    expect(updateProfileSchema.safeParse({ name: "Jo", cpf: "", phone: "" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ name: "J", cpf: "" }).success).toBe(false);
    const badCpf = updateProfileSchema.safeParse({ name: "Joana Pereira", cpf: "123" });
    expect(badCpf.success).toBe(false);
    if (!badCpf.success) expect(firstMessage(badCpf.error.issues)).toBe("CPF deve conter 11 dígitos");
    const longPhone = updateProfileSchema.safeParse({ name: "Joana Pereira", phone: "9".repeat(21) });
    expect(longPhone.success).toBe(false);
  });

  it("savedAddressSchema valida CEP de 8 dígitos e UF de 2 letras", () => {
    const ok = savedAddressSchema.safeParse({
      recipient: "Joana Pereira",
      zip: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      isDefault: true,
    });
    expect(ok.success).toBe(true);
    const badZip = savedAddressSchema.safeParse({
      recipient: "Joana Pereira",
      zip: "01310",
      street: "Avenida Paulista",
      number: "1000",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
    expect(badZip.success).toBe(false);
    const badState = savedAddressSchema.safeParse({
      recipient: "Joana Pereira",
      zip: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SÃO PAULO",
    });
    expect(badState.success).toBe(false);
  });
});
