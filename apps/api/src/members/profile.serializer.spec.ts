import { describe, it, expect } from 'vitest';
import {
  serializeProfile,
  resolvePrivacy,
  PRIVACY_FIELDS,
  DEFAULT_PRIVACY,
  type PrivacySettings,
  type ProfileSource,
} from './profile.serializer.js';

/**
 * @INV-027 A member's location, credit balance and fleet are NEVER present in a
 * public API response unless that member has explicitly opted in FOR THAT
 * SPECIFIC FIELD. Absent, not merely hidden by the UI.
 *
 * ★ WHY THE TESTS ASSERT ABSENCE RATHER THAN NULL ★
 *
 * `{ location: null }` still tells a reader that a location field exists, that
 * this member has one, and that it is being withheld. It also survives a
 * careless client that does `profile.location ?? profile.lastKnownSystem`, and
 * it lands in caches, logs and API snapshots as a shape that invites someone to
 * fill it in later. The invariant says ABSENT, so every test here uses
 * `toHaveProperty` / `Object.keys`, never `toBeNull`.
 *
 * The serializer is the ONLY thing permitted to build a public profile. Tests
 * that go around it would prove nothing about what the API actually returns.
 */

const SOURCE: ProfileSource = {
  id: 'u-1',
  handle: 'grim',
  displayName: 'Grim',
  avatarUrl: 'https://cdn.example/a.png',
  bio: 'Founded the squadron in 2006.',
  timezone: 'Europe/London',
  /*
   * Both REQUIRED by ProfileSource and both were missing. `avatarStoredHash` is
   * what the serializer reads to decide whether to emit an avatar URL at all,
   * and `lastPlayingAt` drives "playing now" — so every test here was building
   * a profile the production type does not allow.
   */
  avatarStoredHash: null,
  lastPlayingAt: null,
  joinedAt: new Date('2006-04-01T00:00:00Z'),
  status: 'active',
  ranks: [{ name: 'Galactic Admiral', colour: '#b16b2f' }],
  cmdrName: 'GRIM',
  location: { system: 'Shinrarta Dezhra', station: 'Jameson Memorial' },
  credits: 1_204_998_221n,
  fleet: [{ shipType: 'Anaconda', name: 'Bad Idea' }],
  /*
   * JOINS, not minutes. Discord reports somebody ENTERING a voice channel and
   * never how long they stayed, so nothing anywhere records a minute of it.
   */
  activity: { messages: 412, voiceJoins: 37, forumPosts: 9, gameObserved: true },
};

/** Every toggle off — a member who explicitly switched everything off, boards included. */
const ALL_PRIVATE: PrivacySettings = {
  showLocation: false,
  showCredits: false,
  showFleet: false,
  showActivity: false,
  showOnPublicRoster: false,
  showOnLeaderboard: false,
  showLbBounties: false,
  showLbColony: false,
  showLbTrade: false,
      plainFonts: false,
};

const ALL_PUBLIC: PrivacySettings = {
  showLocation: true,
  showCredits: true,
  showFleet: true,
  showActivity: true,
  showOnPublicRoster: true,
  showOnLeaderboard: true,
  showLbBounties: true,
  showLbColony: true,
  showLbTrade: true,
      plainFonts: false,
};

