import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Does the app find out when an officer answers?
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "the support chat is working on the web but the support and ai responses are not seeming to flow
 * back to the companion app when an officer responds to a support ticket"
 *
 * The transcript was never the problem. `readForMember` returns every message in the conversation,
 * officers' included, and the panel re-reads it happily — while it is open.
 *
 * The poll gave up before that. It opened with `if (!openRef.current) return`, on the reasoning
 * that "a closed widget costs the hub nothing", so after a single load at launch a member running
 * the app with the panel shut never asked again. An officer could reply and the app had no way to
 * learn of it: the launcher's dot is computed from the conversation list, and the list had stopped
 * being read. The only way to discover an answer was to open the panel on a hunch, which is the
 * one thing a ticket that looks unanswered stops anybody doing.
 *
 * The WEBSITE widget has always had this right, and says so where it does it: "eagerly while the
 * panel is open, lazily for the launcher dot while it is not". This test exists so the app cannot
 * drift back to a single cadence that stops at the door.
 *
 * ★ WHY A SOURCE SCAN ★
 *
 * The widget is a Preact component in an Electron renderer, driven by a `window.help` bridge that
 * only exists inside the app. Standing that up to observe a timer would test the harness. What
 * actually broke was one early return, and reading for it is both cheaper and closer to the bug.
 */

const WIDGET = readFileSync(join('src', 'renderer', 'help-widget.tsx'), 'utf8');

describe('the help widget keeps watching while it is closed', () => {
  it('MANDATORY: the conversation list is not gated on the panel being open', () => {
    /*
     * The exact line that caused it. `load` began by returning when the panel was shut, which took
     * the LIST down with the transcript — and the list is the only thing the unread dot is
     * computed from.
     */
    expect(
      WIDGET,
      'load() returns early when the panel is closed again, which stops the unread dot updating',
    ).not.toMatch(/const load = \(\): void => \{\s*if \(!openRef\.current\) return;/);
  });

  it('MANDATORY: there is a second, slower cadence for the closed panel', () => {
    // Two subscriptions, two cadences — the website's shape. One timer cannot serve both.
    expect(WIDGET).toContain('IDLE_POLL_MS');
    expect(WIDGET).toMatch(/useLive\([\s\S]{0,120}loadList\(\)[\s\S]{0,40}IDLE_POLL_MS/);
  });

  it('the idle read is the LIST only — a transcript nobody can see is not worth fetching', () => {
    const idle = WIDGET.slice(WIDGET.indexOf('if (!openRef.current) loadList()'));
    expect(idle.slice(0, 200)).not.toContain('loadTranscript');
  });

  it('the open cadence stays faster than the closed one', () => {
    const open = /const POLL_MS = ([\d_]+);/.exec(WIDGET)?.[1]?.replace(/_/g, '');
    const idle = /const IDLE_POLL_MS = ([\d_]+);/.exec(WIDGET)?.[1]?.replace(/_/g, '');

    expect(open, 'POLL_MS is gone').toBeDefined();
    expect(idle, 'IDLE_POLL_MS is gone').toBeDefined();
    expect(Number(open)).toBeLessThan(Number(idle));
  });

  it('exactly one cadence does work at a time, so opening does not leave both firing', () => {
    // Each subscription checks `open` itself. Without that, an open panel would be read by the
    // idle timer as well, doubling the requests for no benefit.
    expect(WIDGET).toContain('if (openRef.current) load();');
    expect(WIDGET).toContain('if (!openRef.current) loadList();');
  });
});
