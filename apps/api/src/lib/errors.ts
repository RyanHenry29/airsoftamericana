export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = "Não autenticado") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "Sem permissão") =>
  new AppError(403, "forbidden", message);
export const notFound = (message = "Não encontrado") =>
  new AppError(404, "not_found", message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
export const serviceUnavailable = (code: string, message: string, details?: unknown) =>
  new AppError(503, code, message, details);
export const internalError = (message = "Erro interno") =>
  new AppError(500, "internal_error", message);