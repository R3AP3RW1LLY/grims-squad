import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Where the mandatory Frontier step sits, and what it is allowed to stop.
 *
 * ★ WHY A SOURCE SCAN ★
 *
 * The same reason `help-widget-polling.spec.ts` gives: the thing under test is a Preact component
 * inside an Electron renderer, driven by a `window.companion` bridge that only exists in the app.
 * Standing that up would test the harness. What can actually be got wrong here is an ORDERING and
 * a set of things the gate must not touch, and reading for those is both cheaper and closer to the
 * mistake.
 *
 * `frontier-gate.spec.ts` covers the decision itself. This covers where the decision is applied.
 */

const src = (name: string): string => readFileSync(join(process.cwd(), 'src', name), 'utf8');

const APP = src(join('renderer', 'app.tsx'));
const MAIN = src('main.ts');
const CONFIG = src('config.ts');

describe('the Frontier step stands after pairing, and takes the whole window', () => {
  it('found the two gates to compare', () => {
    // If either line is reworded this must fail loudly rather than quietly protect nothing.
    expect(APP).toContain("if (!state.paired) return <SignIn");
    expect(APP).toMatch(/if \(state\.frontier\.step !== 'pass'\) return </);
  });

  it('★ MANDATORY: pairing is asked for first ★', () => {
    /*
     * The order the owner described: Discord sign-in, then the device pairing, THEN Frontier. It is
     * also the only order that can work — the Frontier answer arrives on a call authenticated by
     * the device token, so an unpaired app has nothing to ask with and would show a screen it could
     * never clear.
     */
    const pairing = APP.indexOf("if (!state.paired) return <SignIn");
    const frontier = APP.search(/if \(state\.frontier\.step !== 'pass'\) return </);

    expect(pairing).toBeGreaterThan(-1);
    expect(frontier).toBeGreaterThan(-1);
    expect(frontier).toBeGreaterThan(pairing);
  });

  it('takes the whole window, exactly as the pairing gate does', () => {
    /*
     * "One screen, one action" — the reasoning already written above the pairing gate. A sidebar of
     * destinations that all say "connect Frontier first" is nine ways to be told the same thing, and
     * this gate is placed to match rather than to have a second opinion about it.
     */
    const frontier = APP.search(/if \(state\.frontier\.step !== 'pass'\) return </);
    const shell = APP.indexOf("<div style={{ display: 'flex', height: '100vh'");
    expect(shell).toBeGreaterThan(-1);
    expect(frontier).toBeLessThan(shell);
  });
});

