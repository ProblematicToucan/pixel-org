/**
 * Application HTTP error: carries a safe client message and optional underlying cause for logging/healer.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly clientMessage: string,
    options?: { cause?: unknown }
  ) {
    const cause = options?.cause;
    super(
      cause instanceof Error ? cause.message : clientMessage,
      cause !== undefined ? { cause } : undefined
    );
    this.name = "HttpError";
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack;
    }
  }
}
