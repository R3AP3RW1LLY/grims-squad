/**
 * The mandatory Frontier step, and every way it must refuse to strand somebody.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "the primary feature must be so that players that are playing on Geforce Now and cloud platforms
 * can use the companion app like everyone else"
 *
 * "after a member connects with discord and connects the app ... they are then given the login with
 * frontier, this is a manditory step"
 *
 * ★ WHAT THE BADGE MEANS, AND WHAT IT DOES NOT ★
 *
 * A Frontier link proves, cryptographically, which Frontier account is behind this member — that
 * and nothing else. It is NOT a statement that they are in the squadron in game. Squadron
 * confirmation over cAPI was considered and dropped, so no copy in this app may imply it. Getting
 * that wrong would put a badge on the roster that says something the platform has never checked.
 *
 * ★ WHY A SEPARATE MODULE FOR WHAT LOOKS LIKE ONE `if` ★
 *
 * Because it is not one `if`, and the interesting half cannot be reached from `main.ts`. This file
 * holds the decision alone — no Electron, no fetch, no config — so every refusal it can produce is
 * reachable from a test. The screen and the plumbing are elsewhere and are dull by comparison.
 *
 * ★ THE ARGUMENT FOR MAKING IT MANDATORY AT ALL ★
 *
 * ADR-003 is explicit: "The fallback path ships regardless of whether cAPI approval arrives. cAPI
 * is an upgrade, never a dependency." That ADR is about the PLATFORM — the forum, the roster, Ring
 * 1 access — and it still holds there. The owner has made it a dependency for this app in
 * particular, and that is his call: the app exists to attribute gameplay to a commander, and an
 * unverified commander name is the one thing that makes every number it produces arguable.
 *
 * What it does not license is a gate that fails closed on OUR faults. So:
 *
 *   - The gate covers the WINDOW, not the app. Journal upload, the tray, and every overlay run in
 *     the main process and keep running behind this screen. A member sitting on the Frontier step
 *     is still contributing, still has their mining panels over the game, and still shows as flying
 *     on the roster. That is the single most important mitigation and the screen says so out loud.
 *   - A hub that cannot be ASKED the question never gates (see `undefined` below).
 *   - A hub that cannot be REACHED gates, says so plainly, blames itself, and retries by itself.
 *
 * The one thing deliberately not offered is a "skip for now". It would have to be remembered on
 * this machine, which makes it both a lie about hub state and a permanent lever for anybody who
 * wants to never do this — and "existing members must see this on update" is exactly a rule about
 * not trusting what is stored locally.
 */

/**
 * What the hub says about this member's Frontier grant.
 *
 * The same four fields `CapiService.status()` returns, deliberately: this app re-describes nothing
 * and re-derives nothing. `daysLeft` and `sentence` come from the hub's own `tokenState`, so the
 * app and the website cannot end up disagreeing about how long is left — which is the exact class
 * of bug the location panel was written to avoid.
 */
export interface FrontierLink {
  /** False for a grant that existed and has died — not for a member who never linked. */
  readonly linked: boolean;
  readonly daysLeft: number;
  readonly warn: boolean;
  readonly sentence: string;
}

/**
 * What the window should show.
 *
 * A flat record rather than a discriminated union: every step except `pass` renders the same
 * screen with different words, and the renderer reading three plain fields is easier to be sure
 * about than one that narrows a union in JSX.
 */
export interface FrontierGate {
  readonly step: 'pass' | 'checking' | 'connect' | 'reconnect' | 'unreachable';
  /** What went wrong the last time we asked, or null. Never the member's doing. */
  readonly problem: string | null;
  /** The hub's own words about the grant, for the reconnect case. */
  readonly sentence: string | null;
}

export interface GateInput {
  readonly paired: boolean;
  /** Has the hub answered AT ALL this launch? Distinct from what it said. */
  readonly answered: boolean;
  /**
   * The hub's answer.
   *
   * Three-valued on purpose, and the three are genuinely different:
   *   - a `FrontierLink` — the hub knows, and told us
   *   - `null` — the hub knows, and this member has never linked
   *   - `undefined` — the hub did not send the field, so it has no opinion to hold anybody to
   */
  readonly link: FrontierLink | null | undefined;
  /** The last fetch failure, or null. Present or not, it never changes a known answer. */
  readonly error: string | null;
}

