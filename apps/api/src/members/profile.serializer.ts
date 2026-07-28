/**
 * The single permitted way to build a member profile for a response (INV-027).
 *
 * ★ WHY A SERIALIZER RATHER THAN A CONTROLLER CHECK ★
 *
 * INV-027 says a private field must be ABSENT from a public response — not
 * null, not empty, and not merely hidden by the UI. That is a property of the
 * SHAPE of the object, so it has to be enforced where the object is built. A
 * controller that deletes keys afterwards works exactly until the second
 * endpoint returns a profile, and the second endpoint is always the one nobody
 * remembers.
 *
 * Nothing else in the API may construct a profile object. If a new response
 * needs one, it calls this.
 *
 * ★ WHY ABSENT AND NOT NULL ★
 *
 * `{ location: null }` still discloses that the field exists, that this member
 * has one, and that it is being withheld — and it survives a careless client
 * writing `profile.location ?? profile.lastSeenSystem`. It also lands in caches
 * and API snapshots as a shape that invites someone to fill it in later.
 * Omitting the key removes the question.
 */

/** Which toggle governs which field. A field absent from here is NOT gated. */
export const PRIVACY_FIELDS = {
  location: 'showLocation',
  credits: 'showCredits',
  fleet: 'showFleet',
  activity: 'showActivity',
} as const satisfies Record<string, keyof PrivacySettings>;

export type GatedField = keyof typeof PRIVACY_FIELDS;

export interface PrivacySettings {
  readonly showLocation: boolean;
  readonly showCredits: boolean;
  readonly showFleet: boolean;
  readonly showActivity: boolean;
  readonly showOnPublicRoster: boolean;
  readonly showOnLeaderboard: boolean;
}

/**
 * What a member gets before they have ever opened the settings page.
 *
 * Every value is false, and that is the whole point: the privacy row is created
 * lazily, so in production most members have no row at all. This object is what
 * `null` resolves to, which makes "no row" mean "fully private" rather than
 * "unconfigured, so show everything".
 */
export const DEFAULT_PRIVACY: PrivacySettings = {
  showLocation: false,
  showCredits: false,
  showFleet: false,
  showActivity: false,
  showOnPublicRoster: false,
  showOnLeaderboard: false,
};

export interface ProfileLocation {
  readonly system: string;
  readonly station: string | null;
}

export interface ProfileShip {
  readonly shipType: string;
  readonly name: string | null;
}

/** The full internal record. Deliberately NOT the shape that goes out. */
export interface ProfileSource {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string;
  /** Discord's avatar HASH as last seen, despite the name. See the column comment. */
  readonly avatarUrl: string | null;
  /** The hash we have actually COPIED into object storage. Null means no picture to serve. */
  readonly avatarStoredHash: string | null;
  readonly bio: string | null;
  readonly timezone: string;
  /**
   * Last moment the companion app saw their journal still being WRITTEN.
   *
   * Not private in the way a position is: it says somebody is playing, not
   * where or what. It is the difference between a roster and a phone book, and
   * it is the question anybody scanning one before an operation actually has.
   */
  readonly lastPlayingAt: Date | null;
  readonly joinedAt: Date;
  readonly status: string;
  /**
   * Squadron roles, highest first.
   *
   * Carries the Discord colour so a card can render a role the way the member
   * already sees it in Discord — recognising your own colour is faster than
   * reading your own role name, and the two disagreeing looks like a bug.
   */
  readonly ranks: ReadonlyArray<{ name: string; colour: string | null }>;
  /** Snowflakes of the Discord roles this member currently holds. Resolved by the caller. */
  readonly guildRoleIds?: readonly string[];
  /** Holds a permission that requires a second factor. Drives the officers tab. */
  readonly isOfficer?: boolean;
  readonly cmdrName: string | null;
  readonly location?: ProfileLocation | null;
  readonly credits?: bigint | null;
  readonly fleet?: readonly ProfileShip[] | null;
  readonly activity?: { messages: number; voiceMinutes: number } | null;
  /** Present on the row, never on a profile. Listed so the type stops it being spread out by accident. */
  readonly email?: string | null;
}

/**
 * Who is asking.
 *
 * `officer` exists to be REFUSED, not to be privileged. It is spelled out so
 * that a future caller passing an officer's audience gets the public shape
 * rather than accidentally landing in a permissive default branch.
 */
export type Audience = 'public' | 'self' | 'officer';

export interface PublicProfile {
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly bio: string | null;
  readonly timezone: string;
  /** ISO instant, or null. See the note on ProfileSource. */
  readonly lastPlayingAt: string | null;
  readonly joinedAt: string;
  readonly status: string;
  readonly ranks: readonly string[];
  readonly cmdrName: string | null;
  readonly location?: ProfileLocation | null;
  /** A STRING. Balances exceed 2^53, where a JS number rounds silently. */
  readonly credits?: string | null;
  readonly fleet?: readonly ProfileShip[] | null;
  readonly activity?: { messages: number; voiceMinutes: number } | null;
}

