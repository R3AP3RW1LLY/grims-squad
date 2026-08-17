import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@grims/db';
import { rebuildBountyBoard, PER_SYSTEM_LIMIT, NEVER_SEEN_POINTS, STALE_CAP_DAYS } from './bounty-board.js';

/**
 * Why an entire system's bounties vanish at once.
 *
 * ★ REPORTED BY THE SQUADRON OWNER, 2026-08-08 ★
 *
 * "a player doing /bounties just did one in system BD+16 and then all of the remaining
 * disappeared, this happened in another system too."
 *
 * The claim was not the cause. Claiming deletes exactly one row, keyed by station, and the
 * production claim log shows two separate stations in Segon and two in HIP 14922 each claimed
 * independently without disturbing the other. What happened is that the board is a top-300 cut and
 * BD+16 1001's twenty-odd stations all sat within a few points of each other, just under the line.
 *
 * The cut had risen above them by the next half-hourly rebuild, and the whole system went at once.
 *
 * ★ THE NUMBERS THAT MADE IT INEVITABLE ★
 *
 * Measured on production the morning it was reported:
 *
 *   ops rows on the board   300   (exactly the limit)
 *   at the 3,650 point cap  284
 *   cut line                3,642
 *   biggest single system    20 slots (Khwar)
 *   never-seen stations        0
 *
 * Points are `LEAST(days_stale, 1825) * 2`, so everything our data is older than five years for
 * scores an identical 3,650. Almost the whole galaxy's market data dates from the same 2021 import,
 * so the scale has collapsed: 284 of 300 rows are tied at the ceiling and the cut line climbs by
 * two points a day. A system's stations share an import timestamp, therefore share a score, and
 * therefore cross the line together — the block eviction the owner saw.
 *
 * The third defect is in the same numbers: a never-seen station scores 1,000 (2,000 with the
 * jackpot doubling) against a stale station's 3,650, so the thing the job's own header calls
 * "precisely the biggest bounty there is" cannot reach the board at all. Production held zero.
 */

const db = new PrismaClient();
const TAG = 'bounty-board-int-spec';
/*
 * Chosen to sort LOW as text, not at random. The board's tiebreak within a points tier is
 * `station_key` ascending, and against a real database this fixture competes with every genuine
 * candidate at the same score — a high-sorting id loses the global cut and the spec then fails for
 * a reason that has nothing to do with the rule under test.
 */
const SYS_ID = '1000000000102';
const CROWDED = `${TAG} Crowded`;
const NEVER = `${TAG} Never`;

