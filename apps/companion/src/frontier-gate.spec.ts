import { describe, expect, it } from 'vitest';
import {
  FRONTIER_POLL_MS,
  FRONTIER_WATCH_MS,
  frontierGate,
  readFrontierLink,
  type FrontierLink,
} from './frontier-gate.js';

/**
 * The mandatory Frontier step, and the ways it must not lock somebody out.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "after a member connects with discord and connects the app ... they are then given the login with
 * frontier, this is a manditory step"
 *
 * ★ WHAT THIS SUITE IS REALLY GUARDING ★
 *
 * Not the happy path. The happy path is three lines and nobody was ever going to get it wrong.
 *
 * "Mandatory" means a gate stands between every member and an app whose mining overlays,
 * colonisation boards and bounty tracking have nothing whatsoever to do with cAPI. Every case
 * below is a way that gate could refuse somebody for a reason that is not theirs — a hub that has
 * not answered yet, a hub that is down, a hub older than the app that has never heard of the
 * question — and each one has an answer that was chosen deliberately rather than fallen into.
 *
 * ADR-003 is the authority being balanced here: "cAPI is an upgrade, never a dependency." The
 * owner has since made it a dependency for the companion app specifically, which is his call to
 * make — but it does not license a design where an outage at Frontier, or at us, takes the app out
 * with it silently.
 */

const LIVE: FrontierLink = {
  linked: true,
  daysLeft: 19,
  warn: false,
  sentence: 'Connected to Frontier. 19 days left before it asks again.',
};

const DEAD: FrontierLink = {
  linked: false,
  daysLeft: 0,
  warn: true,
  sentence: 'Your Frontier connection has run out.',
};

describe('the Frontier gate decides from the hub, and only from the hub', () => {
  it('leaves an unpaired device alone — the pairing gate owns that screen', () => {
    /*
     * One screen, one action. A device with no token cannot ask the hub anything, so showing a
     * Frontier screen there would be a second thing to do before the first one is possible.
     */
    expect(
      frontierGate({ paired: false, answered: false, link: undefined, error: null }).step,
    ).toBe('pass');
  });

  it('lets a linked member through', () => {
    expect(frontierGate({ paired: true, answered: true, link: LIVE, error: null }).step).toBe(
      'pass',
    );
  });

  it('★ MANDATORY: a member the hub has never seen link is stopped ★', () => {
    // `null` is the hub's answer for "there is no verification row" — never linked, not broken.
    const gate = frontierGate({ paired: true, answered: true, link: null, error: null });
    expect(gate.step).toBe('connect');
    expect(gate.problem).toBeNull();
  });

  it('★ MANDATORY: an EXISTING paired member is stopped the same way ★', () => {
    /*
     * The whole point of driving this from hub state. Somebody who paired in June and updates in
     * August has a config file full of a working device token and nothing about Frontier in it —
     * and must still meet the gate. Nothing in this input describes the install; it is entirely the
     * hub's answer, so an old install and a fresh one cannot behave differently.
     */
    const existing = frontierGate({ paired: true, answered: true, link: null, error: null });
    const fresh = frontierGate({ paired: true, answered: true, link: null, error: null });
    expect(existing).toEqual(fresh);
    expect(existing.step).toBe('connect');
  });

  it('asks a member whose grant has died to reconnect, in the hub’s own words', () => {
    /*
     * A dead grant is a different conversation from never having linked: they did the thing, and
     * Frontier's ~25-day ceiling ran out. Saying "connect your Frontier account" to somebody who
     * already did reads as the app having forgotten.
     */
    const gate = frontierGate({ paired: true, answered: true, link: DEAD, error: null });
    expect(gate.step).toBe('reconnect');
    expect(gate.sentence).toBe(DEAD.sentence);
  });
});

