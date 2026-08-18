import type { PrismaClient } from '@grims/db';
import {
  EMPTY_LEDGER,
  probeSystemViaSpansh,
  spanshCloser,
  type SiteLedger,
  type WatchDeps,
  type WatchedProject,
} from './spansh-watch.js';

/**
 * Where the watch gets its projects, keeps its ledger, and puts its verdicts.
 *
 * The judgement itself is next door and has no database, no clock and no network — every refusal it
 * can produce is reachable from a test. This file is the dull half deliberately.
 */

/**
 * The ledger lives in `site_config` under one key.
 *
 * ★ ONE ROW, NOT A TABLE ★
 *
 * It is at most a few dozen small objects, it is written once per sweep, and nothing joins to it. A
 * table would be a migration, an index and a model for data whose only reader is the function that
 * wrote it.
 *
 * ★ AND THE VALUE IS jsonb, WHICH HAS BITTEN THIS CODEBASE BEFORE ★
 *
 * Two writes once went out passing a bare string to this column: the companion release
 * announcement and the bounty board's anchor count. Postgres refused both casts, both callers
 * swallowed the error by design, and so a release announced nothing while a board reported "no
 * active projects" with three running. The object is stringified and cast explicitly here.
 */
export const SPANSH_LEDGER_KEY = 'colony.spansh_watch.ledger';

function readLedgerValue(value: unknown): Record<string, SiteLedger> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: Record<string, SiteLedger> = {};
  for (const [projectId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    out[projectId] = {
      seenAt: typeof r['seenAt'] === 'string' ? r['seenAt'] : null,
      misses: typeof r['misses'] === 'number' ? r['misses'] : 0,
      missAt: typeof r['missAt'] === 'string' ? r['missAt'] : null,
      /*
       * Repaired on read rather than trusted. A ledger this job wrote is well formed; a ledger
       * somebody edited by hand, or one left by an older build, must degrade to "we have seen
       * nothing" — which closes nothing — instead of throwing and taking the sweep down.
       */
      witnesses: Array.isArray(r['witnesses'])
        ? (r['witnesses'] as unknown[]).filter((w): w is string => typeof w === 'string')
        : [],
    };
  }
  return out;
}

export function spanshWatchDeps(db: PrismaClient): WatchDeps {
  return {
    /**
     * Every live build, with the two pieces of first-party evidence that can overrule an absence.
     *
     * `completed_at IS NULL AND abandoned_at IS NULL` — a build somebody has already closed is not
     * this job's business, and neither is one the squadron gave up on.
     */
    open: async (): Promise<readonly WatchedProject[]> => {
      const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT p.id::text        AS project_id,
                p.title,
                p.system_name,
                p.station_name,
                p.market_id,
                /*
                 * ★ THE TWO PIECES OF FIRST-PARTY EVIDENCE, AND WHERE THEY REALLY LIVE ★
                 *
                 * A depot reading is colony_needs.observed_at: those rows exist only because a
                 * commander was physically docked at the construction site and their journal
                 * reported what it still wanted. That is proof the site EXISTS, and it beats a
                 * third-party aggregator not listing it.
                 *
                 * A delivery is colony_contributions.delivered_at - somebody handed it cargo.
                 * Same argument, same strength.
                 */
                (SELECT max(n.observed_at) FROM colony_needs n WHERE n.project_id = p.id)
                                  AS last_depot_at,
                (SELECT max(c.delivered_at) FROM colony_contributions c WHERE c.project_id = p.id)
                                  AS last_delivery_at
           FROM colony_projects p
          WHERE p.completed_at IS NULL
            AND p.abandoned_at IS NULL
          ORDER BY p.system_name, p.id`,
      );

      return rows.map((r) => ({
        projectId: String(r['project_id']),
        title: String(r['title'] ?? ''),
        systemName: String(r['system_name'] ?? ''),
        stationName: r['station_name'] == null ? null : String(r['station_name']),
        marketId: r['market_id'] == null ? null : BigInt(String(r['market_id'])),
        lastDepotAt: (r['last_depot_at'] as Date | null) ?? null,
        lastDeliveryAt: (r['last_delivery_at'] as Date | null) ?? null,
      }));
    },

    probe: (systemName: string) => probeSystemViaSpansh(systemName),

    readLedger: async (): Promise<Record<string, SiteLedger>> => {
      const [row] = await db.$queryRawUnsafe<Array<{ value: unknown }>>(
        `SELECT value FROM site_config WHERE key = $1`,
        SPANSH_LEDGER_KEY,
      );
      return readLedgerValue(row?.value ?? null);
    },

    writeLedger: async (ledgers: Record<string, SiteLedger>): Promise<void> => {
      await db.$executeRawUnsafe(
        `INSERT INTO site_config (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        SPANSH_LEDGER_KEY,
        JSON.stringify(ledgers),
      );
    },

    close: spanshCloser(db),
    now: () => new Date(),
  };
}

/** Fallback for a ledger that has never been written. Exported so the daemon can log it plainly. */
export const NO_LEDGER = EMPTY_LEDGER;
