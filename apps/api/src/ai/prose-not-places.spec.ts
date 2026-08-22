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

/**
 * The other half: places ARE searchable, just never through the prose door.
 *
 * ★ THE POINT OF SPLITTING RATHER THAN DELETING ★
 *
 * An audit on 2026-08-22 found nothing in the codebase read place embeddings — 687,000 rows that
 * only ever harmed retrieval. The owner chose to build the consumer rather than abandon the data,
 * so "somewhere quiet with good mining and a large landing pad" is now answerable: measured on the
 * live corpus it returns five Extraction-economy settlements at 0.712-0.724 similarity.
 *
 * A question no column can answer, which is exactly what vectors are for.
 */
describe('places are searchable on their own terms', () => {
  it('★ MANDATORY: there is a place search, and it is separate ★', () => {
    const src = read(KNOWLEDGE);

    expect(src, 'the place search exists').toContain('semanticPlaces');
    expect(
      src,
      'and selects places rather than excluding them — the mirror of the prose query',
    ).toMatch(/kind IN \(\$\{PLACE_LIST\}\)/);
  });

  it('★ MANDATORY: places have a HIGHER similarity floor than prose ★', () => {
    /*
     * The floor is the only thing keeping the place leg quiet on questions that are not about
     * places, because it runs on every question rather than behind a keyword guess.
     *
     * Measured: places score 0.59-0.61 against "how do I get more jump range" and "how do I become
     * a member", and 0.712-0.724 against a real place question. At the ordinary prose floor of
     * 0.55 a joining question would pull in star systems — the failure this file exists to prevent.
     */
    const src = read(KNOWLEDGE);

    const prose = /const MIN_SIMILARITY = ([0-9.]+)/.exec(src)?.[1];
    const place = /const PLACE_MIN_SIMILARITY = ([0-9.]+)/.exec(src)?.[1];

    expect(prose, 'the prose floor is readable').toBeDefined();
    expect(place, 'the place floor is readable').toBeDefined();
    expect(
      Number(place),
      'a place floor at or below the prose floor lets places answer prose questions',
    ).toBeGreaterThan(Number(prose));

    // Above where places land on non-place questions (0.61), below where they land on real ones.
    expect(Number(place)).toBeGreaterThanOrEqual(0.65);
    expect(Number(place)).toBeLessThan(0.71);
  });

  it('★ MANDATORY: the assistant runs both legs ★', () => {
    /*
     * Adding the method and never calling it is the failure this project keeps hitting — a feature
     * complete everywhere except where somebody could reach it. Twice already this session.
     */
    const assistant = read('apps/api/src/ai/assistant.service.ts');

    expect(assistant.length, 'assistant.service.ts is readable').toBeGreaterThan(1_000);

    /*
     * Anchored to the START of a line so a COMMENTED-OUT call cannot pass. Written with toContain
     * first, and commenting the leg out left the string sitting in the comment and the test green —
     * which is the very failure this test exists to catch, rebuilt inside the catcher.
     */
    expect(assistant, 'the prose leg runs').toMatch(/^\s*this\.knowledge\.semantic\(question\)/m);
    expect(assistant, 'and so does the place leg').toMatch(
      /^\s*this\.knowledge\.semanticPlaces\(question\)/m,
    );
  });

  it('the place index migration matches the query predicate', () => {
    const migration = read(
      'packages/db/prisma/migrations/20260822230000_place_vector_index/migration.sql',
    );

    expect(migration.length).toBeGreaterThan(200);
    expect(migration, 'selects the place kinds').toMatch(/kind IN \(/i);
    for (const kind of PLACE_KINDS) {
      expect(migration, `the place index covers ${kind}`).toContain(`'${kind}'`);
    }
    /*
     * The same two rules its sibling learned the hard way. Matched on the STATEMENT, not the word:
     * the migration explains at length why it does not use a concurrent build, and a test that
     * forbade the word would forbid the explanation.
     */
    expect(
      migration,
      'a concurrent build cannot run inside a migration transaction',
    ).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
    expect(migration, 'the build memory is capped').toContain('maintenance_work_mem');
  });
});
