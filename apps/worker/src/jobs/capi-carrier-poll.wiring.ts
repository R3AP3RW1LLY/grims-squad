import type { PrismaClient } from '@grims/db';
import type { TokenCipher } from '@grims/shared/server';
import { formatCallsign, normaliseCallsign } from '@grims/shared/carrier';
import { PrismaCapiPollStore, type CapiConfig } from './capi-journal-poll.wiring.js';
import type { CarrierCandidate, CarrierPollStore, CargoLine } from './capi-carrier-poll.js';

/**
 * The carrier poller's store — everything it needs out of the database and nothing it does not.
 *
 * ★ THE TOKEN IS BORROWED, NOT REIMPLEMENTED ★
 *
 * `accessToken` is the one genuinely dangerous method in either poller: it decides when to spend a
 * refresh, takes an advisory lock so two jobs cannot race a rotating token, re-reads inside that
 * lock, and marks a grant stale at Frontier's 25-day ceiling. A second copy of that reasoning would
 * be wrong the first time either changed, and the symptom would be a member silently disconnected.
 *
 * So this delegates to the journal poller's store rather than restating it. The two jobs share one
 * answer to "what token may I use", which is the only safe number of answers.
 */
export class PrismaCarrierPollStore implements CarrierPollStore {
  readonly #tokens: PrismaCapiPollStore;

  constructor(
    private readonly db: PrismaClient,
    cipher: TokenCipher,
    config: CapiConfig,
    connectionString = process.env['DATABASE_URL'] ?? '',
  ) {
    this.#tokens = new PrismaCapiPollStore(db, cipher, config, connectionString);
  }

  accessToken(userId: string): Promise<string | null> {
    return this.#tokens.accessToken(userId);
  }

  /**
   * cAPI-linked members plausibly connected to a carrier attached to a live build.
   *
   * ★ PLAUSIBLY, BECAUSE THE HUB DOES NOT KNOW WHO OWNS A CARRIER ★
   *
   * Two things are recorded and neither is ownership: who PUSHED a manifest for it (their app was
   * running while they were aboard, which is close) and who ATTACHED it to the build (which may be
   * any officer who typed a callsign). Frontier settles it — `/fleetcarrier` answers only about the
   * caller's own carrier, and the job matches the callsign it returns back against the attached set
   * before storing anything.
   *
   * ★ AND ONLY WHILE A BUILD IS RUNNING ★
   *
   * The scope the owner chose. A completed or abandoned build is not a reason to spend a request
   * against a limit the whole squadron shares.
   */
  async candidates(): Promise<readonly CarrierCandidate[]> {
    const rows = await this.db.$queryRawUnsafe<Array<{ user_id: string; cmdr_name: string }>>(
      `SELECT DISTINCT v.user_id, v.cmdr_name::text AS cmdr_name
         FROM cmdr_verifications v
        WHERE v.method = 'fdev_capi'
          AND v.revoked_at IS NULL
          AND v.is_stale = false
          AND v.fdev_refresh_enc IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM colony_carriers c
              JOIN colony_projects p ON p.id = c.project_id
             WHERE p.completed_at IS NULL
               AND p.abandoned_at IS NULL
               AND (
                 c.added_by_id = v.user_id
                 OR EXISTS (
                   SELECT 1 FROM colony_carrier_cargo g
                    WHERE g.market_id = c.market_id AND g.updated_by_id = v.user_id
                 )
               )
          )
        ORDER BY v.user_id`,
    );

    return rows.map((r) => ({ userId: r.user_id, cmdrName: r.cmdr_name }));
  }

  /**
   * The catalogue's market id for a callsign.
   *
   * ★ THROUGH THE CATALOGUE, NOT FROM THE RESPONSE ★
   *
   * Frontier's payload carries a market id of its own, and using it would be the obvious thing. But
   * every other carrier query in the platform — the search, the project page, the combined run —
   * keys on the catalogue's. A row written under a market id the catalogue does not carry is a row
   * no board can join to: invisible, and silently so.
   *
   * Every carrier's catalogue name IS its callsign — 48,360 of 48,360 rows in the dev mirror match
   * `XXX-XXX` exactly — so this is an equality on `knowledge_items_name_idx`.
   */
  async marketIdForCallsign(callsign: string): Promise<string | null> {
    const chars = normaliseCallsign(callsign);
    if (chars.length !== 6) return null;

    const rows = await this.db.$queryRawUnsafe<Array<{ market_id: string }>>(
      `SELECT data->>'marketId' AS market_id
         FROM knowledge_items
        WHERE source = 'galaxy' AND kind = 'station'
          AND name IN ($1, $2)
          AND data->>'marketId' IS NOT NULL
        LIMIT 1`,
      formatCallsign(chars),
      chars,
    );

    const id = rows[0]?.market_id;
    return id === undefined || id === null || id === '' ? null : id;
  }

