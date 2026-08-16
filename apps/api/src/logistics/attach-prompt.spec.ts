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
    expect(CARRIER).toContain('g.updated_by_id = $2::uuid');
  });

  it('★ MANDATORY: a signed-out reader gets nothing ★', () => {
    // No caller, no owner, no prompt — rather than a query with a null owner that matches rows.
    expect(PROJECT).toContain('caller === undefined');
  });

  it('★ MANDATORY: only commodities the build STILL wants ★', () => {
    /*
     * A carrier full of something already delivered is not worth interrupting anybody about.
     *
     * ★ ANCHORED ON A STRING UNIQUE TO THIS QUERY ★
     *
     * Two earlier attempts asserted on fragments — `n.remaining > 0`, then
     * `AND n.project_id = $1::uuid` — that BOTH appear in an unrelated query elsewhere in this
     * service. Each passed with the clause deleted, so each said something true about the file and
     * nothing whatever about the code it named. Mutation testing caught both.
     *
     * The select list below exists once. Slicing from it is the only way to be sure the window
     * being searched is this method's.
     */
    const start = CARRIER.indexOf('g.market_id::text AS market_id, g.commodity, g.tonnes::int');
    expect(start, 'the prompt query itself must exist').toBeGreaterThan(-1);

    expect(CARRIER.slice(start, start + 600)).toContain('n.remaining > 0');
  });

  it('★ MANDATORY: nothing already attached to THIS build is offered again ★', () => {
    expect(CARRIER).toContain('NOT EXISTS');
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
