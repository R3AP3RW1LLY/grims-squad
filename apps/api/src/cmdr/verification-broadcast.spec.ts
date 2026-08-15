import { describe, it, expect, beforeEach } from 'vitest';
import { CmdrController } from './cmdr.controller.js';
import type { LiveEvent } from '../live/live.service.js';

/**
 * Who finds out when somebody gets verified.
 *
 * ★ THE BUG THIS PINS ★
 *
 * A verification published one event, scoped to the member it happened to. That
 * is correct for their own settings page and useless for everything else: the
 * roster shows an "Inara verified" badge for EVERY member, the admin console has
 * a CMDR verified column, and a profile page shows the commander name — none of
 * which is that member's own tab.
 *
 * So the squadron owner would verify somebody and watch the roster go on
 * showing them unverified until it was reloaded by hand. Squadron owner,
 * 2026-07-29: verifications must show instantly ACROSS the app.
 *
 * ★ AND WHAT THE SECOND EVENT MUST NOT SAY ★
 *
 * It is a `roster` event carrying NO userId, not a squadron-wide
 * `verification`. The difference matters: "the roster changed" is not "this
 * particular person just proved their commander name", and the stream reaches
 * every connected browser.
 */

class FakeLive {
  readonly published: LiveEvent[] = [];
  publish(event: LiveEvent): void {
    this.published.push(event);
  }
}

/** Reaches the private method the routes call. Its behaviour is the contract. */
function publish(controller: CmdrController, userId: string): void {
  (controller as unknown as { publishVerification(id: string): void }).publishVerification(userId);
}

describe('verification broadcast', () => {
  let live: FakeLive;
  let controller: CmdrController;

  beforeEach(() => {
    live = new FakeLive();
    // The other three collaborators are never touched by this path.
    controller = new CmdrController(
      null as never,
      null as never,
      null as never,
      // The cAPI service. Required rather than @Optional, unlike the live service below: without
      // it a member cannot link a Frontier account at all, and for a commander on GeForce Now that
      // is the difference between existing on this platform and not. A stub here rather than a
      // silent no-op there.
      null as never,
      live as never,
    );
  });

  it('tells the member, so their own settings page updates', () => {
    publish(controller, 'u1');
    expect(live.published).toContainEqual({ type: 'verification', userId: 'u1' });
  });

  it('MANDATORY @INV-048: also tells everybody, so the roster stops showing them unverified', () => {
    publish(controller, 'u1');
    expect(live.published).toContainEqual({ type: 'roster', userId: null });
  });

  /*
   * ★ THE DISCLOSURE TEST ★
   *
   * A squadron-wide event naming the member would tell a hundred browsers that
   * a particular person just proved their commander name. The broadcast half
   * must be anonymous; only the member-scoped half may name them.
   */
  it('MANDATORY @INV-048: the squadron-wide event never names the member', () => {
    publish(controller, 'u1');

    const broadcast = live.published.filter((e) => e.userId === null);
    expect(broadcast.length).toBeGreaterThan(0);
    for (const event of broadcast) {
      expect(event.type).not.toBe('verification');
      expect(JSON.stringify(event)).not.toContain('u1');
    }
  });

  it('sends exactly two events, not one per interested page', () => {
    publish(controller, 'u1');
    expect(live.published).toHaveLength(2);
  });

  /*
   * Publishing is an in-memory loop over sockets, but a browser that vanished
   * mid-write must never turn a successful verification into a 500 — the write
   * is already committed and the member really is verified.
   */
  it('never throws when the live service does', () => {
    const exploding = {
      publish(): void {
        throw new Error('socket gone');
      },
    };
    const c = new CmdrController(null as never, null as never, null as never, null as never, exploding as never);
    expect(() => publish(c, 'u1')).not.toThrow();
  });

  /*
   * `@Optional()` injection: the controller's own tests construct it with three
   * collaborators, and a deployment without the live module must still verify
   * people. Silence is the correct behaviour, not a crash.
   */
  it('does nothing at all when there is no live service', () => {
    const c = new CmdrController(null as never, null as never, null as never, null as never, undefined);
    expect(() => publish(c, 'u1')).not.toThrow();
  });
});