describe('@INV-027 private fields are ABSENT from a public profile', () => {
  it('MANDATORY: every toggle private — location, credits and fleet are absent, not null', () => {
    const out = serializeProfile(SOURCE, ALL_PRIVATE, { audience: 'public' });

    // The invariant names these three explicitly.
    expect(out).not.toHaveProperty('location');
    expect(out).not.toHaveProperty('credits');
    expect(out).not.toHaveProperty('fleet');

    // And stated the other way, because `not.toHaveProperty` would also pass if
    // the serializer returned an empty object or threw its result away.
    expect(Object.keys(out)).not.toContain('location');
    expect(out.handle).toBe('grim');
  });

  it('MANDATORY: a private field is absent even when the underlying value exists', () => {
    // The source carries a real location, real credits and a real ship. This is
    // the case that matters: absence must come from the toggle, not from the
    // data happening to be missing.
    expect(SOURCE.location).not.toBeUndefined();
    const out = serializeProfile(SOURCE, ALL_PRIVATE, { audience: 'public' });
    expect(JSON.stringify(out)).not.toContain('Shinrarta');
    expect(JSON.stringify(out)).not.toContain('Anaconda');
    expect(JSON.stringify(out)).not.toContain('1204998221');
  });

  it('is not defeated by JSON serialisation — the key is gone after a round trip', () => {
    // An `undefined` value disappears through JSON.stringify, but a `null` does
    // not. Round-tripping proves which one the serializer produced.
    const out = JSON.parse(
      JSON.stringify(serializeProfile(SOURCE, ALL_PRIVATE, { audience: 'public' })),
    ) as Record<string, unknown>;
    expect(Object.keys(out).sort()).not.toContain('location');
    expect(Object.keys(out).sort()).not.toContain('credits');
    expect(Object.keys(out).sort()).not.toContain('fleet');
  });

  it('includes a field ONLY when its own toggle is on — opt-in is per field', () => {
    // Turning on location must not drag credits along with it. A single
    // "showProfile" flag would pass a weaker version of this test.
    const out = serializeProfile(
      SOURCE,
      { ...ALL_PRIVATE, showLocation: true },
      { audience: 'public' },
    );
    expect(out).toHaveProperty('location');
    expect(out).not.toHaveProperty('credits');
    expect(out).not.toHaveProperty('fleet');
    expect(out).not.toHaveProperty('activity');
  });

  it('includes every field when the member has opted into every field', () => {
    const out = serializeProfile(SOURCE, ALL_PUBLIC, { audience: 'public' });
    expect(out).toHaveProperty('location');
    expect(out).toHaveProperty('credits');
    expect(out).toHaveProperty('fleet');
    expect(out).toHaveProperty('activity');
  });

  it('renders credits as a string — a bigint balance loses precision as a JS number', () => {
    const out = serializeProfile(SOURCE, ALL_PUBLIC, { audience: 'public' });
    expect(out.credits).toBe('1204998221');
    // Not a number. Credit balances pass 2^53 in this game and Number would
    // silently round, which is the same class of bug as the permission mask.
    expect(typeof out.credits).toBe('string');
  });
});

describe('defaults are conservative', () => {
  it('MANDATORY: a member with NO privacy row is treated as fully private', () => {
    // The common case in production: the row is created lazily, so a member who
    // has never opened settings has no row at all. Defaulting to public here
    // would leak every field of every member who never configured anything —
    // which is most of them.
    const out = serializeProfile(SOURCE, null, { audience: 'public' });
    expect(out).not.toHaveProperty('location');
    expect(out).not.toHaveProperty('credits');
    expect(out).not.toHaveProperty('fleet');
    expect(out).not.toHaveProperty('activity');
  });

  it('every default FIELD toggle is false; only the leaderboard participation switches are on', () => {
    /*
     * The exception is deliberate and owner-instructed ("default all leaderboard participation
     * on for all commanders", 2026-08-04): the leaderboard switches govern PARTICIPATION in the
     * gamified standings, not visibility of a fact about the member, and their schema columns
     * default TRUE. Everything that hides a field stays conservative.
     *
     * The MASTER switch belongs to this set — it governs the same boards its three children do.
     * This spec once held it to false, which pinned the exact lie the standings SQL exposed: a
     * member with no privacy row participated (COALESCE(col, true)) while the settings page
     * showed the switch off.
     */
    const PARTICIPATION = new Set([
      'showOnLeaderboard',
      'showLbBounties',
      'showLbColony',
      'showLbTrade',
    ]);
    for (const [field, value] of Object.entries(DEFAULT_PRIVACY)) {
      if (PARTICIPATION.has(field)) {
        expect(value, `${field} must default to participating`).toBe(true);
      } else {
        expect(value, `${field} must default to private`).toBe(false);
      }
    }
  });

  it('a partial row missing the participation trio resolves to participating, not private', () => {
    /*
     * Every row written before 2026-08-04 predates these columns. The database backfills them
     * TRUE, but a partial object read through an old select must resolve the same way — the
     * standings SQL reads COALESCE(col, true), and code disagreeing with schema here would report
     * a member as opted out while the board still listed them.
     */
    const resolved = resolvePrivacy({ showLocation: true });
    expect(resolved.showLbBounties).toBe(true);
    expect(resolved.showLbColony).toBe(true);
    expect(resolved.showLbTrade).toBe(true);
    // An explicit OFF still wins — the switch is real, only its default changed.
    expect(resolvePrivacy({ showLbTrade: false }).showLbTrade).toBe(false);
  });

  it('a partial privacy row falls back to private for the missing toggles', () => {
    // A row written before a new toggle was added has no value for it. Reading
    // that as `undefined` and treating undefined as truthy-by-omission is how
    // this kind of check usually fails.
    const partial = { showLocation: true } as unknown as PrivacySettings;
    const out = serializeProfile(SOURCE, partial, { audience: 'public' });
    expect(out).toHaveProperty('location');
    expect(out).not.toHaveProperty('credits');
  });
});

