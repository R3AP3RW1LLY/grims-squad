import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_FIELDS, JOURNAL_EVENTS, TELEMETRY_CATALOGUE } from '@grims/shared';

/**
 * Recording which systems are actually ours.
 *
 * ★ THE GAP — 2026-08-24 ★
 *
 * Every colonisation event the platform collected was about a construction site that ALREADY
 * EXISTS. So it could describe every build in detail and could not answer "which systems have we
 * taken", except by inferring it from builds somebody had already started — which misses every
 * claim nobody has built on, and those are exactly the ones still waiting to be planned.
 *
 * ★ AND THE FAILURE THIS PROJECT KEEPS FINDING ★
 *
 * Collecting an event and never reading it. This session alone has found the primary project, the
 * companion drafter screen and the overlay push channel each complete everywhere except where
 * somebody could reach them. A new event is the easiest possible version of that mistake: the
 * ingest accepts it, rows accumulate, and nothing anywhere is different.
 *
 * So this pins BOTH halves — the event is collected, and something reads it.
 */

const HERE = join(process.cwd(), 'src', 'logistics');
const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

describe('a system claim', () => {
  it('★ MANDATORY: is collectable at all ★', () => {
    /*
     * Absent from this map, the companion never sends it and the server discards it — silently, and
     * with zero rows ever. That exact failure cost this platform three location events for a week.
     */
    expect(JOURNAL_EVENTS).toHaveProperty('ColonisationSystemClaim');
    expect(JOURNAL_EVENTS.ColonisationSystemClaim).toBe('colonisation');
  });

  it('★ MANDATORY: keeps only where the claim was ★', () => {
    /*
     * The field allowlist is what stops a journal payload arriving wholesale. Two fields: the id64
     * the platform keys systems on, and the name a member reads.
     */
    expect(EVENT_FIELDS.ColonisationSystemClaim).toEqual(['StarSystem', 'SystemAddress']);
  });

  it('★ MANDATORY: a member can see what it collects and switch it off ★', () => {
    /*
     * Consent here is opt-out, so being in the catalogue IS on by default. What the entry buys is
     * the thing that matters: nothing about colonisation is collected silently, and a claim says
     * more than a tonnage — it names a system somebody has taken and when.
     */
    const colonisation = TELEMETRY_CATALOGUE.find((c) => c.category === 'colonisation');
    expect(colonisation, 'the colonisation group exists').toBeDefined();

    const entry = colonisation?.entries.find((e) => e.event === 'ColonisationSystemClaim');
    expect(entry, 'and the claim is described in it').toBeDefined();
    expect(entry?.reveals, 'in words, not a field list').toMatch(/claim/i);
  });

  it('★ MANDATORY: something actually READS the rows ★', () => {
    /*
     * The whole point. An event collected and never read changes nothing anybody can see, and looks
     * identical to a working feature from the inside.
     *
     * Anchored to line starts: an assertion on a bare string matches a commented-out call just as
     * happily, which has caught this project out five times.
     */
    const service = read('colony-plan.service.ts');

    expect(service, 'the reader exists').toMatch(/^\s*async claimedWithoutPlan\($/m);
    expect(service, 'and queries the event').toMatch(/event_type = 'ColonisationSystemClaim'/);
  });

  it('★ MANDATORY: the query can use an index ★', () => {
    /*
     * `telemetry_events` is indexed on (category, occurred_at) and (user_id, occurred_at). There is
     * no index on event_type, so filtering on it ALONE would be a sequential scan of every journal
     * event this platform has ever stored — on a page load.
     */
    const service = read('colony-plan.service.ts');

    expect(service).toMatch(/AND category = 'colonisation'/);
    expect(service).toMatch(/WHERE user_id = \$1::uuid/);
  });

  it('★ MANDATORY: scoped to the caller, never widened ★', () => {
    /*
     * A claim is a statement about one member's intentions and the catalogue entry promises exactly
     * that. Widening this to the squadron would publish something members agreed to send us, not to
     * show each other.
     */
    for (const file of ['colony.controller.ts', 'colony-device.controller.ts']) {
      expect(read(file), `${file} passes only its own caller`).toMatch(
        /claimedWithoutPlan\(me\.userId\)/,
      );
      expect(read(file)).not.toMatch(/claimedWithoutPlan\((?!me\.userId\))/);
    }
  });

  it('★ MANDATORY: the route is declared before plans/:id ★', () => {
    /*
     * Routes match in declaration order. Behind `:id`, "claimed" is read as a plan id and the route
     * answers "no such plan" — a 404 for something that exists, which reads as the feature being
     * broken rather than misrouted.
     */
    for (const file of ['colony.controller.ts', 'colony-device.controller.ts']) {
      const source = read(file);
      const claimed = source.indexOf("@Get('plans/claimed')");
      const byId = source.indexOf("@Get('plans/:id')");

      expect(claimed, `${file} has the route`).toBeGreaterThan(-1);
      expect(byId, `${file} has the detail route`).toBeGreaterThan(-1);
      expect(claimed, `${file} declares claimed first`).toBeLessThan(byId);
    }
  });

  it('★ MANDATORY: it does NOT create a plan by itself ★', () => {
    /*
     * The tempting move, and the wrong one. Writing rows into somebody's planner because of
     * something their game did is the kind of helpfulness indistinguishable from a bug when it is
     * wrong — and a member who claimed a system to deny it to somebody else has not asked for a
     * plan at all. The surfaces offer; the member decides.
     */
    const service = read('colony-plan.service.ts');
    const reader = service.slice(
      service.indexOf('async claimedWithoutPlan('),
      service.indexOf('async list('),
    );

    expect(reader, 'the reader writes nothing').not.toMatch(/colonyPlan\.create|INSERT INTO/i);
  });

  it('skips systems that are already planned by anybody', () => {
    /*
     * Matched against EVERY plan, not just the caller's: a member who claimed a system an officer
     * has already planned as a squadron build does not need telling to plan it again.
     */
    const service = read('colony-plan.service.ts');
    const reader = service.slice(
      service.indexOf('async claimedWithoutPlan('),
      service.indexOf('async list('),
    );

    expect(reader).toMatch(/colonyPlan\.findMany/);
    expect(reader, 'case-insensitively, since a system name is typed').toMatch(
      /mode: 'insensitive'/,
    );
  });
});
