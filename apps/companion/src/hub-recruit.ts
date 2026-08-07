import type { HubCall } from './hub-colony.js';

/**
 * Recruiting, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "one last feature i want to add is a unique discord invite link for all members that are inara
 * veriefied in our platform ... build me a cool recruit tracking system"
 *
 * ★ THE APP IS WHERE THE LINK IS WANTED ★
 *
 * A member decides to invite somebody mid-conversation, with the game running. Alt-tabbing to a
 * website to fetch their own link is the friction that stops the feature being used at all.
 *
 * Same shapes the website reads, off the same device-token door, so the two surfaces cannot
 * disagree about who has been recruited or what it scored.
 */

export type RecruitMilestone = 'joined' | 'stayed' | 'verified' | 'flying' | 'cadet';

export interface Recruit {
  readonly name: string;
  readonly joinedAt: string;
  readonly milestones: readonly RecruitMilestone[];
  readonly points: number;
}

export interface RecruitStatus {
  /** The invite URL, when they have one. Null when they cannot mint or have not yet. */
  readonly link: string | null;
  readonly canMint: boolean;
  /** Why not, in the hub's own words. Null when they can. */
  readonly blockedBecause: string | null;
  readonly recruits: readonly Recruit[];
  readonly totalPoints: number;
  /** What each milestone pays, so the app can show the ladder without inventing the numbers. */
  readonly ladder: ReadonlyArray<{ milestone: RecruitMilestone; points: number }>;
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One call to the companion's recruiting surface.
 *
 * The same failure-becomes-a-sentence contract as every other hub client here, and the same reason:
 * the renderer draws whatever this returns, and a member needs "not paired" told apart from "no
 * connection".
 */
async function call<T>(hub: HubCall, path: string, post = false): Promise<Answer<T>> {
  if (hub.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = hub.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), hub.timeoutMs ?? 15_000);

  try {
    const res = await doFetch(`${hub.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/recruit${path}`, {
      method: post ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${hub.deviceToken}` },
      signal: ac.signal,
    });

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (res.status === 404) {
      /*
       * Cloaked, by design (INV-002). A member without RECRUIT_VIEW is told the page is not there
       * rather than that it exists and is closed to them — so the app must not translate this into
       * "you are not allowed", which would leak exactly what the cloak hides.
       */
      return { ok: false, error: 'Recruiting is not available on your account.' };
    }
    if (!res.ok) {
      const parsed = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: parsed?.error?.message ?? `The hub answered ${res.status}.` };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: 'Could not reach the hub.' };
  } finally {
    clearTimeout(timer);
  }
}

/** The member's own recruiting: their link, who came through it, and what it scored. */
export function recruitStatus(hub: HubCall): Promise<Answer<RecruitStatus>> {
  return call<RecruitStatus>(hub, '');
}

/**
 * Mint the link, or return the one they already have.
 *
 * The three-part rule — permission, Inara verification, Cadet — is checked by the hub at the moment
 * of the click, never here. All three can change while a window sits open, and a member whose
 * recruiting was switched off must not get a link from a button their app still had on screen.
 */
export function mintInvite(hub: HubCall): Promise<Answer<{ link: string }>> {
  return call<{ link: string }>(hub, '/link', true);
}