/**
 * How often to ask while the member is away in the browser.
 *
 * Four seconds. The device-link approval poll runs at two and nobody has ever complained about the
 * load, and this one is bounded to a single onboarding rather than running for ever. Anything on
 * the order of the five-minute settings TTL would leave somebody who had just finished at Frontier
 * staring at a gate they had already cleared — which reads exactly like the button not working.
 */
export const FRONTIER_POLL_MS = 4_000;

/**
 * And it stops.
 *
 * Ten minutes is longer than any Frontier sign-in takes and shorter than "for ever". The member
 * pressing the button is the only thing that starts this; nothing acknowledges it if they close the
 * browser tab and go and fly, so it has to end on its own. The slow recheck carries on afterwards.
 */
export const FRONTIER_WATCH_MS = 10 * 60_000;

/**
 * Reads the hub's Frontier field without ever inventing a link state.
 *
 * ★ ABSENT IS NOT `null`, AND NEITHER IS "NO" ★
 *
 * `undefined` in, `undefined` out: the caller passes `body['frontier']` straight in, so a hub build
 * that has never heard of this field arrives here as absence and leaves as absence. `null` is a
 * real answer and survives as one.
 *
 * Anything unreadable — a string, a number, an object with no `linked` — also becomes absence. That
 * is the conservative direction here and only here: a shape we cannot parse is a hub we cannot ask,
 * and a member must not be held to a question that was never put to them. The soft fields are
 * filled in because a wrong day count is cosmetic; `linked` is never filled in because inventing it
 * is the whole failure this is guarding.
 */
export function readFrontierLink(value: unknown): FrontierLink | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;

  const raw = value as Record<string, unknown>;
  if (typeof raw['linked'] !== 'boolean') return undefined;

  return {
    linked: raw['linked'],
    daysLeft: typeof raw['daysLeft'] === 'number' ? raw['daysLeft'] : 0,
    warn: raw['warn'] === true,
    sentence: typeof raw['sentence'] === 'string' ? raw['sentence'] : '',
  };
}

/**
 * What the Frontier tab on the settings page shows.
 *
 * Distinct from `FrontierGate` because it answers a different question. The gate asks "must this
 * member be stopped", and once the answer is no it has nothing more to say. This asks "what is the
 * state of my Frontier link, and how do I fix it" — a question somebody is entitled to ask on a
 * perfectly ordinary Tuesday when nothing is wrong.
 */
export interface FrontierAccount {
  /**
   * `unknown` covers both a hub that did not answer and one too old to be asked. Those are
   * different situations that this panel treats identically, because the honest sentence for both
   * is the same: we could not check.
   */
  readonly state: 'linked' | 'expiring' | 'dead' | 'never' | 'unknown';
  /** The hub's own words about its own clock, or ours only when it had none. */
  readonly sentence: string;
  readonly canReconnect: boolean;
}

/**
 * The state of this member's Frontier link, and whether they may act on it.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * "there is no reconnect to Frontier button in the companion app at all! you said there was!"
 *
 * He was right and I was wrong about my own code. The button exists — it has existed since the gate
 * shipped — but it is rendered by the gate SCREEN, and the gate screen is what you see INSTEAD of
 * the app when the link is broken. Once linked, `step` is `pass`, the whole screen is replaced by
 * the app, and with it the only route to reconnecting. Reading the source told me the button was
 * there. It never told me nobody could get to it.
 *
 * ★ WHY IT IS NOT CONDITIONAL ON ANYTHING BEING WRONG ★
 *
 * The obvious design — show Reconnect when the hub reports a problem — is the one that fails.
 *
 * For a fortnight this platform had seven Frontier grants that were healthy at Frontier, stored
 * correctly, and completely unusable, because the poller decoded the stored token wrong. The hub's
 * `status()` reports what is STORED, so all fourteen days it answered `linked: true`. A button
 * conditioned on that answer would have been hidden for the entire outage — invisible during
 * precisely the failure it fixes.
 *
 * So the only condition is `paired`, which is not a judgement about health but about whether there
 * is a device token to ask with. Reconnecting when nothing is wrong costs one sign-in and a fresh
 * refresh token. There is no state in which offering it does harm, and at least one well-documented
 * fortnight in which withholding it did.
 */