  async isAttachedToLiveBuild(marketId: string): Promise<boolean> {
    if (!/^\d+$/.test(marketId)) return false;

    const rows = await this.db.$queryRawUnsafe<Array<{ yes: number }>>(
      `SELECT 1 AS yes
         FROM colony_carriers c
         JOIN colony_projects p ON p.id = c.project_id
        WHERE c.market_id = $1::bigint
          AND p.completed_at IS NULL
          AND p.abandoned_at IS NULL
        LIMIT 1`,
      marketId,
    );
    return rows.length > 0;
  }

  /**
   * Replaces this carrier's cAPI rows with exactly what Frontier reported.
   *
   * ★ DELETE THEN INSERT, IN ONE TRANSACTION ★
   *
   * An upsert alone would be wrong in the one way that matters. `colony_carrier_cargo` is keyed
   * (market, commodity, source), so upserting the manifest updates what is present and LEAVES
   * BEHIND every commodity that has since been sold — turning the one source that can prove a hold
   * empty into another floor, which is precisely the failure it was brought in to fix.
   *
   * The delete is scoped to `source = 'capi'`: a crew member's hand and the owner's journal are
   * other sources' statements and none of this job's business.
   *
   * In a transaction because the window between the two is a carrier that reads as empty. Small,
   * but it lands on a board that says "nothing aboard" — a sentence somebody cancels a run over.
   */
  async replaceCapiCargo(input: {
    readonly marketId: string;
    readonly ownerId: string;
    readonly lines: readonly CargoLine[];
    readonly at: Date;
  }): Promise<void> {
    if (!/^\d+$/.test(input.marketId)) return;

    const clean = input.lines
      .map((l) => ({ commodity: l.commodity.trim(), tonnes: Math.trunc(l.tonnes) }))
      .filter((l) => l.commodity !== '' && Number.isFinite(l.tonnes) && l.tonnes > 0);

    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM colony_carrier_cargo WHERE market_id = $1::bigint AND source = 'capi'`,
        input.marketId,
      );

      /*
       * ★ AN ABSENT ROW IS NOT A ZERO, AND THAT DEFEATED THE WHOLE FEATURE — 2026-08-17 ★
       *
       * Deleting the rows and writing only what Frontier reported LOOKS like it says "the rest is
       * gone". It does not. `effectiveTonnes` reads `capi` as `pick(commodity, 'capi')`, which is
       * NULL when there is no row — and null falls straight through to `max(journal, mirror)`. So
       * "Frontier says there is no Steel aboard" arrived as "cAPI has never mentioned Steel", and
       * the fortnight-old journal figure won.
       *
       * The one thing this source exists to do — prove a hold empty — was the one thing it could
       * not do. The integration test asserted the ROWS were removed and never asserted what the
       * board then READS, which is the gap that let it ship.
       *
       * So the silence is written down. A commodity another source still claims, which Frontier's
       * complete manifest omits, gets an explicit cAPI ZERO — exactly the way a crew member's
       * manual zero is "a real statement that retires a stale claim" rather than an absence. It
       * also renders on the carriers tab, so a member can see the correction that changed their
       * shopping list instead of watching a number move for no visible reason.
       *
       * ★ BOUNDED, AND HONEST ABOUT WHAT IT DOES NOT COVER ★
       *
       * Only commodities with an existing row on THIS carrier — never the whole commodity list, and
       * never a row invented for something nobody has ever claimed. The market mirror lives in a
       * different table and is not corrected here: its rows are public sell orders that EDDN
       * refreshes on their own, and reaching across to zero them is a larger claim than this job
       * has evidence for.
       */
      if (clean.length === 0) {
        await tx.$executeRawUnsafe(
          `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
           SELECT DISTINCT market_id, commodity, 'capi', 0, $2::uuid, $3
             FROM colony_carrier_cargo
            WHERE market_id = $1::bigint AND source IN ('journal', 'manual')
           ON CONFLICT (market_id, commodity, source) DO UPDATE SET
             tonnes = 0, updated_by_id = EXCLUDED.updated_by_id, updated_at = EXCLUDED.updated_at`,
          input.marketId,
          input.ownerId,
          input.at,
        );
      } else {
        await tx.$executeRawUnsafe(
          `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
           SELECT DISTINCT market_id, commodity, 'capi', 0, $2::uuid, $3
             FROM colony_carrier_cargo
            WHERE market_id = $1::bigint
              AND source IN ('journal', 'manual')
              AND lower(commodity) <> ALL($4::text[])
           ON CONFLICT (market_id, commodity, source) DO UPDATE SET
             tonnes = 0, updated_by_id = EXCLUDED.updated_by_id, updated_at = EXCLUDED.updated_at`,
          input.marketId,
          input.ownerId,
          input.at,
          clean.map((l) => l.commodity.toLowerCase()),
        );
      }

      for (const line of clean) {
        await tx.$executeRawUnsafe(
          `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
           VALUES ($1::bigint, $2, 'capi', $3, $4::uuid, $5)
           ON CONFLICT (market_id, commodity, source) DO UPDATE SET
             tonnes = EXCLUDED.tonnes,
             updated_by_id = EXCLUDED.updated_by_id,
             updated_at = EXCLUDED.updated_at`,
          input.marketId,
          line.commodity,
          line.tonnes,
          input.ownerId,
          input.at,
        );
      }
    });
  }
}