describe('the gate is the hub’s answer, never something this machine remembers', () => {
  it('★ MANDATORY: nothing about Frontier is persisted ★', () => {
    /*
     * "EXISTING members who already paired must see this on update, not just new installs."
     *
     * The way that requirement gets broken is a `frontierDone: true` written into the config the
     * first time somebody clears the gate — after which the app believes its own file for ever and
     * a revoked grant is invisible to it. There is nothing to write: the hub already knows, and it
     * is the only thing that does.
     */
    expect(CONFIG, 'config.ts must hold nothing about Frontier').not.toMatch(/frontier|capi/i);
    expect(MAIN, 'no Frontier state may be written to the config file').not.toMatch(
      /saveConfig\([^)]*frontier/i,
    );
  });

  it('the gate is computed from the hub settings, not from the config', () => {
    /*
     * The inputs moved into `gateInputs()` when the settings page grew a Frontier tab: the gate and
     * the tab must describe one link, so they are built from one set of inputs rather than two
     * reads that could drift. This follows them there — the property being guarded is unchanged
     * and is what it always was: the ANSWER comes from the hub, and `config` supplies only whether
     * there is a device token to ask with.
     */
    const call = MAIN.slice(MAIN.indexOf('function gateInputs('));
    const args = call.slice(0, call.indexOf('\n}') + 2);

    expect(args, 'gateInputs() must read the hub answer').toContain('hubSettings');
    expect(args, 'and nothing about Frontier may come off the disk').not.toMatch(
      /config\.(?!deviceToken)/,
    );

    // Both callers go through it, so neither can quietly grow a second source of truth.
    expect(MAIN).toContain('frontierGate(gateInputs())');
    expect(MAIN).toContain('frontierAccount(gateInputs())');
  });

  it('★ MANDATORY: the hub is asked even while sending is paused ★', () => {
    /*
     * The lockout this exists for. `refreshHubSettings` used to run ONLY from `tick()`, and `tick()`
     * runs only while `config.enabled` — so a member who had pressed Pause would never receive an
     * answer, and the gate would sit on "checking" for ever with no way out and nothing to press.
     *
     * `refreshCurrentProject` and `refreshStandingOrders` already have their own clocks for exactly
     * this reason: pausing uploads is not a statement about wanting the rest of the app dark.
     */
    expect(MAIN).toMatch(/setInterval\(\(\) => void refreshHubSettings\(\)/);
  });
});

describe('what the gate is NOT allowed to stop', () => {
  it('★ MANDATORY: the main process never acts on it ★', () => {
    /*
     * The single mitigation that makes "mandatory" defensible: the gate covers the WINDOW, and
     * nothing else. Journal upload, the tray, and every overlay live in the main process, and a
     * member parked on the Frontier screen is still contributing, still has their mining panels
     * over the game, and still shows as flying on the roster.
     *
     * So `frontierGate` is called exactly once — to publish the verdict to the window — and never
     * as a condition on anything the main process does. A second call site is how that quietly
     * stops being true.
     */
    const calls = [...MAIN.matchAll(/frontierGate\(/g)].length;
    expect(calls, 'frontierGate must be consulted once, only to tell the window').toBe(1);
  });

  it('the overlays know nothing about it', () => {
    // Drawn over the game by their own windows. If this file ever imports the gate, somebody has
    // started deciding whether to draw a mining panel based on an OAuth grant.
    expect(src(join('renderer', 'overlay.tsx'))).not.toMatch(/frontier/i);
  });

  it('the screen says the app is still working behind it', () => {
    /*
     * Not decoration. A member who is told they cannot use the app, while the app is in fact still
     * uploading their journals, has been misled about what is happening on their own machine —
     * and it is the one sentence that turns this screen from a wall into a wait.
     */
    expect(APP).toMatch(/still (uploading|going|running)|keeps? (uploading|running)/i);
  });
});

describe('starting the link', () => {
  it('opens the member’s own browser at the WEBSITE, not the API', () => {
    /*
     * The bug this repeats otherwise is already recorded in `openHub`: building a member-facing
     * link from `apiBaseUrlFor` works in production, where one origin serves both, and opens a JSON
     * 404 on any development machine — where the site is on :5000 and the API on :5001.
     */
    const handler = MAIN.slice(MAIN.indexOf("ipcMain.handle('connectFrontier'"));
    expect(handler.slice(0, 1200)).toContain('webBaseUrlFor');
    expect(handler.slice(0, 1200)).not.toContain('apiBaseUrlFor');
  });

  it('★ MANDATORY: the app never handles the Frontier exchange itself ★', () => {
    /*
     * `device-link.ts` states the rule for this whole app: a desktop application has nowhere to keep
     * a client secret, and a window it controls asking for credentials is the habit phishing depends
     * on. The member goes to Frontier in a browser with an address bar; every token stays on the
     * hub. Nothing here may grow a code, a verifier or a token.
     */
    expect(MAIN).not.toMatch(/code_verifier|code_challenge|client_secret/i);
    expect(APP).not.toMatch(/code_verifier|code_challenge|client_secret/i);
  });
});

describe('the way back to Frontier once you are already through the gate', () => {
  it('found the settings tab list to reason about', () => {
    // The anchor. If the tab list is restructured this fails loudly rather than protecting nothing.
    expect(APP).toContain("label=\"Settings sections\"");
  });

  it('★ MANDATORY: Settings carries a Frontier tab ★', () => {
    /*
     * ★ SQUADRON OWNER, 2026-08-16 ★
     *
     * "there is no reconnect to Frontier button in the companion app at all! you said there was!"
     *
     * He was right and my reading of the source was wrong in a way source-reading is prone to: the
     * button existed, and I confirmed it existed, and it was still unreachable. It is rendered by
     * `ConnectFrontier` — the GATE screen — which by construction only appears when the gate is
     * NOT passing. Connect successfully and the screen is replaced by the app, taking the only
     * route to reconnecting with it.
     *
     * So the assertion is not "a Reconnect button exists somewhere in this file". That was true
     * throughout the complaint. It is that the SETTINGS page — which a member can open whenever
     * they like, gate passed or not — offers one.
     */
    const tabs = APP.slice(APP.indexOf('label="Settings sections"'));
    const list = tabs.slice(0, tabs.indexOf('/>'));

    expect(list).toContain("{ key: 'frontier', label: 'Frontier' }");
    expect(tabs).toContain("tab === 'frontier' ? <FrontierSettings");
  });

  it('★ MANDATORY: the reconnect action does not depend on anything looking broken ★', () => {
    /*
     * The fortnight in `frontierAccount`'s note: seven grants the hub reported as healthy and
     * `linked: true` for fourteen days, none of which worked, because the poller decoded the stored
     * token wrong. A button gated on the hub reporting a problem is hidden for the whole of an
     * outage like that one.
     *
     * `canReconnect` is decided in frontier-gate.ts from `paired` alone, and this asserts the panel
     * does not add a second condition of its own on top of it.
     */
    const panel = APP.slice(APP.indexOf('function FrontierSettings'));
    const body = panel.slice(0, panel.indexOf('function NavButton'));

    expect(body).toContain('view.canReconnect ?');
    expect(body).toContain('window.companion.connectFrontier()');
    // No second opinion about health standing between a member and the button.
    expect(body).not.toMatch(/canReconnect\s*&&/);
  });
});