describe('the gate does not punish anybody for a fault that is ours', () => {
  it('★ MANDATORY: a hub that has no opinion does NOT gate ★', () => {
    /*
     * ★ THE VERSION-SKEW LOCKOUT ★
     *
     * `undefined` means the hub answered in full and its answer carried no Frontier field at all —
     * an older hub than this app, which is the normal state for about a day after every release and
     * the permanent state for anyone running their own.
     *
     * Gating there would be a lockout with no exit: the field can never arrive, so the member could
     * never satisfy the gate however many times they connected. A hub that cannot be asked the
     * question has not answered "no" to it.
     *
     * This is the single most important assertion in the file. It is also the one most likely to be
     * "tidied up" by somebody who reads `undefined` as falsy and makes the check stricter.
     */
    const gate = frontierGate({ paired: true, answered: true, link: undefined, error: null });
    expect(gate.step).toBe('pass');
  });

  it('★ MANDATORY: an unreachable hub is named as unreachable, not as an unlinked member ★', () => {
    /*
     * The failure the owner must never see: a member opens the app during an outage and is told to
     * go and connect an account they connected weeks ago, with a button that cannot work. The
     * screen has to say what is actually true.
     */
    const gate = frontierGate({
      paired: true,
      answered: false,
      link: undefined,
      error: 'Could not reach the hub.',
    });
    expect(gate.step).toBe('unreachable');
    expect(gate.problem).toBe('Could not reach the hub.');
  });

  it('★ MANDATORY: an outage does not OPEN the gate either ★', () => {
    /*
     * The opposite mistake, and the tempting one. Failing open on an unreachable hub would mean the
     * mandatory step is skippable by anybody willing to pull their network cable at launch — which
     * is not a threat model so much as an accident waiting to happen on hotel wifi.
     *
     * Unreachable is TRANSIENT and self-heals: the hub comes back and the recheck lets them
     * through with nothing to press. A missing field is PERMANENT for that hub build and cannot.
     * That difference is the whole reason the two cases above are decided in opposite directions.
     */
    expect(
      frontierGate({
        paired: true,
        answered: false,
        link: undefined,
        error: 'Could not reach the hub.',
      }).step,
    ).not.toBe('pass');
  });

  it('says it is still checking before the first answer, rather than accusing anybody', () => {
    // The first second or two of every launch. "Connect your Frontier account" flashing up and then
    // vanishing would teach members to ignore it on the day it is real.
    const gate = frontierGate({ paired: true, answered: false, link: undefined, error: null });
    expect(gate.step).toBe('checking');
  });

  it('keeps the last good answer when the hub goes away mid-session, and says the check failed', () => {
    /*
     * `refreshHubSettings` deliberately keeps the previous settings on a failed fetch. So a member
     * who was mid-gate when the connection dropped still sees the step they were on — with the
     * failure named underneath, because a Retry button that silently does nothing is worse than no
     * Retry button.
     */
    const gate = frontierGate({
      paired: true,
      answered: true,
      link: null,
      error: 'The hub did not answer in time.',
    });
    expect(gate.step).toBe('connect');
    expect(gate.problem).toBe('The hub did not answer in time.');
  });

  it('a live member with a failed recheck is still let through', () => {
    // They are linked. A dropped packet is not a reason to put a wall in front of the overlays.
    expect(
      frontierGate({ paired: true, answered: true, link: LIVE, error: 'Could not reach the hub.' })
        .step,
    ).toBe('pass');
  });
});

describe('reading the hub’s answer', () => {
  it('★ MANDATORY: an absent field and a null field are not the same thing ★', () => {
    /*
     * The distinction the whole design rests on. `null` is the hub saying "this member has never
     * linked"; absence is the hub saying nothing. Collapsing them is how the version-skew lockout
     * above gets reintroduced by accident.
     */
    expect(readFrontierLink(undefined)).toBeUndefined();
    expect(readFrontierLink(null)).toBeNull();
  });

  it('reads a complete answer', () => {
    expect(readFrontierLink({ ...LIVE })).toEqual(LIVE);
  });

  it('treats a malformed answer as no opinion rather than as a refusal', () => {
    /*
     * Same reasoning as the missing field: anything we cannot read is something we cannot hold a
     * member to. A hub that starts sending a shape this build does not understand must degrade to
     * "no gate", never to "gate nobody can pass".
     */
    expect(readFrontierLink({})).toBeUndefined();
    expect(readFrontierLink('linked')).toBeUndefined();
    expect(readFrontierLink({ linked: 'yes' })).toBeUndefined();
    expect(readFrontierLink(42)).toBeUndefined();
  });

  it('fills in the soft fields but never invents `linked`', () => {
    // `linked` is the only field the gate acts on, so it is the only one that must be present.
    // Reporting a wrong number of days is cosmetic; inventing a link state is not.
    const partial = readFrontierLink({ linked: true });
    expect(partial).toEqual({ linked: true, daysLeft: 0, warn: false, sentence: '' });
  });
});

describe('the cadence while somebody is in the browser', () => {
  it('polls fast enough that finishing in the browser feels immediate', () => {
    // The device-link approval poll is 2s and nobody has complained. Anything on the order of the
    // five-minute settings TTL would leave a member staring at a gate they had already cleared.
    expect(FRONTIER_POLL_MS).toBeLessThanOrEqual(5_000);
    expect(FRONTIER_POLL_MS).toBeGreaterThanOrEqual(1_000);
  });

  it('★ MANDATORY: the fast poll stops by itself ★', () => {
    /*
     * `device-link.ts` says it best: "A poll loop with no exit is how an app ends up hammering an
     * endpoint forever because somebody closed the browser tab." Same rule, same reason — this one
     * is started by a button press and nothing acknowledges it if the member wanders off.
     */
    expect(FRONTIER_WATCH_MS).toBeGreaterThan(FRONTIER_POLL_MS);
    expect(FRONTIER_WATCH_MS).toBeLessThanOrEqual(15 * 60_000);
  });
});
