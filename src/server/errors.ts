import { ZodError } from "zod";
import { ModelInputError } from "@/lib/models/units";
import { PricingError } from "@/lib/models/pricing";
import { logger } from "@/lib/logger";

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in required") {
    super(message, 401, "unauthorized");
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that") {
    super(message, 403, "forbidden");
  }
}
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "not_found");
  }
}
export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(message, 409, code);
  }
}
export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message, 422, "validation_error");
  }
}
export class InsufficientInventoryError extends ConflictError {
  constructor(itemCode: string, available: number, requested: number) {
    super(
      `Insufficient ${itemCode}: ${available} available, ${requested} requested`,
      "insufficient_inventory",
    );
  }
}
export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests — slow down and retry later", 429, "rate_limited");
  }
}
export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503, "service_unavailable");
  }
}

/** Normalises any thrown value into a safe, user-facing AppError (never leaks internals). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return new ValidationError("Some fields are invalid", fieldErrors);
  }
  if (err instanceof ModelInputError || err instanceof PricingError) {
    return new ValidationError(err.message);
  }
  logger.error({ err }, "unhandled error");
  return new AppError("Something went wrong. Please try again.", 500, "internal_error");
}

export function errorResponse(err: unknown): Response {
  const appErr = toAppError(err);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (appErr instanceof RateLimitedError) headers["retry-after"] = String(appErr.retryAfterSeconds);
  const body: Record<string, unknown> = { error: { code: appErr.code, message: appErr.message } };
  if (appErr instanceof ValidationError && Object.keys(appErr.fieldErrors).length) {
    (body.error as Record<string, unknown>).fields = appErr.fieldErrors;
  }
  return new Response(JSON.stringify(body), { status: appErr.status, headers });
}
