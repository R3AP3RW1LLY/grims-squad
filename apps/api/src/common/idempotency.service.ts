import { createHash } from 'node:crypto';
import { AppError, ErrorCode } from '@grims/shared';

/**
 * P1.2 — idempotency keys.
 *
 * @INV-010 a mutating endpoint replayed with the same key and body returns the
 * original result without repeating the side effect.
 *
 * @INV-041 keys are namespaced by (userId, endpoint, key), so a key presented
 * by a different actor is never a replay.
 *
 * INV-041 is not tidiness. Under a global namespace (RED-TEAM R8) an attacker
 * who guesses or observes an officer's key receives that officer's STORED
 * RESPONSE BODY — and the replay path returns BEFORE any permission guard runs,
 * so nothing checks whether they were entitled to it. It is an authorization
 * bypass dressed as a caching feature, which is why the namespace is part of
 * the PRIMARY KEY rather than a filter someone can forget to apply.
 */

/** Every anonymous caller shares this namespace, so it must never store a body. */
export const ANONYMOUS_ACTOR = '00000000-0000-0000-0000-000000000000';

const KEY_MAX = 255;
const TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyRow {
  userId: string;
  endpoint: string;
  key: string;
  requestHash: string;
  responseCode: number;
  responseBody: unknown | null;
  expiresAt: Date;
}

export interface IIdempotencyStore {
  find(userId: string, endpoint: string, key: string): Promise<IdempotencyRow | null>;
  insert(row: IdempotencyRow): Promise<void>;
}

export interface IdempotencyArgs {
  readonly userId: string;
  readonly endpoint: string;
  readonly key: string;
  readonly body: unknown;
}

export interface HandlerResult {
  readonly status: number;
  readonly body: unknown;
}

export interface IdempotentResult {
  readonly status: number;
  readonly body: unknown;
  readonly replayed: boolean;
}

/** Stable across key ordering, so `{a,b}` and `{b,a}` are the same request. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export class IdempotencyService {
  constructor(private readonly store: IIdempotencyStore) {}

  async run(args: IdempotencyArgs, handler: () => Promise<HandlerResult>): Promise<IdempotentResult> {
    const key = typeof args.key === 'string' ? args.key.trim() : '';
    if (key === '' || key.length > KEY_MAX) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Idempotency-Key must be 1-${KEY_MAX} characters.`,
      );
    }

    const requestHash = createHash('sha256').update(canonical(args.body)).digest('hex');
    const existing = await this.store.find(args.userId, args.endpoint, key);

    if (existing !== null) {
      if (existing.requestHash !== requestHash) {
        // Same key, different body. Returning the first result would silently
        // discard the second request; running it would break the key's promise.
        throw new AppError(
          ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
          'This idempotency key was already used with a different request body.',
        );
      }
      return { status: existing.responseCode, body: existing.responseBody, replayed: true };
    }

    // Failures are deliberately NOT recorded. Caching a 500 would make a
    // transient upstream blip permanent for that key, and the caller's only
    // escape would be to invent a new key — which defeats the retry safety the
    // key existed to provide.
    const result = await handler();

    const anonymous = args.userId === ANONYMOUS_ACTOR;
    await this.store.insert({
      userId: args.userId,
      endpoint: args.endpoint,
      key,
      requestHash,
      responseCode: result.status,
      // Anonymous callers share one namespace, so a stored body is readable by
      // anyone who reuses the key. Suppressing the duplicate side effect is the
      // part that matters; returning the body is a convenience we give up.
      responseBody: anonymous ? null : (result.body ?? null),
      expiresAt: new Date(Date.now() + TTL_MS),
    });

    return {
      status: result.status,
      body: anonymous ? result.body : result.body,
      replayed: false,
    };
  }
}
