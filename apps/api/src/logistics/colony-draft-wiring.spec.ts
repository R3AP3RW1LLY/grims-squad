import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Drafting a system somebody has already started building.
 *
 * ★ SQUADRON OWNER, 2026-08-22 ★
 *
 * "if a system already has a partial build ask the user if they want to override it, or if they want
 * to keep it and we work around it etc."
 *
 * ★ WHAT IS WORTH GUARDING HERE ★
 *
 * The decision itself — what may move, what may not, what to ask — is a pure rule with thirteen
 * tests of its own in `colony-draft-mode.spec.ts`. What cannot be tested there is whether this
 * service actually USES it, and three specific ways of not using it would each be silent:
 *
 *   - drafting first and asking afterwards, which burns a model call on a layout about to be binned
 *   - never telling the model what already stands, so it proposes a station on an occupied slot
 *   - reading the named plan without the caller's visibility, making a draft a side door onto it
 *
 * None of those three fails a type check, and the first and third produce perfectly ordinary-looking
 * output. Hence a source-text test, and hence every assertion anchored to a line start: an
 * assertion on a bare string matches an import that has been commented out just as happily, which
 * has caught this project out five times.
 */

const HERE = join(process.cwd(), 'src', 'logistics');
const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

const SERVICE = 'system-advisor.service.ts';
const CONTROLLER = 'colony.controller.ts';

describe('drafting around what is already built', () => {
  it('★ MANDATORY: the model is told what it cannot move ★', () => {
    /*
     * The single most likely way this feature produces an unbuildable layout. A model handed a list
     * of bodies with no note of what stands on them proposes a second station on a taken slot, and
     * the result looks entirely professional.
     */
    const source = read(SERVICE);

    expect(source, 'the brief helper is imported').toMatch(
      /^\s*fixedBrief,$/m,
    );
    expect(source, 'and it is actually appended to the brief').toMatch(
      /^\s*\.\.\.\(kept\.length === 0 \? \[\] : \['', fixedBrief\(named\(kept, bodies\)\)\]\),$/m,
    );
  });

  it('★ MANDATORY: it asks BEFORE spending a model call ★', () => {
    /*
     * Drafting first and asking afterwards would spend a model call, and thirty seconds of
     * somebody's evening, on a layout they may be about to reject wholesale. The question must
     * return before `ai.ask` is ever reached.
     */
    const source = read(SERVICE);

    const asks = /^\s*if \(context\.mustAsk && options\.mode === undefined\) \{$/m.exec(source);
    expect(asks, 'the early return is live code, not a comment').not.toBeNull();

    const model = source.indexOf('this.ai.ask(DRAFT_PROMPT');
    expect(model, 'the model is called at all').toBeGreaterThan(-1);
    expect(asks?.index ?? -1, 'and the question comes first').toBeLessThan(model);
  });

  it('★ MANDATORY: the existing plan is read through the CALLER’s visibility ★', () => {
    /*
     * A draft must not become a side door onto a plan the member could not otherwise open. `byId`
     * resolves that and answers null when they may not — so the caller's id has to reach it.
     */
    const source = read(SERVICE);

    expect(source).toMatch(/^\s*const plan = await this\.plans\.byId\(planId, callerId\);$/m);
    expect(source, 'and a plan they cannot see contributes nothing').toMatch(
      /^\s*if \(plan === null\) return \[\];$/m,
    );
  });

  it('★ MANDATORY: "built" means what the plan page already shows ★', () => {
    /*
     * A second opinion here would have the drafter working around a different set of structures
     * than the badges on the page say are there — and the member would have no way to tell which
     * was lying.
     */
    const source = read(SERVICE);

    expect(source).toMatch(/^import \{ siteProgress \} from '@grims\/shared\/colony-plan-progress';$/m);
    expect(source).toMatch(/^\s*state: siteProgress\(\{$/m);
  });

  it('the controller refuses an answer that is not one of the two', () => {
    /*
     * Anything else is NO answer, which makes the service ask rather than silently picking one.
     * Defaulting to 'override' on a typo would discard somebody's plan.
     */
    const source = read(CONTROLLER);

    expect(source).toMatch(
      /^\s*const mode = body\.mode === 'keep' \|\| body\.mode === 'override' \? body\.mode : undefined;$/m,
    );
  });

  it('the controller passes the caller through, so the visibility check has something to check', () => {
    const source = read(CONTROLLER);
    const route = source.indexOf("@Post('systems/:name/draft')");
    expect(route).toBeGreaterThan(-1);

    const body = source.slice(route, route + 1400);
    expect(body).toMatch(/callerId: me\.userId,/);
    expect(body, 'and only a non-empty plan id').toMatch(/body\.planId !== ''/);
  });

  it('a draft with no plan named still works exactly as it did', () => {
    /*
     * The ordinary case, and the one a regression here would break silently: drafting a fresh
     * system must not start demanding a plan id or asking a question about a plan that is not there.
     */
    const source = read(SERVICE);

    expect(source).toMatch(
      /^\s*if \(planId === undefined \|\| planId === '' \|\| callerId === undefined\) return \[\];$/m,
    );
  });
});