async function cleanUp(): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM data_bounties WHERE station_key LIKE $1`, `${SYS_ID}/%`);
  await db.$executeRawUnsafe(`DELETE FROM market_entries WHERE station_key LIKE $1`, `${SYS_ID}/%`);
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE ext_key LIKE $1 OR ext_key = $2`,
    `${SYS_ID}/%`,
    SYS_ID,
  );
  await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE system_name LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle = $1`, TAG);
}

afterAll(async () => {
  await cleanUp();
  await db.$disconnect();
});

describe('the data bounty board, against Postgres', () => {
  it(
    '★ MANDATORY: one system cannot swallow the board, and a never-seen station outranks any stale one ★',
    async () => {
      await cleanUp();

      const [user] = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO users (handle, display_name) VALUES ($1, $1) RETURNING id`,
        TAG,
      );
      const userId = (user as { id: string }).id;

      // An anchor system, so the stations below land in "squadron space" rather than the tail.
      await db.$executeRawUnsafe(
        `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text)
         VALUES ('galaxy', 'system', $1, $2, '{}'::jsonb, cube(array[11.0, 12.0, 13.0]), $2)`,
        SYS_ID,
        CROWDED,
      );
      await db.$executeRawUnsafe(
        `INSERT INTO colony_projects (owner, posted_by_id, market_id, system_name, system_id64, title)
         VALUES ('squadron', $1::uuid, $2::bigint, $3, $4::bigint, $5)`,
        userId,
        '900000000000901',
        CROWDED,
        SYS_ID,
        `${TAG} anchor`,
      );

      /*
       * Twelve stations in ONE system, every one of them equally and maximally stale. This is the
       * shape BD+16 1001 was in: a single import timestamp across the whole system.
       */
      const stale = new Date(Date.now() - (STALE_CAP_DAYS + 400) * 86_400_000).toISOString();
      for (let i = 1; i <= 12; i++) {
        const key = `${SYS_ID}/${TAG} Station ${i}`;
        await db.$executeRawUnsafe(
          `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text)
           VALUES ('galaxy', 'station', $1, $2, jsonb_build_object('system', $3, 'type', 'Coriolis'),
                   cube(array[11.0, 12.0, 13.0]), $2)`,
          key,
          `${TAG} Station ${i}`,
          CROWDED,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO market_entries (station_key, station_name, system_name, commodity,
                                       market_seen_at, source)
           VALUES ($1, $2, $3, 'Gold', $4::timestamptz, 'eddn')`,
          key,
          `${TAG} Station ${i}`,
          CROWDED,
          stale,
        );
      }

      /*
       * And one station in the same system that we hold NO market for at all. The job's header
       * calls this the biggest bounty there is; production held none of them.
       */
      await db.$executeRawUnsafe(
        `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text)
         VALUES ('galaxy', 'station', $1, $2, jsonb_build_object('system', $3, 'type', 'Coriolis'),
                 cube(array[11.0, 12.0, 13.0]), $2)`,
        `${SYS_ID}/${NEVER}`,
        NEVER,
        CROWDED,
      );

      await rebuildBountyBoard(db);

      const rows = await db.$queryRawUnsafe<
        Array<{ station_key: string; station_name: string; points: number; last_seen_at: Date | null; in_ops: boolean }>
      >(
        `SELECT station_key, station_name, points, last_seen_at, in_ops
           FROM data_bounties WHERE station_key LIKE $1 ORDER BY points DESC, station_key`,
        `${SYS_ID}/%`,
      );

      /*
       * ★ THE REGRESSION ★
       *
       * Before the fix this returned all thirteen: one system taking thirteen of three hundred
       * slots, every one of them scoring within a whisker of the others, and so every one of them
       * evicted together the moment the cut line moved.
       */
      /*
       * PER SECTION, because that is what the board renders and therefore what a member watches
       * vanish. Squadron space and the galaxy tail are two lists with two independent cuts; a
       * system may legitimately appear in both, and capping the pair jointly would starve the tail
       * of anything near an anchor for no benefit to the member.
       */
      const ops = rows.filter((r) => r.in_ops);
      const tail = rows.filter((r) => !r.in_ops);

      for (const [label, list] of [['squadron space', ops], ['galaxy tail', tail]] as const) {
        expect(
          list.length,
          `one system put ${list.length} stations on the ${label} list; the cap is ${PER_SYSTEM_LIMIT}. ` +
            'A system that fills a list with near-identical scores loses all of them at once when ' +
            'the cut line moves, which is exactly what BD+16 1001 did to a member mid-session.',
        ).toBeLessThanOrEqual(PER_SYSTEM_LIMIT);
      }

      // And the never-seen station must be among what survived, ahead of the stale ones.
      const never = rows.find((r) => r.station_name === NEVER);
      expect(
        never,
        'the station we hold no market data for did not make the board at all, though the job ' +
          'calls it the biggest bounty there is',
      ).toBeDefined();
      expect(never?.last_seen_at).toBeNull();

      const stalest = Math.max(...rows.filter((r) => r.last_seen_at !== null).map((r) => r.points), 0);
      expect(
        never?.points ?? 0,
        'a never-seen station scored below a stale one, which inverts the whole point of the board',
      ).toBeGreaterThan(stalest);
      expect(never?.points).toBeGreaterThanOrEqual(NEVER_SEEN_POINTS);
    },
    120_000,
  );
  it(
    '★ MANDATORY: a station with no market is not a bounty, but an UNKNOWN one still is ★',
    async () => {
      /*
       * ★ 72 OF THE 496 BOUNTIES ON THE BOARD COULD NOT BE CLEARED — MEASURED 2026-08-16 ★
       *
       * A bounty is an instruction to fly somewhere and bring back a market. A station with no
       * market has none to bring back, so nothing can ever refresh it: the bounty sits at the top
       * of the board for ever, pays nobody, and displaces a station somebody could have helped
       * with. Fifty-seven Outposts and one Planetary Outpost were in exactly that state, plus
       * fourteen we hold no catalogue row for.
       *
       * ★ AND THE SECOND HALF IS THE HALF THAT IS EASY TO GET WRONG ★
       *
       * The rule is `services is an ARRAY and that array lacks Market` — not `services does not
       * contain Market`. Four hundred and fifty-nine stations carry no services data at all, and
       * under the shorter form every one would be struck off. "Nobody has ever told us what this
       * station offers" is the strongest case there is for sending somebody to look.
       *
       * Both halves are asserted here because either alone passes with the wrong rule in place.
       */
      await cleanUp();

      const [user] = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO users (handle, display_name) VALUES ($1, $1) RETURNING id`,
        TAG,
      );
      const userId = (user as { id: string }).id;

      await db.$executeRawUnsafe(
        `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text)
         VALUES ('galaxy', 'system', $1, $2, '{}'::jsonb, cube(array[11.0, 12.0, 13.0]), $2)`,
        SYS_ID,
        CROWDED,
      );
      await db.$executeRawUnsafe(
        `INSERT INTO colony_projects (owner, posted_by_id, market_id, system_name, system_id64, title)
         VALUES ('squadron', $1::uuid, $2::bigint, $3, $4::bigint, $5)`,
        userId,
        '900000000000902',
        CROWDED,
        SYS_ID,
        `${TAG} anchor`,
      );

      // Never seen, so all three are maximum-value candidates and only the RULE can separate them.
      const station = async (
        suffix: string,
        services: string | null,
        type = 'Coriolis',
      ): Promise<void> => {
        await db.$executeRawUnsafe(
          `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text)
           VALUES ('galaxy', 'station', $1, $2,
                   jsonb_build_object('system', $3, 'type', $5::text)
                     || CASE WHEN $4::text IS NULL THEN '{}'::jsonb
                             ELSE jsonb_build_object('services', $4::jsonb) END,
                   cube(array[11.0, 12.0, 13.0]), $2)`,
          `${SYS_ID}/${TAG} ${suffix}`,
          `${TAG} ${suffix}`,
          CROWDED,
          services,
          type,
        );
      };

      await station('HasMarket', '["Dock", "Market", "Refuel"]');
      await station('NoMarket', '["Dock", "Refuel"]');
      await station('Unknown', null);
      await station('Settlement', '["Dock", "Market"]', 'Settlement');
      await station('OnFoot', '["Dock", "Market"]', 'OnFootSettlement');

      await rebuildBountyBoard(db);

      const listed = await db.$queryRawUnsafe<Array<{ station_key: string }>>(
        `SELECT station_key FROM data_bounties WHERE station_key LIKE $1 ORDER BY station_key`,
        `${SYS_ID}/${TAG} %`,
      );
      const names = listed.map((r) => r.station_key.split('/')[1]);

      expect(names, 'a station that HAS a market is still a bounty').toContain(`${TAG} HasMarket`);
      expect(
        names,
        'a station whose services say it has NO market can never be cleared and must not be listed',
      ).not.toContain(`${TAG} NoMarket`);
      expect(
        names,
        'and a station we know NOTHING about is the strongest bounty of all — unknown is not absent',
      ).toContain(`${TAG} Unknown`);

      /*
       * ★ SETTLEMENTS, BOTH SPELLINGS — SQUADRON OWNER, 2026-08-16 ★
       *
       * They were 291 of the 496 rows: the majority of the whole board. The services list says they
       * have markets and by its own lights it is right; what it cannot say is whether a member in a
       * ship can get to one. A board that is three-fifths settlements is mostly trips that do not
       * happen, and the stations somebody WOULD have flown to are the ones displaced.
       *
       * Both spellings asserted because both are in the catalogue, and this codebase has already
       * had a carrier go unfindable from a query that hard-coded one of two vocabularies for one
       * thing. Matching only `Settlement` would leave `OnFootSettlement` on the board with nothing
       * on screen to explain why.
       */
      expect(names, 'a settlement is not a trip most members can make').not.toContain(
        `${TAG} Settlement`,
      );
      expect(names, 'and the catalogue spells it two ways').not.toContain(`${TAG} OnFoot`);
    },
    60_000,
  );
});
