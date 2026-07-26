import { z } from 'zod';

/**
 * Shared primitives. Every external input is parsed by one of these at the
 * boundary before it reaches business logic (ssot/CONVENTIONS.md).
 */

/**
 * A SystemAddress or MarketId on the wire.
 *
 * ALWAYS a decimal string, never a JSON number — these exceed 2^53 and a number
 * silently corrupts them (INV-021). This is not defensive style; a rounded
 * SystemAddress creates a row keyed to a system that does not exist in the game.
 */
export const bigIntString = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer as a decimal string');

export const systemAddress = bigIntString.describe('SystemAddress as a decimal string');
export const marketId = bigIntString.describe('MarketId as a decimal string');

/** A permission mask on the wire. Decimal string for the same reason (INV-006). */
export const permissionMask = bigIntString.describe('Permission bitmask as a decimal string');

export const uuid = z.string().uuid();
export const slug = z.string().regex(/^[a-z0-9-]+$/);

/** UTC ISO-8601. Every timestamp, inbound and outbound (ssot/CONVENTIONS.md). */
export const isoDateTime = z.string().datetime({ offset: true });

/**
 * Data freshness. Attached to EVERY market-derived payload — a price without an
 * age is a defect, not a missing nicety (INV-004).
 */
export const freshnessBand = z.enum(['fresh', 'aging', 'stale']);

export const freshness = z.object({
  dataAgeHours: z.number().nonnegative(),
  source: z.enum(['own_eddn', 'ardent', 'edsm', 'spansh', 'capi', 'inara', 'manual']),
  observedAt: isoDateTime,
  band: freshnessBand,
});
export type Freshness = z.infer<typeof freshness>;

/** fresh <24h, aging <7d, stale beyond. Thresholds are seeded in site_config. */
export function freshnessBandFor(dataAgeHours: number): z.infer<typeof freshnessBand> {
  if (dataAgeHours < 24) return 'fresh';
  if (dataAgeHours < 24 * 7) return 'aging';
  return 'stale';
}

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    hasMore: z.boolean(),
  });

/**
 * Landing pad size: 1 small, 2 medium, 3 large.
 * A large ship cannot dock where the max pad is smaller — ignoring this is one of
 * the two ways a "profitable" route turns out to be unusable (INV-026).
 */
export const landingPad = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const healthCheck = z.object({
  status: z.enum(['ok', 'degraded', 'down', 'offline']),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

export const health = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  checks: z.record(z.string(), healthCheck),
});
export type Health = z.infer<typeof health>;
export type HealthCheck = z.infer<typeof healthCheck>;