describe('audiences', () => {
  it('a member viewing THEIR OWN profile sees everything regardless of toggles', () => {
    // Otherwise the settings page cannot show someone what they are hiding.
    const out = serializeProfile(SOURCE, ALL_PRIVATE, { audience: 'self' });
    expect(out).toHaveProperty('location');
    expect(out).toHaveProperty('credits');
    expect(out).toHaveProperty('fleet');
  });

  it('MANDATORY: an OFFICER does not get to see privacy-gated fields', () => {
    // Deliberate. INV-027 is a promise to the member, not a permission level —
    // if rank could override it the promise would be worth nothing, and the
    // officer rank is exactly who a member most wants to hide a credit balance
    // from. Officers get moderation powers, not surveillance.
    const out = serializeProfile(SOURCE, ALL_PRIVATE, { audience: 'officer' });
    expect(out).not.toHaveProperty('location');
    expect(out).not.toHaveProperty('credits');
    expect(out).not.toHaveProperty('fleet');
  });

  it('an unknown audience is treated as public', () => {
    const out = serializeProfile(SOURCE, ALL_PRIVATE, {
      audience: 'nonsense' as unknown as 'public',
    });
    expect(out).not.toHaveProperty('location');
  });
});

describe('fields that are never private', () => {
  it('handle, display name and join date are always present', () => {
    // These are the identity of a squadron member. Hiding them would make the
    // roster meaningless, and none of them is sensitive.
    const out = serializeProfile(SOURCE, ALL_PRIVATE, { audience: 'public' });
    expect(out.handle).toBe('grim');
    expect(out.displayName).toBe('Grim');
    expect(out.joinedAt).toBe('2006-04-01T00:00:00.000Z');
  });

  it('MANDATORY: email is absent from EVERY audience, including self', () => {
    // Not a privacy toggle — it is simply not part of a profile. A serializer
    // that spreads the user row would leak this, so the test guards against the
    // implementation being rewritten that way later.
    for (const audience of ['public', 'self', 'officer'] as const) {
      const out = serializeProfile(
        { ...SOURCE, email: 'grim@example.com' } as ProfileSource,
        ALL_PUBLIC,
        { audience },
      );
      expect(out, audience).not.toHaveProperty('email');
    }
  });

  it('does not leak the internal user id', () => {
    // Profiles are addressed by handle. Exposing the uuid gives an enumerable
    // key and nothing a client needs.
    const out = serializeProfile(SOURCE, ALL_PUBLIC, { audience: 'public' });
    expect(out).not.toHaveProperty('id');
  });
});

describe('roster listings', () => {
  it('MANDATORY: a member who has not opted into the public roster is not in it', () => {
    // The roster is the highest-traffic public surface. showOnPublicRoster is
    // the toggle that keeps a member off it entirely, which is stronger than
    // hiding their individual fields.
    const rows = [
      { source: SOURCE, privacy: ALL_PRIVATE },
      { source: { ...SOURCE, handle: 'opted-in' }, privacy: ALL_PUBLIC },
    ];
    const visible = rows
      .filter((r) => (r.privacy.showOnPublicRoster ?? false) === true)
      .map((r) => serializeProfile(r.source, r.privacy, { audience: 'public' }));

    expect(visible).toHaveLength(1);
    expect(visible[0]?.handle).toBe('opted-in');
  });
});

describe('PRIVACY_FIELDS completeness', () => {
  it('every gated field names the toggle that controls it', () => {
    // A field added to the profile without an entry here would be serialised
    // unconditionally. This is the registry that makes that a review-time
    // failure rather than a leak.
    expect(Object.keys(PRIVACY_FIELDS).sort()).toEqual([
      'activity',
      'credits',
      'fleet',
      'location',
    ]);
  });

  it('MANDATORY: the three fields INV-027 names by name are all gated', () => {
    for (const f of ['location', 'credits', 'fleet'] as const) {
      expect(PRIVACY_FIELDS[f], `${f} must be gated by a toggle`).toMatch(/^show/);
    }
  });
});