export function frontierAccount(input: GateInput): FrontierAccount {
  const canReconnect = input.paired;

  if (input.link === undefined) {
    // Absence is not "no" — the same rule the gate lives by. A member who linked in July must
    // never be told they have never connected because the hub was quiet for a second.
    return { state: 'unknown', sentence: 'We could not check with the hub just now.', canReconnect };
  }

  if (input.link === null) {
    return { state: 'never', sentence: 'Not connected to Frontier yet.', canReconnect };
  }

  const { linked, warn, sentence } = input.link;
  const words = sentence === '' ? (linked ? 'Connected to Frontier.' : 'The link has expired.') : sentence;

  if (!linked) return { state: 'dead', sentence: words, canReconnect };
  return { state: warn ? 'expiring' : 'linked', sentence: words, canReconnect };
}

const PASS: FrontierGate = { step: 'pass', problem: null, sentence: null };

/**
 * Should the window show the Frontier step, and which words?
 *
 * Nothing about the installation reaches this function — no config, no first-run flag, no stored
 * "already done". It is the hub's answer and the state of the last request, which is what makes an
 * existing paired member and a fresh install behave identically on update. Anything remembered
 * locally would be a second source of truth for a fact that only the hub holds.
 */
export function frontierGate(input: GateInput): FrontierGate {
  // The pairing gate stands in front of this one and owns the whole window while it does. An
  // unpaired device has no token to ask with, so there is nothing here it could be told.
  if (!input.paired) return PASS;

  if (input.link !== undefined) {
    if (input.link === null) {
      // Never linked. The one case the owner's "mandatory" is actually about.
      return { step: 'connect', problem: input.error, sentence: null };
    }
    if (input.link.linked) return PASS;

    /*
     * Linked once, and the grant is dead — Frontier's refresh tokens last about 25 days and then
     * want the member back interactively. Saying "connect your Frontier account" to somebody who
     * already did reads as the app having forgotten them, so this step gets its own words and
     * carries the hub's sentence rather than a second opinion about the same clock.
     */
    return { step: 'reconnect', problem: input.error, sentence: input.link.sentence };
  }

  /*
   * ★ NO OPINION FROM A HUB THAT ANSWERED = NO GATE ★
   *
   * The hub replied in full and its reply carried no Frontier field: it is an older build than this
   * app. That is the normal state for a while after every release, and the permanent state for
   * anyone pointed at their own instance.
   *
   * Gating here would be a lockout with no exit — the field can never arrive, so no amount of
   * connecting at Frontier would ever satisfy it, and the member would be left pressing a button
   * that could not possibly help. A hub that cannot be asked the question has not answered "no".
   */
  if (input.answered) return PASS;

  /*
   * ★ AND UNREACHABLE GOES THE OTHER WAY, WHICH IS NOT A CONTRADICTION ★
   *
   * Both cases are "we do not know", and they are decided in opposite directions on purpose.
   *
   * A missing field is PERMANENT for that hub build: waiting changes nothing, so refusing entry
   * would be refusing it for ever. An unreachable hub is TRANSIENT: it comes back, the recheck runs
   * on its own, and the member is let through without pressing anything. Failing open here instead
   * would make a mandatory step skippable by anybody whose connection drops at launch — which on
   * hotel wifi is not a threat model, it is a Tuesday.
   *
   * The screen this produces blames the hub, offers Retry, and says the app is still uploading
   * behind it. What it must never do is tell a member who linked in July to go and link again.
   */
  if (input.error !== null) return { step: 'unreachable', problem: input.error, sentence: null };

  // The first second of a launch, before the first request has come back. "Checking" rather than
  // "connect": a demand that flashes up and vanishes teaches people to ignore it on the day it is
  // real.
  return { step: 'checking', problem: null, sentence: null };
}
