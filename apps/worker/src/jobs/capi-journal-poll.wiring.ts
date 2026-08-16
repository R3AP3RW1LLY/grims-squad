import { Client } from 'pg';
import {
  shouldRefresh,
  withCapiRefreshLock,
  type LockSession,
  type PrismaClient,
} from '@grims/db';
import { refreshAccess, tokenState, CapiAuthError } from '@grims/ed-clients';
import type { TokenCipher } from '@grims/shared/server';
import {
  contentFingerprint,
  type CapiPollStore,
  type MemberPollState,
  type PollableMember,
  type TelemetryRow,
} from './capi-journal-poll.js';

/**
 * The poller's store — everything it needs out of the database, and nothing it does not.
 *
 * ★ THE JOB ITSELF KNOWS NO SQL, ON PURPOSE ★
 *
 * `capi-journal-poll.ts` is pure and has 27 tests behind it because it takes this interface rather
 * than a database. All of the reasoning that is hard — idempotence across two devices, pacing a
 * shared rate limit, stopping a dead grant, honouring consent — lives there and is tested without
 * Postgres. This file is only the plumbing, and it is deliberately dull.
 *
 * ★ EXCEPT FOR ONE METHOD ★
 *
 * `accessToken` is where the danger is, and it is documented at the method.
 */

