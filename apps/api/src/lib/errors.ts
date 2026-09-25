export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = "authentication required") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "not allowed") => new AppError(403, "forbidden", message);
export const notFound = (what = "resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (code: string, message?: string) => new AppError(409, code, message);
export const paymentRequired = (code: string, message?: string) => new AppError(402, code, message);

export function assertFound<T>(value: T | undefined | null, what?: string): T {
  if (value === undefined || value === null) throw notFound(what);
  return value;
}
