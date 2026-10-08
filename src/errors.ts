import { BehavrApiError } from "behavr-sdk";

/** Replace every occurrence of the secret with "***". */
export function redact(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("***");
}

/** HTTP status of a BEHAVR API error, or undefined for network/other errors. */
export function errorStatus(err: unknown): number | undefined {
  return err instanceof BehavrApiError ? err.status : undefined;
}

function payloadMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const detail = p.detail;
  if (typeof detail === "string" && detail) return detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    if (typeof d.message === "string" && d.message) return d.message;
    if (typeof d.error === "string" && d.error) return d.error;
  }
  if (typeof p.message === "string" && p.message) return p.message;
  if (typeof p.error === "string" && p.error) return p.error;
  return undefined;
}

/** Human-readable error text with the API key redacted. */
export function formatError(err: unknown, apiKey: string | undefined): string {
  let text: string;
  if (err instanceof BehavrApiError) {
    const message = payloadMessage(err.payload);
    // err.message already carries the "BEHAVR API error (status): " prefix.
    text = message ? `BEHAVR API error (${err.status}): ${message}` : err.message;
  } else if (err instanceof Error) {
    text = err.message || err.name;
  } else {
    text = String(err);
  }
  return redact(text, apiKey);
}
