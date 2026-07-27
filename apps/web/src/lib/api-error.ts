/**
 * Reads the message out of an API error response.
 *
 * ★ WHY THIS EXISTS ★
 *
 * The API answers with an ENVELOPE — `{ error: { code, message, requestId } }`
 * — and three separate forms were reading `json.message` off the top level.
 * That is always undefined, so every one of them fell through to its own
 * generic fallback.
 *
 * The result: a member linking an Inara key saw "That did not work." while the
 * server had said "Could not reach Inara to check that key. Try again in a few
 * minutes." One of those is actionable and the other is not, and the useful
 * message was being thrown away at the last step by all three forms
 * independently.
 *
 * Written once, here, so a fourth form cannot reinvent the same mistake.
 */
export interface ApiErrorShape {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    retryable?: boolean;
    retryAfterSeconds?: number | null;
  };
  /** Some non-API errors (a proxy, a framework 404) are flat. Read both. */
  message?: string;
}

export interface ParsedApiError {
  readonly message: string;
  readonly code: string | null;
  /** Present on real API errors. Worth showing so a member can quote it. */
  readonly requestId: string | null;
  readonly retryable: boolean;
}

/** Never throws, and never returns an empty string. */
export function parseApiError(body: unknown, fallback = 'That did not work.'): ParsedApiError {
  const b = (body ?? {}) as ApiErrorShape;
  const envelope = b.error;

  const message =
    (typeof envelope?.message === 'string' && envelope.message.trim() !== ''
      ? envelope.message
      : undefined) ??
    // A flat `message` covers responses that did not come from our own error
    // filter — a framework 404, or a proxy in front of us.
    (typeof b.message === 'string' && b.message.trim() !== '' ? b.message : undefined) ??
    fallback;

  return {
    message,
    code: envelope?.code ?? null,
    requestId: envelope?.requestId ?? null,
    // Absent means NOT retryable. Assuming otherwise invites a UI that offers
    // "try again" for something that will never succeed.
    retryable: envelope?.retryable === true,
  };
}

/** Reads a fetch Response, returning the parsed error. Safe on a non-JSON body. */
export async function errorFromResponse(res: Response, fallback?: string): Promise<ParsedApiError> {
  const body = await res.json().catch(() => ({}));
  return parseApiError(body, fallback);
}
