/**
 * The error envelope and code taxonomy.
 * Authoritative source: ssot/04-contracts/errors.md
 *
 * Clients branch on `code`, NEVER on `message` or status alone. Codes are stable
 * forever; messages are for humans and may be reworded.
 */

/** Every error code the API may emit. Adding one is an SSOT change first. */
export const ErrorCode = {
  // ---- auth & session ----
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  /** A spent refresh token was replayed. The whole family is revoked — treated as theft. */
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  CSRF_TOKEN_INVALID: 'CSRF_TOKEN_INVALID',
  DISCORD_OAUTH_FAILED: 'DISCORD_OAUTH_FAILED',
  DISCORD_GUILD_MEMBERSHIP_REQUIRED: 'DISCORD_GUILD_MEMBERSHIP_REQUIRED',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',

  // ---- authorization ----
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  /** Exists but is invisible to this caller. 404, never 403 — a 403 confirms existence. */
  FORUM_CATEGORY_FORBIDDEN: 'FORUM_CATEGORY_FORBIDDEN',
  RESOURCE_NOT_VISIBLE: 'RESOURCE_NOT_VISIBLE',
  OWNERSHIP_REQUIRED: 'OWNERSHIP_REQUIRED',

  // ---- CMDR verification ----
  CMDR_ALREADY_CLAIMED: 'CMDR_ALREADY_CLAIMED',
  /** Frontier surfaces token expiry as HTTP 422, not 401. Normalised here. */
  CAPI_TOKEN_EXPIRED: 'CAPI_TOKEN_EXPIRED',
  CAPI_UNAVAILABLE: 'CAPI_UNAVAILABLE',
  CAPI_NOT_APPROVED: 'CAPI_NOT_APPROVED',
  VERIFICATION_NONCE_EXPIRED: 'VERIFICATION_NONCE_EXPIRED',
  /** NOT an error state — the nonce simply is not in the Inara bio yet. */
  VERIFICATION_NONCE_NOT_FOUND: 'VERIFICATION_NONCE_NOT_FOUND',
  VERIFICATION_STALE: 'VERIFICATION_STALE',

  // ---- validation ----
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_SYSTEM_ADDRESS: 'INVALID_SYSTEM_ADDRESS',
  /** ~1,300 systems share names. Returns candidates; never guesses (INV-018). */
  AMBIGUOUS_SYSTEM_NAME: 'AMBIGUOUS_SYSTEM_NAME',
  UNKNOWN_COMMODITY: 'UNKNOWN_COMMODITY',
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  INVALID_LOADOUT_FORMAT: 'INVALID_LOADOUT_FORMAT',

  // ---- forum & content ----
  THREAD_LOCKED: 'THREAD_LOCKED',
  POST_TOO_LARGE: 'POST_TOO_LARGE',
  UPLOAD_REJECTED: 'UPLOAD_REJECTED',
  CONTENT_FLAGGED: 'CONTENT_FLAGGED',
  USER_MUTED: 'USER_MUTED',
  USER_BANNED: 'USER_BANNED',

  // ---- game data & trade ----
  /** Every candidate is older than maxDataAgeDays. Returned rather than serving stale data. */
  DATA_TOO_STALE: 'DATA_TOO_STALE',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  UPSTREAM_RATE_LIMITED: 'UPSTREAM_RATE_LIMITED',

  // ---- telemetry ----
  DEVICE_TOKEN_INVALID: 'DEVICE_TOKEN_INVALID',
  /** Rejected explicitly, never silently dropped (INV-013). */
  TELEMETRY_CATEGORY_NOT_CONSENTED: 'TELEMETRY_CATEGORY_NOT_CONSENTED',
  TELEMETRY_BATCH_TOO_LARGE: 'TELEMETRY_BATCH_TOO_LARGE',

  // ---- AI ----
  AI_OFFLINE: 'AI_OFFLINE',
  AI_DISABLED: 'AI_DISABLED',
  AI_WRITE_TOOLS_DISABLED: 'AI_WRITE_TOOLS_DISABLED',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_CONFIRMATION_EXPIRED: 'AI_CONFIRMATION_EXPIRED',
  /** The boundary working as designed. Audited as `denied` (INV-011). */
  AI_TOOL_NOT_PERMITTED: 'AI_TOOL_NOT_PERMITTED',

  // ---- infrastructure ----
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_DEGRADED: 'SERVICE_DEGRADED',
  MAINTENANCE_MODE: 'MAINTENANCE_MODE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The ONLY shape that leaves the API. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCodeName;
    /** Safe to display. Never a stack trace, SQL, or an internal hostname. */
    message: string;
    /** Correlates to the log line and the trace. Always present, including on 500s. */
    requestId: string;
    details?: Record<string, unknown> | null;
    retryable?: boolean;
    retryAfterSeconds?: number | null;
  };
}

