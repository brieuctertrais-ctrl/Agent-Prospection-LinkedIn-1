import { corsHeaders } from "./cors.ts";

/** Error whose `code` is safe to show to the client. */
export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

// Errors raised by SQL functions (consume_ai_quota, triggers) that may be shown to clients.
const SQL_ERRORS: Record<string, number> = {
  rate_limited: 429,
  quota_exceeded: 429,
  service_busy: 503,
  subscription_required: 402,
  unauthorized: 401,
};

export function fromSqlError(message: string | undefined): HttpError | null {
  const code = Object.keys(SQL_ERRORS).find((k) => message?.includes(k));
  return code ? new HttpError(SQL_ERRORS[code], code) : null;
}

/** Generic error response: details go to the server log only (no secrets, no personal data). */
export function errorResponse(e: unknown, fn: string): Response {
  const err = e instanceof HttpError ? e : new HttpError(500, "internal_error");
  if (err.status >= 500) {
    console.error(JSON.stringify({ fn, error: e instanceof Error ? `${e.name}: ${e.message}` : "unknown" }));
  }
  return new Response(JSON.stringify({ error: err.code }), {
    status: err.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