/**
 * Resolves a stored privacy row into a complete settings object.
 *
 * Handles two cases that both mean "private": no row at all, and a row written
 * before a toggle existed. Reading a missing toggle as `undefined` and letting
 * it through is the usual way this sort of check fails, so each field is
 * compared to `true` explicitly rather than tested for truthiness.
 */
export function resolvePrivacy(stored: Partial<PrivacySettings> | null | undefined): PrivacySettings {
  if (stored === null || stored === undefined) return DEFAULT_PRIVACY;
  return {
    showLocation: stored.showLocation === true,
    showCredits: stored.showCredits === true,
    showFleet: stored.showFleet === true,
    showActivity: stored.showActivity === true,
    showOnPublicRoster: stored.showOnPublicRoster === true,
    showOnLeaderboard: stored.showOnLeaderboard === true,
  };
}

/**
 * True when this field may appear at all.
 *
 * Only `self` bypasses the toggles, and only so the settings page can show a
 * member what they are currently hiding. `officer` deliberately does not:
 * INV-027 is a promise to the member rather than a permission level, and if
 * rank could override it the promise would be worth nothing.
 */
function mayInclude(field: GatedField, privacy: PrivacySettings, audience: Audience): boolean {
  if (audience === 'self') return true;
  return privacy[PRIVACY_FIELDS[field]] === true;
}

export function serializeProfile(
  source: ProfileSource,
  privacy: Partial<PrivacySettings> | null | undefined,
  opts: { audience: Audience },
): PublicProfile {
  const p = resolvePrivacy(privacy);
  // Anything that is not exactly 'self' is treated as public. An unrecognised
  // audience must land on the RESTRICTIVE branch, not fall through a switch.
  const audience: Audience = opts.audience === 'self' ? 'self' : 'public';

  // Built field by field. A spread of `source` would carry email, the internal
  // id, and every column added to the model later — the leak would arrive by
  // itself, without anyone writing a line of code.
  const out: Record<string, unknown> = {
    handle: source.handle,
    displayName: source.displayName,
    /*
       * ★ OUR OWN URL, NOT DISCORD'S HASH ★
       *
       * `source.avatarUrl` holds the avatar HASH despite its name, so emitting
       * it directly produced `<img src="a1b2c3...">` — a broken image on every
       * card, and one that would have looked like a CSS problem.
       *
       * The URL carries no hash, so a member changing their picture does not
       * change the URL; the media route serves whatever we currently hold.
       * Null when there is nothing stored, so the UI draws initials instead of
       * a broken frame.
       */
      avatarUrl: source.avatarStoredHash === null ? null : `/v1/media/avatars/${source.id}`,
    bio: source.bio,
    timezone: source.timezone,
    lastPlayingAt: source.lastPlayingAt?.toISOString() ?? null,
    joinedAt: source.joinedAt.toISOString(),
    status: source.status,
    ranks: source.ranks,
    cmdrName: source.cmdrName,
  };

  // Keys are ASSIGNED, never assigned-then-deleted. Assigning `undefined` would
  // satisfy JSON.stringify but leave the key visible to Object.keys and to any
  // code inspecting the object before it is serialised.
  if (mayInclude('location', p, audience)) out['location'] = source.location ?? null;
  if (mayInclude('credits', p, audience)) {
    out['credits'] = source.credits === null || source.credits === undefined
      ? null
      : source.credits.toString();
  }
  if (mayInclude('fleet', p, audience)) out['fleet'] = source.fleet ?? null;
  if (mayInclude('activity', p, audience)) out['activity'] = source.activity ?? null;

  return out as unknown as PublicProfile;
}

/**
 * Who appears on the roster.
 *
 * ★ EVERYBODY, AS OF 2026-07-28 ★
 *
 * Appearing used to be opt-in and defaulted to off, which made sense while the
 * roster was a public recruitment page: nobody should be listed on the open
 * internet without asking.
 *
 * The roster is now behind the sign-in, and it is the squadron's own directory
 * — the answer to "who is in this squadron and who do I fly with". A directory
 * that most of the squadron is missing from does not answer that question, and
 * the default being OFF meant it never would.
 *
 * ★ WHAT THIS DOES NOT CHANGE ★
 *
 * Only PRESENCE became mandatory. Every field on the entry is still opt-in and
 * still defaults to off: location, credits, fleet and activity are omitted
 * entirely — not blanked — for anybody who has not turned them on (INV-027).
 * So a member who shares nothing appears as a name and a rank, which is what
 * being on a team roster means.
 *
 * ★ THE ONE EXCLUSION LEFT ★
 *
 * Account status. A banned or deactivated account is not a member of the
 * squadron, and listing one would be describing the team wrongly rather than
 * protecting anybody's privacy.
 */
export function visibleOnRoster<
  T extends {
    privacy: Partial<PrivacySettings> | null | undefined;
    source: { status?: string };
  },
>(rows: readonly T[]): T[] {
  return rows.filter((r) => (r.source.status ?? 'active') === 'active');
}
