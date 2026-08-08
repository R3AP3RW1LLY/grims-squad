import type { PrismaClient } from '@prisma/client';
// The parser lives in @grims/shared so the ingest service can read an event without a database.
import type { SystemSighting } from '@grims/shared';

/**
 * Systems our members find before the galaxy dump does.
 *
 * ★ SQUADRON OWNER, 2026-08-08 ★
 *
 * "we need system data that our members discover to update our market data near instantly,
 * ingested, so its all as real time as possible ... same with system information in realtime as
 * users of our app are entering systems, visiting stations etc"
 *
 * ★ THE DATA WAS ALREADY HERE ★
 *
 * Nothing needed building in the companion. It has sent whole journal events since 2026-07-29 and
 * the server decides what to keep, so production had already taken 866 `FSDJump` and 188
 * `Location` events in a week — and routed none of them anywhere. 502 distinct systems sat in
 * `telemetry_events` that `knowledge_items` did not hold.
 *
 * One of them was almost certainly Col 285 Sector GL-W c2-12, which the colonisation scout rejected
 * on 2026-08-07 with "We hold no coordinates ... Check the spelling — it has to match the game."
 * The spelling was right. A member had flown there and told us the coordinates, and we had thrown
 * the message away.
 *
 * ★ WHY THE ADDRESS IS THE KEY ★
 *
 * System NAMES are not unique in Elite — procedural sectors repeat them, which is why
 * `ensureLiveStation` refuses to place a station from an ambiguous name. `SystemAddress` is unique
 * and never changes, so it is the ext_key, matching how the galaxy dump keys its own rows.
 */

/**
 * Record a system a member actually flew to.
 *
 * ★ IT NEVER OVERWRITES THE GALAXY DUMP ★
 *
 * A `galaxy` row is the authority on where a system is, and a member's sighting must not move it —
 * the dump is derived from the same game data and is not improved by one commander's copy of it.
 * So this writes under its own source and the readers, which already accept `('galaxy', 'eddn')`,
 * take whichever they find.
 *
 * What it DOES do is fill the gap: a system nobody has dumped yet exists here the moment somebody
 * jumps into it, which is the whole point.
 *
 * ★ COORDINATES ARE NEVER UNLEARNED ★
 *
 * `Location` on a session that started docked can arrive without `StarPos`. Letting that blank a
 * good coordinate would make the table worse the longer members played, so the COALESCE keeps what
 * is already known.
 */
export async function recordSystemSighting(
  db: PrismaClient,
  seen: SystemSighting,
): Promise<void> {
  const name = seen.systemName.trim();
  if (name === '' || seen.systemAddress.trim() === '') return;

  const coords = seen.coords;

  await db.$executeRawUnsafe(
    `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text, ingested_at)
     VALUES (
       'companion', 'system', $1, $2,
       jsonb_strip_nulls(jsonb_build_object(
         'allegiance',     $6::text,
         'economy',        $7::text,
         'secondEconomy',  $8::text,
         'government',     $9::text,
         'security',       $10::text,
         'population',     $11::bigint,
         'foundByMembers', true,
         'firstSeenAt',    now()
       )),
       CASE WHEN $3::float8 IS NULL THEN NULL
            ELSE cube(array[$3::float8, $4::float8, $5::float8]) END,
       $2,
       now()
     )
     ON CONFLICT (source, kind, ext_key) DO UPDATE SET
       -- The newest sighting's name wins: a system renamed in game should read the new way.
       name = EXCLUDED.name,
       text = EXCLUDED.name,
       -- Never unlearn a coordinate. A Location event on a session that began docked carries no
       -- StarPos, and letting it blank a good value would rot the table as members played.
       coords = COALESCE(EXCLUDED.coords, knowledge_items.coords),
       -- Merge rather than replace, for the same reason: a sparse sighting must not delete what a
       -- richer one taught us.
       data = knowledge_items.data || EXCLUDED.data,
       ingested_at = now()`,
    seen.systemAddress,
    name,
    coords === null ? null : coords[0],
    coords === null ? null : coords[1],
    coords === null ? null : coords[2],
    seen.allegiance ?? null,
    seen.economy ?? null,
    seen.secondEconomy ?? null,
    seen.government ?? null,
    seen.security ?? null,
    seen.population ?? null,
  );
}
