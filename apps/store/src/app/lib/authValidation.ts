// language: TS, file: apps/store/src/app/lib/authValidation.ts, target: Next.js App Router
/**
 * Regras de validação dos formulários de acesso.
 *
 * Espelham os schemas do servidor (packages/shared/src/schemas.ts): o cliente
 * valida para dar feedback na hora, o servidor revalida e é a fonte da verdade.
 * Nada de dependência nova — funções puras, sem zod no bundle da loja.
 */

export type AuthField =
  | "name"
  | "email"
  | "phone"
  | "cpf"
  | "password"
  | "confirm";

export const AUTH_MESSAGES = {
  nameRequired: "Coloca seu nome completo, igual ao documento.",
  nameTooLong: "O nome pode ter até 120 caracteres.",
  emailRequired: "Digite o e-mail da sua conta.",
  emailInvalid: "Esse e-mail não está no formato certo. Ex.: nome@dominio.com.br",
  passwordRequired: "Digite sua senha.",
  passwordShort: "A senha precisa de no mínimo 8 caracteres.",
  passwordLong: "A senha pode ter até 128 caracteres.",
  confirmRequired: "Repete a senha pra gente conferir.",
  confirmMismatch: "As senhas não batem. Repete a segunda.",
  cpfInvalid: "O CPF tem 11 dígitos — ou deixa em branco.",
  phoneTooLong: "O telefone tem até 11 dígitos.",
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Mensagem de erro do campo — string vazia quando o valor está válido. */
export function validateAuthField(field: AuthField, value: string): string {
  const trimmed = value.trim();

  switch (field) {
    case "name":
      if (trimmed.length < 2) return AUTH_MESSAGES.nameRequired;
      if (trimmed.length > 120) return AUTH_MESSAGES.nameTooLong;
      return "";

    case "email":
      if (!trimmed) return AUTH_MESSAGES.emailRequired;
      if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
        return AUTH_MESSAGES.emailInvalid;
      }
      return "";

    case "password":
      if (!value) return AUTH_MESSAGES.passwordRequired;
      if (value.length < 8) return AUTH_MESSAGES.passwordShort;
      if (value.length > 128) return AUTH_MESSAGES.passwordLong;
      return "";

    case "confirm":
      if (!value) return AUTH_MESSAGES.confirmRequired;
      return "";

    case "cpf":
      if (!trimmed) return "";
      if (!/^\d{11}$/.test(trimmed)) return AUTH_MESSAGES.cpfInvalid;
      return "";

    case "phone":
      if (!trimmed) return "";
      if (trimmed.replace(/\D/g, "").length > 11) return AUTH_MESSAGES.phoneTooLong;
      return "";
  }
}

export type AuthValues = {
  name: string;
  email: string;
  phone: string;
  cpf: string;
  password: string;
  confirm: string;
};

export type AuthErrors = Partial<Record<AuthField, string>>;

/** Erros de todos os campos de uma vez — usado no submit e no resumo. */
export function validateAuthValues(values: AuthValues): AuthErrors {
  const errors: AuthErrors = {};

  const name = validateAuthField("name", values.name);
  if (name) errors.name = name;

  const email = validateAuthField("email", values.email);
  if (email) errors.email = email;

  const phone = validateAuthField("phone", values.phone);
  if (phone) errors.phone = phone;

  const cpf = validateAuthField("cpf", values.cpf);
  if (cpf) errors.cpf = cpf;

  const password = validateAuthField("password", values.password);
  if (password) errors.password = password;

  const confirm = validateAuthField("confirm", values.confirm);
  if (confirm) errors.confirm = confirm;
  else if (values.confirm !== values.password) {
    errors.confirm = AUTH_MESSAGES.confirmMismatch;
  }

  return errors;
}

/** Força de 0 a 4 — usada no medidor de senha. */
export function passwordStrength(password: string): { level: number; label: string } {
  if (!password) return { level: 0, label: "Sem senha" };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;

  const level = Math.min(score, 4);
  const labels = ["", "Fraca", "Razoável", "Forte", "Alta"] as const;
  return { level, label: labels[level] ?? "" };
}

/** Máscaras de digitação — só display, o valor que vai pro servidor são dígitos. */
export function maskCpf(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return digits;
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}
