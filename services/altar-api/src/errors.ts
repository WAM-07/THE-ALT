/** Errors reach clients as { error: { code, message, details?, requestId } }, like every ALT service. */
export class AltarError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AltarError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, message: string) => new AltarError(409, code, message);