export interface CapiConfig {
  readonly authBase: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export class PrismaCapiPollStore implements CapiPollStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly cipher: TokenCipher,
    private readonly config: CapiConfig,
    private readonly connectionString = process.env['DATABASE_URL'] ?? '',
  ) {}

  /**
   * Members with a live Frontier link.
   *
   * `isStale` is set once the 25-day ceiling passes, and it is what takes somebody out of this list
   * for good rather than having every run rediscover that their grant is dead.
   */
  async livePollable(): Promise<readonly PollableMember[]> {
    const rows = await this.db.$queryRawUnsafe<Array<{ user_id: string; cmdr_name: string }>>(
      `SELECT v.user_id, v.cmdr_name::text AS cmdr_name
         FROM cmdr_verifications v
        WHERE v.method = 'fdev_capi'
          AND v.revoked_at IS NULL
          AND v.is_stale = false
          AND v.fdev_refresh_enc IS NOT NULL`,
    );
    return rows.map((r) => ({ userId: r.user_id, cmdrName: r.cmdr_name }));
  }

  async readState(userId: string): Promise<MemberPollState | null> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{
        interval_ms: number;
        unchanged: number;
        last_entry_at: Date | null;
        due_at: Date;
        watermark: Date | null;
        closed_day: string | null;
      }>
    >(
      `SELECT interval_ms, unchanged, last_entry_at, due_at, watermark, closed_day
         FROM capi_poll_state WHERE user_id = $1::uuid`,
      userId,
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      poll: {
        intervalMs: Number(row.interval_ms),
        unchangedInARow: Number(row.unchanged),
        lastEntryAt: row.last_entry_at,
      },
      dueAt: row.due_at,
      watermark: row.watermark,
      closedDay: row.closed_day,
    };
  }

  async writeState(userId: string, state: MemberPollState): Promise<void> {
    await this.db.$executeRawUnsafe(
      `INSERT INTO capi_poll_state
         (user_id, interval_ms, unchanged, last_entry_at, due_at, watermark, closed_day)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         interval_ms = EXCLUDED.interval_ms,
         unchanged = EXCLUDED.unchanged,
         last_entry_at = EXCLUDED.last_entry_at,
         due_at = EXCLUDED.due_at,
         watermark = EXCLUDED.watermark,
         closed_day = EXCLUDED.closed_day`,
      userId,
      state.poll.intervalMs,
      state.poll.unchangedInARow,
      state.poll.lastEntryAt,
      state.dueAt,
      state.watermark,
      state.closedDay,
    );
  }

  /**
   * A usable access token, or null when the grant is dead.
   *
   * ★ THIS IS THE ONE THAT CAN COST A MEMBER THEIR LINK ★
   *
   * Frontier ROTATES the refresh token: issuing a new one kills the old one at once. The API also
   * refreshes on demand, so without a lock the worker and the API can refresh the same member
   * together — both send the same still-valid token, Frontier honours one and invalidates it, and
   * the loser persists a token that is already dead.
   *
   * Nothing errors. The write succeeds, the row looks healthy, and the member is simply
   * disconnected until they notice. It looks exactly like the 25-day ceiling expiring early, and it
   * would hit the cloud players this poller was built for first, because they are the ones being
   * polled on a timer.
   *
   * So both processes take the SAME advisory lock, from the same helper in @grims/db, and this
   * re-reads the row inside it — whoever waited was waiting for somebody else's refresh, and that
   * refresh has already stored the token this call wants.
   */
  async accessToken(userId: string): Promise<string | null> {
    const now = new Date();

    const rows = await this.db.$queryRawUnsafe<
      Array<{
        id: string;
        fdev_access_enc: Buffer | null;
        fdev_refresh_enc: Buffer | null;
        fdev_expires_at: Date | null;
        verified_at: Date;
        is_stale: boolean;
      }>
    >(
      `SELECT id, fdev_access_enc, fdev_refresh_enc, fdev_expires_at, verified_at, is_stale
         FROM cmdr_verifications
        WHERE user_id = $1::uuid AND method = 'fdev_capi' AND revoked_at IS NULL`,
      userId,
    );

    const row = rows[0];
    if (row === undefined || row.fdev_refresh_enc === null) return null;

    /*
     * Past Frontier's ceiling no refresh will ever succeed. Marked once so the member drops out of
     * `livePollable`, rather than every run rediscovering it and spending a request to do so.
     */
    if (tokenState(row.verified_at, now).stale) {
      if (!row.is_stale) {
        await this.db.$executeRawUnsafe(
          `UPDATE cmdr_verifications SET is_stale = true WHERE id = $1::uuid`,
          row.id,
        );
      }
      return null;
    }

    const context = `capi:${userId}`;

    if (
      row.fdev_access_enc !== null &&
      !shouldRefresh({ accessEnc: 'stored', expiresAt: row.fdev_expires_at }, now)
    ) {
      return this.cipher.decrypt(row.fdev_access_enc.toString('utf8'), context);
    }

    const session = await this.#lockSession();

    try {
      return await withCapiRefreshLock(session, userId, async () => {
        // Re-read INSIDE the lock. See the note above: the token this call was about to send may
        // already have been spent by whoever we waited for.
        const fresh = (
          await this.db.$queryRawUnsafe<
            Array<{ fdev_access_enc: Buffer | null; fdev_refresh_enc: Buffer | null; fdev_expires_at: Date | null }>
          >(
            `SELECT fdev_access_enc, fdev_refresh_enc, fdev_expires_at
               FROM cmdr_verifications WHERE id = $1::uuid`,
            row.id,
          )
        )[0];

        if (fresh === undefined || fresh.fdev_refresh_enc === null) return null;

        if (
          fresh.fdev_access_enc !== null &&
          !shouldRefresh({ accessEnc: 'stored', expiresAt: fresh.fdev_expires_at }, now)
        ) {
          return this.cipher.decrypt(fresh.fdev_access_enc.toString('utf8'), context);
        }

        const tokens = await refreshAccess({
          authBase: this.config.authBase,
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          redirectUri: this.config.redirectUri,
          refreshToken: this.cipher.decrypt(fresh.fdev_refresh_enc.toString('utf8'), context),
          now,
        });

        await this.db.$executeRawUnsafe(
          `UPDATE cmdr_verifications
              SET fdev_access_enc = $2, fdev_refresh_enc = $3, fdev_expires_at = $4
            WHERE id = $1::uuid`,
          row.id,
          Buffer.from(this.cipher.encrypt(tokens.accessToken, context), 'utf8'),
          Buffer.from(this.cipher.encrypt(tokens.refreshToken, context), 'utf8'),
          tokens.expiresAt,
        );

        return tokens.accessToken;
      });
    } catch (e) {
      /*
       * ONLY a dead grant marks the row, matching the API exactly. A rate limit or a network blip
       * means try again shortly — writing `is_stale` for those would disconnect a member because
       * Frontier had a bad minute, and nothing would ever un-write it.
       */
      if (e instanceof CapiAuthError && !e.retryable) {
        await this.db
          .$executeRawUnsafe(`UPDATE cmdr_verifications SET is_stale = true WHERE id = $1::uuid`, row.id)
          .catch(() => undefined);
      }
      return null;
    }
  }

  /**
   * The synthetic device cAPI rows are attributed to.
   *
   * Created on demand, because a member who linked Frontier before this job existed has no such
   * device and would otherwise never be polled. Revoking it is how a member says "stop importing
   * this", so a revoked row returns null rather than being quietly recreated.
   */
  async frontierDeviceToken(userId: string): Promise<string | null> {
    const rows = await this.db.$queryRawUnsafe<Array<{ id: string; revoked_at: Date | null }>>(
      `SELECT id, revoked_at FROM device_tokens WHERE user_id = $1::uuid AND label = 'Frontier' LIMIT 1`,
      userId,
    );

    const row = rows[0];
    if (row !== undefined) return row.revoked_at === null ? row.id : null;

    const made = await this.db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO device_tokens (user_id, label, token_hash, scopes)
       VALUES ($1::uuid, 'Frontier', $2, ARRAY['telemetry:write'])
       RETURNING id`,
      userId,
      // No token is ever issued for this device — nothing signs in as it. The hash column is NOT
      // NULL and unique, so it gets a value that cannot collide and cannot authenticate.
      `frontier-capi:${userId}`,
    );

    return made[0]?.id ?? null;
  }

  async optOuts(userId: string): Promise<{ categories: readonly string[]; events: readonly string[] }> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{ cats: string[] | null; events: string[] | null }>
    >(
      `SELECT telemetry_opt_out_categories::text[] AS cats, telemetry_opt_out_events AS events
         FROM users WHERE id = $1::uuid`,
      userId,
    );

    return { categories: rows[0]?.cats ?? [], events: rows[0]?.events ?? [] };
  }

  /**
   * Fingerprints already held for this member, whatever device wrote them.
   *
   * The cross-device half of idempotence: the same journal line uploaded by the member's companion
   * and fetched from Frontier hashes to two different event keys, so only this catches it.
   */
  async fingerprintsSince(userId: string, since: Date): Promise<ReadonlySet<string>> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{ occurred_at: Date; event_type: string; payload: Record<string, unknown> }>
    >(
      `SELECT occurred_at, event_type, payload
         FROM telemetry_events
        WHERE user_id = $1::uuid AND occurred_at >= $2`,
      userId,
      since,
    );

    return new Set(
      rows.map((r) =>
        contentFingerprint({
          occurredAt: r.occurred_at,
          eventType: r.event_type,
          payload: r.payload,
        }),
      ),
    );
  }

  /**
   * Inserts, and returns the keys the DATABASE actually took.
   *
   * `ON CONFLICT DO NOTHING` plus `RETURNING` is what makes that answer true: the unique index over
   * `event_key` decides, and the caller uses the count to decide whether the member is flying, whether
   * a month counts toward a promotion, and whether to poll them faster. Reporting what we offered
   * instead would drive all three off rows that were refused.
   */
  async insert(rows: readonly TelemetryRow[]): Promise<readonly string[]> {
    if (rows.length === 0) return [];

    const stored: string[] = [];
    for (const row of rows) {
      const back = await this.db.$queryRawUnsafe<Array<{ event_key: string }>>(
        `INSERT INTO telemetry_events
           (user_id, device_token_id, category, event_type, occurred_at, payload, event_key)
         VALUES ($1::uuid, $2::uuid, $3::"TelemetryCategory", $4, $5, $6::jsonb, $7)
         ON CONFLICT (event_key) DO NOTHING
         RETURNING event_key`,
        row.userId,
        row.deviceTokenId,
        row.category,
        row.eventType,
        row.occurredAt,
        JSON.stringify(row.payload),
        row.eventKey,
      );
      if (back[0] !== undefined) stored.push(back[0].event_key);
    }

    return stored;
  }

  /** Presence, stamped with the ENTRY's time — cAPI lags, and `now` would assert what we do not know. */
  async markPlaying(userId: string, at: Date): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE users SET last_playing_at = GREATEST(COALESCE(last_playing_at, $2), $2) WHERE id = $1::uuid`,
      userId,
      at,
    );
  }

  /**
   * The month counted toward a promotion.
   *
   * ★ WHY THIS METHOD IS THE POINT OF THE WHOLE JOB ★
   *
   * Game activity sat at `unknown` for most of the squadron because the only thing that ever set it
   * was the companion's own ingest. A cloud player could not run the companion, so however much they
   * flew they could never earn a qualifying month. This is the line that changes that.
   */
  async markGameActivityObserved(userId: string, month: Date): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE member_activity_months
          SET game_activity = 'observed'
        WHERE user_id = $1::uuid AND month = $2::date AND game_activity <> 'observed'`,
      userId,
      month,
    );
  }

  async #lockSession(): Promise<LockSession> {
    const client = new Client({ connectionString: this.connectionString });
    await client.connect();
    return {
      query: (sql, values) => client.query(sql, values === undefined ? undefined : [...values]),
      end: () => client.end(),
    };
  }
}
