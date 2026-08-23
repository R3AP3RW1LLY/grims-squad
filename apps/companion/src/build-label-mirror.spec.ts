import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The build_type_id must be on screen wherever a member picks or reads a build — on BOTH surfaces.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "the build_type_id should be provided in that list so we know what we're choosing ... and remember
 * we need all of this in full parity on the website and the companion app"
 *
 * A member plans here and builds in the game. "Refinery Hub" says what a structure does; `silenus`
 * is what the architect view calls it. Without the id the planner sends them off to look it up,
 * which is the work the planner exists to remove. The build books have printed ids on every row
 * since they were written; the planner never did.
 *
 * ★ WHY A SOURCE-TEXT MIRROR ★
 *
 * Same reasoning as the colonisation menu, the orphan flags and the scout notice before it. These
 * are a React component and a Preact component in different packages and runtimes; nothing links
 * them, and this is the FOURTH thing to drift between these two screens.
 *
 * The wording is not duplicated — both call `buildTypeLabel` in @grims/shared, so the format cannot
 * disagree. What this guards is that each surface still asks.
 */

const REPO = join(process.cwd(), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

const SURFACES = [
  ['website picker/tree', 'apps/web/src/app/(hub)/colonisation/planning/[id]/system-tree.tsx'],
  ['website build order', 'apps/web/src/app/(hub)/colonisation/planning/[id]/build-order.tsx'],
  ['website economy table', 'apps/web/src/app/(hub)/colonisation/planning/[id]/economy-markets.tsx'],
  ['companion planning', 'apps/companion/src/renderer/planning.tsx'],
] as const;

describe('the build_type_id is shown on both surfaces', () => {
  it('★ MANDATORY: every surface uses the shared label ★', () => {
    for (const [what, rel] of SURFACES) {
      const src = read(rel);

      // A guard on the guard: a moved file would read empty and pass everything below.
      expect(src.length, `${what} is readable`).toBeGreaterThan(500);
      expect(src, `${what} must show the build_type_id`).toContain('colony-build-label');
    }
  });

  it('★ MANDATORY: nothing renders a build type without its id ★', () => {
    /*
     * The exact pattern that was there before — a display name with no id beside it. If it comes
     * back, a member is reading "Refinery Hub" with nothing they can type into the game.
     *
     * Matched on the RENDER, not the string: `buildTypeName` still appears legitimately in types
     * and in the label calls themselves.
     */
    for (const [what, rel] of SURFACES) {
      const src = read(rel);

      expect(
        src,
        `${what} renders a bare build type name with no id`,
      ).not.toMatch(/\{\s*s\.buildTypeName\s*\?\?\s*'nothing chosen/);
      expect(
        src,
        `${what} renders a bare display name in a picker`,
      ).not.toMatch(/\{\s*b\.displayName\s*\}/);
    }
  });

  it('the id is rendered verbatim, not prettified', () => {
    /*
     * It is typed into the game exactly as stored. If a surface ever upper-cases it, the planner
     * and the build books disagree by one keystroke and a member has to know which to trust.
     */
    const shared = read('packages/shared/src/colony-build-label.ts');

    expect(shared).toContain('export function buildTypeLabel');
    expect(shared, 'no case transformation anywhere in the formatter').not.toMatch(
      /toUpperCase|toLocaleUpperCase|charAt\(0\)\.toUpperCase/,
    );
  });
});

/**
 * A body asked for more builds than it has room for must say so on BOTH surfaces.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "should the planner stop you building more structures on a body than it has slots for" — warn,
 * but let it through.
 *
 * Both surfaces already printed "2 of 3" and said nothing at all when it became "4 of 3". A member
 * reading a count they have exceeded has no reason to look twice at it.
 *
 * The wording is not duplicated — both call `slotWarnings` in @grims/shared — so what this guards
 * is that each surface still asks.
 */
describe('an overcommitted body is flagged on both surfaces', () => {
  const PLANNERS = [
    ['website', 'apps/web/src/app/(hub)/colonisation/planning/[id]/system-tree.tsx'],
    ['companion', 'apps/companion/src/renderer/planning.tsx'],
  ] as const;

  it('★ MANDATORY: both planners check the recorded slot count ★', () => {
    for (const [what, rel] of PLANNERS) {
      const src = read(rel);

      expect(src.length, `${what} planner is readable`).toBeGreaterThan(1_000);
      expect(src, `${what} must warn when a body is overcommitted`).toContain('slotWarnings');
    }
  });

  it('★ MANDATORY: neither warns on an UNRECORDED body ★', () => {
    /*
     * Null slots mean nobody has looked, not "no room". Warning on those would put a message on
     * every unsurveyed body — 120 of the 184 held — and a planner that always warns is one nobody
     * reads. Both surfaces must guard on `cap === null` before asking.
     */
    for (const [what, rel] of PLANNERS) {
      /*
       * Asserts the null guard sits immediately BEFORE the call, which is the actual requirement —
       * an earlier version matched on the ternary's shape and was defeated by indentation, which
       * tested formatting rather than behaviour.
       *
       * `[\s\S]` rather than `\s` with a real newline in it: a line break cannot sit inside a
       * regex literal, and writing it that way broke the file outright.
       */
      expect(read(rel), `${what} skips bodies with no recorded slots`).toMatch(
        /cap === null[\s\S]{0,80}slotWarnings/,
      );
    }
  });

  it('the warning wording lives in one place', () => {
    const shared = read('packages/shared/src/colony-slots.ts');
    expect(shared).toContain('export function slotWarnings');

    for (const [what, rel] of PLANNERS) {
      expect(
        read(rel),
        `${what} must not hand-write the overcommit sentence`,
      ).not.toMatch(/slots? recorded\. Check the architect/i);
    }
  });
});

/**
 * The system summary panel must exist on BOTH surfaces and agree on every figure.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "we would like our planning and scouting and all colonization pages to look like this ... remember
 * we need all of this in full parity on the website and the companion app"
 *
 * The seven effects came down per build type since the catalogue shipped and nothing added them up.
 * Every number, label and rule now lives in @grims/shared, so the two surfaces cannot disagree about
 * what a system is worth — only the chrome differs.
 */
describe('the system summary is on both surfaces', () => {
  const PANELS = [
    ['website', 'apps/web/src/app/(hub)/colonisation/planning/[id]/system-summary.tsx'],
    ['companion', 'apps/companion/src/renderer/system-summary.tsx'],
  ] as const;

  it('★ MANDATORY: both panels exist and use the shared summariser ★', () => {
    for (const [what, rel] of PANELS) {
      const src = read(rel);

      expect(src.length, `${what} panel is readable`).toBeGreaterThan(800);
      expect(src, `${what} must use the shared summariser`).toContain('summariseSystem');
      expect(src, `${what} must use the shared labels`).toContain('EFFECT_LABELS');
    }
  });

  it('★ MANDATORY: both are actually RENDERED, not merely written ★', () => {
    /*
     * A panel nobody renders is the failure this project keeps having — seven times this session.
     * Anchored so a commented-out call cannot pass.
     */
    expect(
      read('apps/web/src/app/(hub)/colonisation/planning/[id]/page.tsx'),
      'the website renders the panel',
    ).toMatch(/^\s*<SystemSummary/m);
    expect(
      read('apps/companion/src/renderer/planning.tsx'),
      'the app renders the panel',
    ).toMatch(/^\s*<SystemSummary/m);
  });

  it('★ MANDATORY: neither presents the score as Raven figures ★', () => {
    /*
     * Raven publishes a System Score and not its formula. A number that looked like theirs and
     * disagreed would be worse than showing none, because a member would plan against it. Both
     * panels must say the figure is this platform's own.
     */
    for (const [what, rel] of PANELS) {
      expect(read(rel), `${what} labels the score as ours`).toMatch(/ours|our own figure/i);
    }
  });

  it('both derive BUILT from the shared progress helper, not a local rule', () => {
    // A second rule would eventually disagree with the build order about the same site.
    for (const [what, rel] of PANELS) {
      expect(read(rel), `${what} uses siteProgress`).toContain('siteProgress');
    }
  });
});

/**
 * Pinning a site, and the tier cost that never reached the app.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Pin a site to see details about it. This will update in real time as you make changes."
 *
 * ★ AND A PARITY GAP THAT WAS REPORTED AS CLOSED ★
 *
 * 0.10.1 shipped the picker warnings as "refuses impossible surface builds AND shows tier cost
 * against what is banked". Only the refusal reached the companion: the hub had always sent
 * needsTier and needsPoints, hub-colony.ts never named them, and the app dropped them on the floor.
 * Found while building the pinned panel, which needed the same two numbers.
 *
 * That is the third time a field the hub sends has been silently discarded because the app's type
 * did not declare it — after trade/selfSufficiency/prices, and after orphanFlags.
 */
describe('pinning a site works on both surfaces', () => {
  const PINNED = [
    ['website', 'apps/web/src/app/(hub)/colonisation/planning/[id]/pinned-site.tsx'],
    ['companion', 'apps/companion/src/renderer/pinned-site.tsx'],
  ] as const;

  it('★ MANDATORY: both panels exist and use the shared rule ★', () => {
    for (const [what, rel] of PINNED) {
      const src = read(rel);
      expect(src.length, `${what} pinned panel is readable`).toBeGreaterThan(800);
      expect(src, `${what} uses the shared siteDetail`).toContain('siteDetail');
    }
  });

  it('★ MANDATORY: both trees actually RENDER the panel ★', () => {
    // A panel nobody renders is the failure this project keeps having. Anchored to line-start so a
    // commented-out call cannot pass.
    expect(
      read('apps/web/src/app/(hub)/colonisation/planning/[id]/system-tree.tsx'),
      'the website renders the pinned panel',
    ).toMatch(/^\s*<PinnedSite/m);
    expect(
      read('apps/companion/src/renderer/planning.tsx'),
      'the app renders the pinned panel',
    ).toMatch(/^\s*<PinnedSite/m);
  });

  it('★ MANDATORY: both pin by ID, never by holding the site object ★', () => {
    /*
     * Holding the object freezes it at the moment it was pinned, so the panel goes on describing a
     * build that has since changed — the opposite of what pinning is for.
     */
    for (const [what, rel] of [
      ['website', 'apps/web/src/app/(hub)/colonisation/planning/[id]/system-tree.tsx'],
      ['companion', 'apps/companion/src/renderer/planning.tsx'],
    ] as const) {
      const src = read(rel);
      expect(src, `${what} stores the id`).toMatch(/setPinnedId/);
      expect(src, `${what} looks the site up fresh`).toMatch(/plan\.sites\.find/);
    }
  });

  it('★ MANDATORY: the companion declares the tier-cost fields the hub sends ★', () => {
    /*
     * The gap this work uncovered. A field the hub sends and the app does not declare is a field the
     * app throws away, silently — and the picker then shows no cost while the website shows one.
     */
    const hub = read('apps/companion/src/hub-colony.ts');

    /*
     * Anchored to line-start so a COMMENTED-OUT declaration cannot pass. Written with a plain match
     * first and the mutation survived: `// readonly needsTier: number;` still contains the text.
     * That is the fourth time in this session a source-text assertion has matched a comment.
     */
    expect(hub, 'needsTier must be declared').toMatch(/^\s*readonly needsTier: number;/m);
    expect(hub, 'needsPoints must be declared').toMatch(/^\s*readonly needsPoints: number;/m);
  });

  it('★ MANDATORY: both pickers show what a build spends ★', () => {
    for (const [what, rel] of [
      ['website', 'apps/web/src/app/(hub)/colonisation/planning/[id]/system-tree.tsx'],
      ['companion', 'apps/companion/src/renderer/planning.tsx'],
    ] as const) {
      const src = read(rel);
      expect(src, `${what} picker shows the tier cost`).toMatch(/needs \$\{b\.needsPoints\}/);
      expect(src, `${what} picker warns when it is not banked`).toContain('only ${have} banked');
    }
  });
});