/** Default HTTP status per code. A route may override where context demands it. */
export const ERROR_STATUS: Record<ErrorCodeName, number> = {
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  REFRESH_TOKEN_INVALID: 401,
  REFRESH_TOKEN_REUSED: 401,
  SESSION_REVOKED: 401,
  CSRF_TOKEN_INVALID: 403,
  DISCORD_OAUTH_FAILED: 502,
  DISCORD_GUILD_MEMBERSHIP_REQUIRED: 403,
  TWO_FACTOR_REQUIRED: 403,
  PERMISSION_DENIED: 403,
  FORUM_CATEGORY_FORBIDDEN: 404,
  RESOURCE_NOT_VISIBLE: 404,
  OWNERSHIP_REQUIRED: 403,
  CMDR_ALREADY_CLAIMED: 409,
  CAPI_TOKEN_EXPIRED: 401,
  CAPI_UNAVAILABLE: 503,
  CAPI_NOT_APPROVED: 503,
  VERIFICATION_NONCE_EXPIRED: 410,
  VERIFICATION_NONCE_NOT_FOUND: 422,
  VERIFICATION_STALE: 403,
  VALIDATION_FAILED: 400,
  INVALID_SYSTEM_ADDRESS: 400,
  AMBIGUOUS_SYSTEM_NAME: 409,
  UNKNOWN_COMMODITY: 404,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  INVALID_LOADOUT_FORMAT: 422,
  THREAD_LOCKED: 403,
  POST_TOO_LARGE: 400,
  UPLOAD_REJECTED: 400,
  CONTENT_FLAGGED: 422,
  USER_MUTED: 403,
  USER_BANNED: 403,
  DATA_TOO_STALE: 422,
  UPSTREAM_UNAVAILABLE: 503,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_RATE_LIMITED: 503,
  DEVICE_TOKEN_INVALID: 401,
  TELEMETRY_CATEGORY_NOT_CONSENTED: 403,
  TELEMETRY_BATCH_TOO_LARGE: 400,
  AI_OFFLINE: 503,
  AI_DISABLED: 503,
  AI_WRITE_TOOLS_DISABLED: 403,
  AI_RATE_LIMITED: 429,
  AI_CONFIRMATION_EXPIRED: 410,
  AI_TOOL_NOT_PERMITTED: 403,
  RATE_LIMITED: 429,
  SERVICE_DEGRADED: 503,
  MAINTENANCE_MODE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * A typed application error. The global exception filter converts this to the
 * envelope; nothing else constructs an error response by hand.
 */
export class AppError extends Error {
  readonly code: ErrorCodeName;
  readonly status: number;
  readonly details: Record<string, unknown> | null;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ErrorCodeName,
    message: string,
    opts: {
      details?: Record<string, unknown>;
      retryable?: boolean;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = opts.details ?? null;
    this.retryable = opts.retryable ?? false;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        details: this.details,
        retryable: this.retryable,
        retryAfterSeconds: this.retryAfterSeconds,
      },
    };
  }
}
