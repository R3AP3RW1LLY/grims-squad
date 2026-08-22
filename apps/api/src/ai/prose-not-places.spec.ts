import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLACE_KINDS, isPlaceKind } from '@grims/shared';

/**
 * A member's question must never be answered with a list of star systems.
 *
 * ★ MEASURED IN PRODUCTION, 2026-08-22 ★
 *
 * "how do I become a member of the squadron" returned five system names — Wregoe RF-W b57-0 and
 * four of its neighbours. The joining guide was sitting at cosine distance 0.2183; the index handed
 * back rows at 0.3904.
 *
 * ★ THE VECTORS WERE RIGHT. THE SEARCH WAS ASKED THE WRONG QUESTION ★
 *
 * An exact scan returned the guide first, every time. So nothing was corrupt and nothing needed
 * repairing — 302 prose rows were being asked to compete with 687,000 places inside one approximate
 * index, and approximate search is entitled to lose 302 needles in that haystack.
 *
 * `KnowledgeService.semantic` had relied on an invariant that stopped being true the day the owner
 * asked for full EDDN coverage: that only prose is ever embedded. Its own comment still said so.
 *
 * These tests hold the separation in place, because the failure it prevents is invisible: every
 * query still returns rows, and they are simply the wrong ones.
 */

const REPO = join(process.cwd(), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

const KNOWLEDGE = 'apps/api/src/ai/knowledge.service.ts';

describe('places and prose are searched separately', () => {
  it('★ MANDATORY: the semantic search excludes place kinds ★', () => {
    const src = read(KNOWLEDGE);

    // A guard on the guard: a moved file would read empty and pass everything below in silence.
    expect(src.length, 'knowledge.service.ts is readable').toBeGreaterThan(1_000);

    expect(src, 'the prose search knows about the place kinds').toContain('PLACE_KINDS');
    expect(
      src,
      'and filters them out in SQL — a comment promising it is what failed last time',
    ).toMatch(/kind\s*(<>|!=)\s*ALL|NOT IN \(/i);
  });

  it('★ MANDATORY: every kind that dominates the corpus is a place ★', () => {
    /*
     * The four that matter, by embedded row count on 2026-08-22:
     *   system 350,006 · station 329,260 · visited-system 5,920 · visited-station 1,589
     * against 302 prose rows in total.
     *
     * If one of these ever drops off the list it stops being excluded, and a single kind is enough
     * to drown the prose again — station alone outnumbers it a thousand to one.
     */
    for (const kind of ['system', 'station', 'visited-system', 'visited-station']) {
      expect(isPlaceKind(kind), `${kind} must be treated as a place`).toBe(true);
    }
  });

  it('★ MANDATORY: prose kinds are NOT excluded ★', () => {
    /*
     * The other direction, and the more dangerous one. Over-excluding would empty the assistant's
     * answers entirely — and it would look exactly like "the AI has nothing to say about that",
     * which nobody would report as a bug.
     */
    for (const kind of ['guide', 'help', 'forum', 'reference', 'document', 'blueprint', 'ship']) {
      expect(isPlaceKind(kind), `${kind} is prose and must stay searchable`).toBe(false);
    }
  });

  it('the place list is not silently empty', () => {
    // An empty PLACE_KINDS would make the SQL filter a no-op that still typechecks and still runs.
    expect(PLACE_KINDS.length).toBeGreaterThanOrEqual(4);
  });

  it('★ MANDATORY: the query predicate matches the partial index, literally ★', () => {
    /*
     * ★ THE FIX THAT RETURNED NOTHING — MEASURED BEFORE IT SHIPPED, 2026-08-22 ★
     *
     * The first version of this filter compared `kind` against a BOUND PARAMETER. Logically
     * identical, and it made things WORSE: Postgres cannot prove a bound-parameter condition is covered by the
     * partial index's predicate, so it planned against the place-dominated index instead, fetched
     * its candidates, filtered every single one away, and returned zero rows in 11ms.
     *
     * An assistant that answers nothing looks like an assistant that has nothing to say. Nobody
     * reports that as a bug, which is what makes it worse than the failure it replaced.
     *
     * So this holds three things to the same four values: the constant, the SQL in the service, and
     * the index predicate in the migration. If any drifts, the index stops being used and the only
     * symptom is an assistant that has gone quiet.
     */
    const service = read(KNOWLEDGE);
    const migration = read(
      'packages/db/prisma/migrations/20260822200000_prose_vector_index/migration.sql',
    );

    expect(migration.length, 'the migration is readable').toBeGreaterThan(200);
    expect(migration, 'the index is partial on the same condition').toMatch(/kind NOT IN \(/i);

    for (const kind of PLACE_KINDS) {
      expect(migration, `the index predicate excludes ${kind}`).toContain(`'${kind}'`);
    }

    /*
     * And the service must build its list from the constant rather than typing it out — a
     * hand-written copy is how the two drift in the first place.
     */
    expect(service, 'the SQL list is derived from PLACE_KINDS').toMatch(/PLACE_KINDS\.map/);
    expect(
      service,
      'a bound parameter would silently stop matching the partial index',
    ).not.toMatch(/kind\s*<>\s*ALL\(\$/);
  });
});
