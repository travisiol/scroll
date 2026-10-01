/** An error that is safe to show to the person who caused it. */
export class AppError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function isAppError(error: unknown): error is AppError {
  // Matched by name too: after a dev hot reload an older copy of the class can be thrown.
  return error instanceof AppError || (error instanceof Error && error.name === "AppError");
}
