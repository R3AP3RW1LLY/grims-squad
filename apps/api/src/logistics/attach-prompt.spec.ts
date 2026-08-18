import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Your carrier is holding 800 t this build needs — attach it?"
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * Asked who should see this and where, the answer was: the carrier's owner, on the project page.
 *
 * ★ WHY THE OWNER AND NOBODY ELSE ★
 *
 * A carrier that is not attached is deliberately on no squadron board. Telling officers what is
 * inside one before its owner has offered it would publish a private hold in order to make a prompt
 * slightly more effective — and attaching is meant to stay the owner's decision.
 *
 * ★ WHAT MADE IT POSSIBLE AT ALL ★
 *
 * The journal path stored `updated_by_id` as NULL, so nothing knew whose carrier a snapshot came
 * from. The hub could see the cargo and had no idea who to tell. Recording the pusher is the change
 * that turns "somebody's carrier has this" into a sentence addressed to a person.
 */

const strip = (f: string): string =>
  readFileSync(join(process.cwd(), f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

const CARRIER = strip('src/logistics/colony-carrier.service.ts');
const DEVICE = strip('src/logistics/colony-device.controller.ts');
const PROJECT = strip('src/logistics/colony.controller.ts');

/**
 * ★ THE WINDOW IS THE METHOD, NOT THE FILE ★
 *
 * Three assertions written for this feature turned out to match code in OTHER methods of this same
 * service — `n.remaining > 0` and `AND n.project_id = $1::uuid` both appear in an unrelated query,
 * so both passed with the clause deleted. Each said something true about the file and nothing
 * whatever about the code it named. Mutation testing caught them; nothing else would have.
 *
 * So every claim about the prompt query is made against a slice bounded by the method itself.
 */
const QUERY = ((): string => {
  const start = CARRIER.indexOf('async unattachedHoldingFor(');
  if (start === -1) throw new Error('the prompt query no longer exists');
  const end = CARRIER.indexOf('\n  async ', start + 1);
  return CARRIER.slice(start, end === -1 ? undefined : end);
})();

describe('ownership is recorded', () => {
  it('★ MANDATORY: the journal path stores WHO pushed it ★', () => {
    // It stored NULL. Without this the prompt has no addressee and cannot exist.
    expect(CARRIER, 'a NULL owner is what made this unanswerable').not.toContain(
      "'journal', $3, NULL, now())",
    );
    expect(CARRIER).toContain('input.pushedBy ?? null');
  });

  it('★ MANDATORY: the push route passes the caller ★', () => {
    // The service can only store what the controller gives it.
    expect(DEVICE).toContain('pushedBy: me.userId');
  });
});

describe('who the prompt reaches', () => {
  it('★ MANDATORY: it is scoped to the asking member ★', () => {
    /*
     * `updated_by_id = $2::uuid` is the whole boundary. Without it the query would return every
     * unattached carrier in the squadron holding a wanted commodity, to anybody who opened the page.
     */
    expect(QUERY).toContain('g.updated_by_id = $2::uuid');
  });

  it('★ MANDATORY: a signed-out reader gets nothing ★', () => {
    // No caller, no owner, no prompt — rather than a query with a null owner that matches rows.
    expect(PROJECT).toContain('caller === undefined');
  });

  it('★ MANDATORY: only commodities the build STILL wants ★', () => {
    // A carrier full of something already delivered is not worth interrupting anybody about.
    expect(QUERY).toContain('n.remaining > 0');
    expect(QUERY).toContain('n.project_id = $1::uuid');
  });

  it('★ MANDATORY: nothing already attached to THIS build is offered again ★', () => {
    expect(QUERY).toContain('NOT EXISTS');
    expect(QUERY).toContain('FROM colony_carriers c');
  });
});

describe('the number it leads with', () => {
  it('★ MANDATORY: the tonnage is CLAMPED to what the build can use ★', () => {
    /*
     * A carrier holding 5,000 t of Titanium for a build that wants 200 t contributes 200 t.
     * Leading with the bigger number makes the prompt bait — it promises progress attaching cannot
     * deliver, and the carriers tab then quotes the smaller figure for the same carrier on the same
     * page.
     */
    /*
     * ★ ANCHORED ON THE SELECT LIST, NOT ON `LEAST` ★
     *
     * `LEAST(m.tonnes, n.remaining)` appears TWICE in this method — once in the select list and
     * once in the ORDER BY. Asserting the bare call passed with the select list changed back to the
     * raw tonnage, because the sort still contained the string. Mutation testing caught it. The
     * `::int AS tonnes` suffix is what makes this about the value the prompt prints.
     */
    expect(QUERY).toContain('LEAST(m.tonnes, n.remaining)::int AS tonnes');
  });

  it('★ MANDATORY: one row per commodity, merged by the module’s own rule ★', () => {
    /*
     * `colony_carrier_cargo` is keyed (market, commodity, SOURCE) and BOTH the journal push and a
     * hand-declared figure stamp `updated_by_id`. A commodity the member's app watched and then
     * corrected by hand is two rows, and summing them doubles the carrier's hold.
     *
     * Manual beats journal beats mirror, exactly as the shopping maths merges it. A second opinion
     * here is how one page comes to state two different tonnages for one carrier.
     */
    expect(QUERY).toContain('DISTINCT ON (g.market_id, lower(g.commodity))');
    /*
     * ★ THE RANK CHANGED, AND THIS TEST IS WHY THE CHANGE HAD TO BE DELIBERATE — 2026-08-18 ★
     *
     * It used to assert `CASE g.source WHEN 'manual' THEN 0 WHEN 'capi' THEN 1 WHEN 'journal' THEN
     * 2 ELSE 3 END` — cAPI ahead of the journal, always. That was written to stop a fortnight-old
     * journal reading beating Frontier's live manifest, which was the right worry and the wrong
     * fix: it also made a Frontier manifest from hours ago beat a journal reading from a minute
     * ago, while a member watched the cargo load.
     *
     * `effectiveTonnes` — which every other surface reads — resolves those two by RECENCY, with the
     * journal taking ties. One hold must not have two rules, so this query now asks the same
     * question, and the two halves are asserted separately because they are two separate claims.
     */
    // The member's own hand always wins: a manual figure is a statement, not a reading.
    expect(QUERY).toContain("CASE WHEN g.source = 'manual' THEN 0 ELSE 1 END");
    // Then the newest reading, whichever source produced it.
    expect(QUERY).toContain('g.updated_at DESC');
    // And the journal takes a tie, because it is first-party and the app was standing right there.
    expect(QUERY).toContain("CASE WHEN g.source = 'journal' THEN 0 ELSE 1 END");

    /*
     * ★ AND ZERO IS DISCARDED AFTER PRECEDENCE, NEVER BEFORE ★
     *
     * `AND g.tonnes > 0` used to sit inside the CTE, above the DISTINCT ON. Postgres therefore
     * removed zero rows as candidates BEFORE choosing a winner, so a manual "none of this is
     * aboard" or a cAPI zero could never win — and the prompt offered cargo already declared gone.
     *
     * The test belongs in the OUTER query, where it discards a zero that won rather than one that
     * was never allowed to compete.
     */
    const cte = QUERY.slice(QUERY.indexOf('WITH mine AS'), QUERY.indexOf('SELECT m.market_id'));
    expect(cte, 'the CTE must not filter zero out before precedence runs').not.toContain(
      'g.tonnes > 0',
    );
    expect(QUERY, 'the outer query drops a zero that won').toContain('WHERE m.tonnes > 0');
  });

  it('★ MANDATORY: it is grouped per CARRIER, not per commodity ★', () => {
    /*
     * The unit the prompt is about and the unit the button attaches. Leaving the grouping to each
     * surface is how the website and the companion come to describe one carrier two ways.
     */
    expect(QUERY).toContain('byCarrier');
    expect(QUERY, 'and the biggest contribution leads').toContain('b.tonnes - a.tonnes');
  });

  it('the carrier is named by its callsign, not by a market id', () => {
    // "3707348992 is holding 800 t" is a sentence no member can act on.
    expect(QUERY).toContain('callsignFromName');
    expect(QUERY, 'through the catalogue, on the indexed expression').toContain(
      "ki.data->>'marketId' = m.market_id::text",
    );
  });
});

describe('what it must not do', () => {
  it('★ MANDATORY: the prompt never fails the page ★', () => {
    /*
     * A prompt is worth less than the project page it sits on. If this query is slow or broken the
     * page must still render — the alternative is a nicety taking down the board.
     */
    expect(PROJECT).toContain('.catch(() => [])');
  });
});
