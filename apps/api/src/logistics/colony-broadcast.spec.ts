import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A delivery anybody makes must reach everybody watching.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "when we are planning ... we need all of this in full parity" — and the live-update behaviour was
 * asked for as Raven's 30-second poll.
 *
 * ★ THE PLATFORM ALREADY HAD SOMETHING BETTER, AND IT WAS SCOPED WRONG ★
 *
 * `LiveRefresh` pushes over SSE, so a watcher updates in under a second rather than up to thirty.
 * But `telemetry` is published with the UPLOADING member's id, and the fan-out rule in
 * `LiveService.publish` sends a user-scoped event to that member alone:
 *
 *     if (event.userId !== null && sub.userId !== event.userId) continue;
 *
 * So when one member delivered cargo, every OTHER member watching the same project sat on stale
 * figures until they reloaded — and three members hauling to one site is the ordinary case for
 * colonisation, not the exception. Raven's poll papers over this by asking again regardless of who
 * did what; the push had to be corrected instead.
 *
 * The companion never had the gap: it polls every 20 seconds and reloads on device state, and
 * polling does not care who delivered.
 */

const REPO = join(process.cwd(), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

describe('a colonisation delivery is broadcast', () => {
  it('★ MANDATORY: the event is squadron-wide, not per-member ★', () => {
    /*
     * `userId: null` is the entire fix. Publishing it with the uploader's id would reproduce the
     * bug exactly, and the page would still look live to the one person who did not need telling.
     */
    const wiring = read('apps/api/src/telemetry/telemetry.module.ts');

    expect(wiring, 'the colony event is published').toMatch(/type:\s*'colony'/);
    expect(wiring, 'and to everybody, not just the uploader').toMatch(
      /type:\s*'colony',\s*userId:\s*null/,
    );
  });

  it('★ MANDATORY: it fires AFTER the delivery is folded in ★', () => {
    /*
     * A watcher told to re-read before the ledger row exists re-reads the OLD figures and then
     * hears nothing more — a refresh that actively confirms the wrong number, which is worse than a
     * second of staleness.
     */
    const service = read('apps/api/src/logistics/colony-live.service.ts');

    /*
     * Matched on a LIVE line, not on the string: `indexOf` finds the text just as happily inside
     * `// this.broadcast?.();`, and commenting the call out survived this test the first time it
     * was written. That is the fifth time in this session a source assertion has matched a comment.
     */
    const liveCall = /^\s*this\.broadcast\?\.\(\);/m.exec(service);
    expect(liveCall, 'the announcement is live code, not a comment').not.toBeNull();

    const fold = service.indexOf('identifyBuildTypes(this.db)');
    expect(fold, 'the fold happens').toBeGreaterThan(-1);
    expect(liveCall?.index ?? -1, 'and it happens after the fold').toBeGreaterThan(fold);
  });

  it('★ MANDATORY: the project page listens for it ★', () => {
    /*
     * Publishing to nobody is the failure this project keeps finding. Anchored so a commented-out
     * subscription cannot pass.
     */
    const page = read('apps/web/src/app/(hub)/colonisation/[id]/page.tsx');

    expect(page).toMatch(/^\s*<LiveRefresh types=\{\['telemetry', 'colony'\]\}/m);
  });

  it('the event carries no payload', () => {
    /*
     * Watchers re-read through the endpoint that already decides what they may see, so a broadcast
     * costs the worst case a re-read of a page they were looking at anyway. An event carrying the
     * delivery itself would be a second, unguarded way to learn something.
     */
    const live = read('apps/api/src/live/live.service.ts');

    expect(live).toMatch(/readonly type: LiveEventType;/);
    expect(live, 'only a type and a who').toMatch(/readonly userId: string \| null;/);
  });

  it('the broadcast is optional, so rows land without a listener', () => {
    // A delivery must never fail because nobody was watching.
    const service = read('apps/api/src/logistics/colony-live.service.ts');

    expect(service).toMatch(/private readonly broadcast\?: \(\) => void/);
    // Live code, for the same reason as above.
    expect(service, 'called defensively').toMatch(/^\s*this\.broadcast\?\.\(\);/m);
  });
});
