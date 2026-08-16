import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The abandoned state, in the app.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "we also need to allow admins to mark builds as abandoned and not always just as complete.
 * abandond projects should be hidden to all other members except the project owner please. and
 * should appear red."
 *
 * ★ WHY THIS IS A SOURCE SCAN AND NOT A RENDER TEST ★
 *
 * The same reason `colonisation-mirror.spec.ts` beside it is: this renderer is a single 3,700-line
 * module wired to an Electron bridge, and standing that up in a test would assert far more about
 * the harness than about the app. What actually goes wrong here is WIRING — a control drawn for the
 * wrong people, a rule reimplemented locally, a state read in the wrong order — and every one of
 * those is visible in the source.
 *
 * A `.spec.ts` and not `.spec.tsx` on purpose: `tsconfig.json` excludes the former from the build
 * and NOT the latter, so a `.spec.tsx` would be compiled into `dist` and shipped.
 */

/*
 * Resolved from `process.cwd()` like `colonisation-mirror.spec.ts` beside it, and NOT from
 * `import.meta.url`: this package compiles to CommonJS, where `import.meta` is a hard build error.
 */
const SRC_DIR = join(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(join(SRC_DIR, rel), 'utf8');

const SRC = read('renderer/colonisation.tsx');
const PRELOAD = read('preload.ts');
const MAIN = read('main.ts');

describe('the rule comes from @grims/shared, not from here', () => {
  it('★ MANDATORY: the app filters with the same function the website filters with ★', () => {
    /*
     * Two implementations of "is this build still wanting hauling" is precisely how the app and the
     * site start showing one member a different board from another. The rule lives in one module
     * and both surfaces import it.
     */
    expect(SRC).toContain('matchesColonyFilter');
    expect(SRC).toContain('colonyStatusOf');
  });

  it('★ MANDATORY: imported by SUBPATH, because the barrel reaches node:crypto ★', () => {
    /*
     * `renderer-imports.spec.ts` enforces this across the whole renderer and would fail too. It is
     * asserted again here because the failure it prevents is a runtime one — a broken bundle in a
     * shipped app — and this is the file that introduced the import.
     */
    expect(SRC).toContain("from '@grims/shared/colony-status'");
    expect(SRC, 'the barrel would drag node:crypto into a browser bundle').not.toMatch(
      /from '@grims\/shared'/,
    );
  });

  it('★ MANDATORY: the default view is the shared constant, not a copy of the string ★', () => {
    // A hardcoded 'in-progress' here would keep working right up until the shared default changed,
    // and then the two surfaces would silently open on different views.
    expect(SRC).toContain('useState<ColonyStatusFilter>(DEFAULT_COLONY_FILTER)');
  });
});

describe('what a member sees', () => {
  it('★ MANDATORY: abandoned is read BEFORE complete, everywhere it is drawn ★', () => {
    /*
     * Both stamps can be set, and the ordinary way that happens is an officer correcting a build
     * somebody wrongly called finished. Testing `completedAt` first would draw "Complete" for
     * exactly the row the officer acted to overturn.
     *
     * Asserted as the ORDER in the status tile, which is where the two are weighed against each
     * other in one expression.
     */
    const tile = SRC.slice(SRC.indexOf('label="Status"'));
    const abandonedFirst = tile.indexOf('project.abandonedAt !== null');
    const completeAfter = tile.indexOf('project.completedAt !== null');

    expect(abandonedFirst).toBeGreaterThan(-1);
    expect(abandonedFirst).toBeLessThan(completeAfter);
  });

  it('★ MANDATORY: the COMPLETE badge is suppressed on an abandoned build ★', () => {
    // Otherwise a corrected build carries both words at once, which tells a member nothing except
    // that the app cannot make up its mind.
    expect(SRC).toContain("p.completedAt !== null && p.abandonedAt === null");
  });

  it('★ MANDATORY: it is red, using the palette rather than a new hex ★', () => {
    // `C.bad` is the design system's red and is what the website's --color-semantic-hostile matches.
    expect(SRC).toContain('ABANDONED');
    expect(SRC).toMatch(/ABANDONED[\s\S]{0,200}C\.bad|C\.bad[\s\S]{0,200}ABANDONED/);
  });
});

describe('who may abandon one', () => {
  it('★ MANDATORY: the control is drawn for officers, not for the poster ★', () => {
    /*
     * `mayDirect` is true for the poster of a personal build. Abandoning takes the project off
     * everybody else's board and stops work the squadron may have committed playing time to, which
     * was never one member's call — the same reasoning that keeps adoption and priority with
     * officers.
     */
    const actions = SRC.slice(SRC.indexOf('Abandon this build') - 2_000);
    expect(actions).toContain('can.manage ? (');
  });

  it('★ MANDATORY: cancelling the reason prompt does NOT abandon the build ★', () => {
    /*
     * `window.prompt` returns null when the officer presses Escape or Cancel. Treating that as an
     * empty note would abandon a build somebody had just decided not to abandon — a destructive
     * action taken from a gesture that means "stop".
     */
    expect(SRC).toContain('if (note === null) return;');
  });
});

describe('the bridge', () => {
  it('★ MANDATORY: the renderer cannot reach the hub except through preload and IPC ★', () => {
    // Each hop has to exist or the button throws at runtime with nothing catching it first.
    expect(PRELOAD, 'preload must expose it').toContain("ipcRenderer.invoke('colonyAbandoned'");
    expect(MAIN, 'main must handle it').toContain("ipcMain.handle('colonyAbandoned'");
  });

  it('★ MANDATORY: anything but a literal true fails closed ★', () => {
    /*
     * The value crosses a process boundary as `unknown`. A truthy-but-not-true value — the string
     * "false" is the classic — must not read as "abandon it", because the failure is silent and
     * takes a build off the board.
     */
    const handler = MAIN.slice(MAIN.indexOf("ipcMain.handle('colonyAbandoned'"), MAIN.indexOf("ipcMain.handle('colonyAbandoned'") + 700);

    /*
     * ★ COMMENTS ARE STRIPPED BEFORE ASSERTING, AND THAT IS THE POINT ★
     *
     * The first version of this test searched the raw handler for `on === true` and passed while the
     * code said `Boolean(on)` — because the COMMENT beside the code contains the same words. It was
     * a test of the prose explaining the guard rather than of the guard, and mutating the guard did
     * not fail it.
     *
     * `Boolean(on)` is the mutation that matters: the string "false" is truthy, and the value
     * arrives over IPC as `unknown`.
     */
    const code = handler.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(code).toContain('on === true');
    expect(code, 'a truthy check would let the string "false" abandon a build').not.toContain(
      'Boolean(on)',
    );
  });
});
