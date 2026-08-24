import { describe, expect, it } from 'vitest';
import { overlayFocus, type FocusInput } from './overlay-focus.js';

/**
 * Which project the overlay talks about, and why.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Use the Primary button to set or clear your primary project."
 *
 * The overlay already followed the dock and had nothing to fall back to anywhere else. Asked which
 * should win when a chosen primary and a docked site disagree, the owner's answer was the dock —
 * a member handing cargo over is unambiguously working on THAT site.
 */

const input = (over: Partial<FocusInput> = {}): FocusInput => ({
  dockedProjectId: null,
  primaryProjectId: null,
  activeProjectIds: ['a', 'b'],
  showAll: false,
  ...over,
});

describe('choosing what the overlay shows', () => {
  it('★ MANDATORY: docked beats the primary ★', () => {
    /*
     * Showing a different project's shopping list at the moment somebody is handing cargo over
     * would be wrong exactly when it matters most.
     */
    const f = overlayFocus(input({ dockedProjectId: 'b', primaryProjectId: 'a' }));

    expect(f.projectId).toBe('b');
    expect(f.reason).toBe('docked');
  });

  it('★ MANDATORY: says WHY, so a member can trust it ★', () => {
    /*
     * Somebody who set a primary and then sees a different project needs to know it is because they
     * are docked, not because the setting was lost. A panel that silently switches focus is one
     * nobody trusts.
     */
    expect(overlayFocus(input({ dockedProjectId: 'b', primaryProjectId: 'a' })).because).toMatch(
      /docked/i,
    );
    expect(overlayFocus(input({ primaryProjectId: 'a' })).because).toMatch(/primary/i);
  });

  it('★ MANDATORY: docking somewhere ELSE says so, rather than looking broken ★', () => {
    /*
     * The case whose behaviour changed, so the case most likely to be read as a bug. A member who
     * set a primary, flew to another site to help out, and found a project they did not pick on
     * their overlay would reasonably conclude the setting was lost.
     */
    const f = overlayFocus(input({ dockedProjectId: 'b', primaryProjectId: 'a' }));

    expect(f.because).toMatch(/not your primary/i);
  });

  it('does not say "not your primary" when it IS the primary', () => {
    // Nor when none is set — there is nothing to have been diverted from.
    expect(overlayFocus(input({ dockedProjectId: 'a', primaryProjectId: 'a' })).because).not.toMatch(
      /not your primary/i,
    );
    expect(overlayFocus(input({ dockedProjectId: 'a' })).because).not.toMatch(/not your primary/i);
  });

  it('★ MANDATORY: only the surprising cases are worth a line on a cockpit strip ★', () => {
    /*
     * `notable` is decided here so neither surface has to match on the prose to know whether to draw
     * it — two copies of that rule would drift the first time the wording changed.
     *
     * Obvious: docked at your own build (the title bar already says where you are), and the primary
     * doing exactly what you set it to do. Surprising: a diversion, and a setting that has quietly
     * stopped applying.
     */
    expect(overlayFocus(input({ dockedProjectId: 'a', primaryProjectId: 'a' })).notable).toBe(false);
    expect(overlayFocus(input({ primaryProjectId: 'a' })).notable).toBe(false);

    expect(overlayFocus(input({ dockedProjectId: 'b', primaryProjectId: 'a' })).notable).toBe(true);
    expect(overlayFocus(input({ primaryProjectId: 'gone' })).notable).toBe(true);
  });

  it('falls back to the primary when not docked', () => {
    const f = overlayFocus(input({ primaryProjectId: 'a' }));

    expect(f.projectId).toBe('a');
    expect(f.reason).toBe('primary');
  });

  it('★ MANDATORY: a STALE primary is ignored, not obeyed ★', () => {
    /*
     * A primary pointing at a finished or deleted project must not win — the overlay would show a
     * completed shopping list for ever, and the member could not tell that from "nothing left to
     * buy".
     */
    const f = overlayFocus(input({ primaryProjectId: 'gone', activeProjectIds: ['a', 'b'] }));

    expect(f.projectId).not.toBe('gone');
    expect(f.reason).toBe('all');
    expect(f.because, 'and it says so rather than failing silently').toMatch(/finished/i);
  });

  it('a stale primary with nothing else running says so plainly', () => {
    const f = overlayFocus(input({ primaryProjectId: 'gone', activeProjectIds: [] }));

    expect(f.reason).toBe('none');
    expect(f.because).toMatch(/finished/i);
  });

  it('★ MANDATORY: a docked site is shown even before its project is known ★', () => {
    /*
     * A site can be docked at before its project exists in the active list — somebody arriving at a
     * construction site nobody has posted yet. Refusing to show it would blank the overlay at the
     * one moment it is most useful.
     */
    const f = overlayFocus(input({ dockedProjectId: 'brand-new', activeProjectIds: [] }));

    expect(f.projectId).toBe('brand-new');
    expect(f.reason).toBe('docked');
  });

  it('shows everything when asked, whatever else is true', () => {
    const f = overlayFocus(
      input({ showAll: true, dockedProjectId: 'b', primaryProjectId: 'a' }),
    );

    expect(f.projectId).toBeNull();
    expect(f.reason).toBe('all');
    expect(f.because).toContain('2 projects');
  });

  it('with no primary and no dock, shows everything rather than guessing one', () => {
    /*
     * A guess would be right sometimes and silently wrong the rest, and the member has not told us
     * anything to go on.
     */
    const f = overlayFocus(input());

    expect(f.reason).toBe('all');
    expect(f.because).toMatch(/no primary set/i);
  });

  it('says nothing is being built when nothing is', () => {
    const f = overlayFocus(input({ activeProjectIds: [] }));

    expect(f.reason).toBe('none');
    expect(f.because).toMatch(/no projects/i);
  });

  it('gets the singular right', () => {
    expect(overlayFocus(input({ showAll: true, activeProjectIds: ['a'] })).because).toContain(
      '1 project.',
    );
  });
});
