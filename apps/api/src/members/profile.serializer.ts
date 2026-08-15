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
  /**
   * Per-board participation, under the master switch above.
   *
   * ★ SQUADRON OWNER, 2026-08-04 ★
   *
   * "show each leaderboard there and add all future leaderboards here too, default all
   * leaderboard participation on for all commanders please!" `showOnLeaderboard` still turns
   * everything off at once; these narrow it board by board. A member appears on a board only
   * when the master switch AND that board's switch agree.
   */
  readonly showLbBounties: boolean;
  readonly showLbColony: boolean;
  readonly showLbTrade: boolean;
  /**
   * Render every post and signature in the site face, whatever their author chose.
   *
   * ★ A READING SETTING, NOT A PRIVACY ONE ★
   *
   * It sits on this record because that is where a member's own switches live and it is fetched
   * with them — not because it hides anything. Members can pick from thirty display faces, and a
   * thread where every post is a different one is genuinely hard to read; for anybody with dyslexia
   * or low vision the only way out today is to stop reading.
   */
  readonly plainFonts: boolean;
}

/**
 * What a member gets before they have ever opened the settings page.
 *
 * Every FIELD toggle is false, and that is the whole point: the privacy row is
 * created lazily, so in production most members have no row at all. This object
 * is what `null` resolves to, which makes "no row" mean "fully private" rather
 * than "unconfigured, so show everything".
 */
export const DEFAULT_PRIVACY: PrivacySettings = {
  showLocation: false,
  showCredits: false,
  showFleet: false,
  showActivity: false,
  showOnPublicRoster: false,
  /*
   * ★ ON, AGAINST EVERY OTHER DEFAULT IN THIS OBJECT — AND NOT A MISTAKE ★
   *
   * The field toggles above hide FACTS about a member — where they are, what
   * they own — so their conservative default is off. These four are
   * PARTICIPATION switches for the gamified boards, the schema columns default
   * TRUE, and the squadron owner's instruction was explicit: "default all
   * leaderboard participation on for all commanders". Code and schema must
   * tell the same story, or a member with no row would participate in the
   * standings SQL (which reads COALESCE(col, true)) while this object reported
   * them opted out — which is exactly what the MASTER switch did until
   * 2026-08-04: it sat here as false, so the settings page showed "off" to
   * every member who was in fact on the boards.
   */
  showOnLeaderboard: true,
  showLbBounties: true,
  showLbColony: true,
  showLbTrade: true,
  // Off: an author's chosen font is shown unless a reader says otherwise. Turning them all off by
  // default would silently discard something every member deliberately picked.
  plainFonts: false,
};

/**
 * What Frontier currently says about a member's identity.
 *
 * ★ THREE STATES, NOT A BOOLEAN — AND THE MIDDLE ONE IS WHY ★
 *
 * Frontier honours a refresh grant for 25 DAYS and no longer (ADR-003, a hard
 * ceiling nothing on our side can move). The owner made connecting Frontier a
 * mandatory step for every member, so the whole squadron crosses that ceiling
 * roughly once a month, every month, for as long as the platform exists. Expiry
 * is not an edge case here; it is the ordinary weather.
 *
 * A boolean would have to fold that into `false`, which says the same thing
 * about two people who are nothing alike: somebody who proved their identity
 * cryptographically three weeks ago and needs thirty seconds to reconnect, and
 * somebody who has never linked at all. It also makes the badge look broken —
 * an officer would watch most of the roster go dark on a rolling basis with no
 * indication that anything was wrong or what to do about it.
 *
 * `expired` is the honest sentence: we DID prove this, and we cannot prove it
 * today. It never overstates — an expired grant is never rendered as verified —
 * and it is the only one of the three that tells the reader an action exists.
 *
 * `none` deliberately also covers LINKED-BUT-NOT-YET-IDENTIFIED. The row is
 * created the instant a member authorises, carrying an empty `cmdrName`, and the
 * name arrives from a separate profile call moments later. Holding somebody's
 * tokens is not knowing who they are, and for the seconds that gap lasts the
 * truthful answer is that nothing is verified yet.
 *
 * ★ WHAT IT DOES NOT MEAN ★
 *
 * Squadron membership. Squadron verification via cAPI was dropped from scope;
 * this asserts that Frontier confirms the commander name and nothing else. No
 * copy anywhere may imply the squadron half — that is Inara's badge, and it is
 * a separate claim with a separate check.
 */
export type FrontierVerification = 'verified' | 'expired' | 'none';

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
  /**
   * Non-hierarchical roles: platform roles such as webmaster, and founding
   * standing. NOT squadron rank.
   *
   * The `key` and `rankOrder` are internal and must not be spread onto a
   * response — see `foundingStanding`, which is the only thing that reads them,
   * and the controller, which maps this to `{ name, colour }` on the way out.
   */
  readonly siteRoles?: ReadonlyArray<{
    key: string;
    name: string;
    colour: string | null;
    rankOrder: number;
  }>;
  readonly cmdrName: string | null;
  /**
   * Inara confirms BOTH the commander name and that they fly with this
   * squadron.
   *
   * Not a privacy-governed field: it describes the standing of a name that is
   * already being shown, and hiding it would leave an unverified name looking
   * identical to a verified one — which is the confusion it exists to remove.
   */
  readonly squadronVerified?: boolean;
  /**
   * Frontier's own answer about this member's identity.
   *
   * Optional here and REQUIRED on the way out, exactly as `squadronVerified` is:
   * an internal row that predates the field is `undefined`, and the serializer
   * resolves that to `none` rather than letting a missing key reach a badge.
   *
   * Not privacy-governed, for the same reason the Inara one is not: it describes
   * the standing of a name that is already on the card, and hiding it would
   * leave an unverified name looking identical to a verified one.
   */
  readonly frontierVerification?: FrontierVerification;
  readonly location?: ProfileLocation | null;
  readonly credits?: bigint | null;
  readonly fleet?: readonly ProfileShip[] | null;
  /**
   * What this member has done in the squadron THIS CALENDAR MONTH.
   *
   * ★ `voiceMinutes` WAS FICTION, AND IS GONE — AND MUST NOT COME BACK ★
   *
   * This read `{ messages, voiceMinutes }` and the profile page divided that by
   * sixty to render "hours in voice", when nothing recorded a minute of voice.
   * It shipped harmless only because the field was never populated — the first
   * person to wire it up would have published invented hours. So the shape now
   * says what is actually counted.
   *
   * The bot DOES bank real minutes now (`member_activity_months.voice_minutes`),
   * and they are ADMIN CONSOLE ONLY by the owner's decision. A real figure is
   * not a licence to widen the audience: this serializer must not regain the
   * field for any public shape.
   *
   * `gameObserved` is the one that matters: it is the single input the monthly
   * promotion check reads.
   */
  readonly activity?: {
    messages: number;
    voiceJoins: number;
    forumPosts: number;
    gameObserved: boolean;
  } | null;
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
  /** Inara confirms both the commander name and squadron membership. */
  readonly squadronVerified: boolean;
  /**
   * Frontier confirms the commander NAME. Never the squadron — see the type.
   *
   * Required, like `squadronVerified` and for the same reason: it is always
   * emitted, `none` is a real answer, and a card must not have to tell a missing
   * key apart from a negative result.
   */
  readonly frontierVerification: FrontierVerification;
  readonly location?: ProfileLocation | null;
  /** A STRING. Balances exceed 2^53, where a JS number rounds silently. */
  readonly credits?: string | null;
  readonly fleet?: readonly ProfileShip[] | null;
  /** This calendar month. Voice is JOINS — nothing records minutes. */
  readonly activity?: {
    messages: number;
    voiceJoins: number;
    forumPosts: number;
    gameObserved: boolean;
  } | null;
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
    /*
     * `!== false` where everything above is `=== true`, because these DEFAULT ON (see
     * DEFAULT_PRIVACY). A partial row missing one of them must resolve to participating —
     * exactly as the database column default and the standings SQL's COALESCE(col, true)
     * already decide — not fall to private through a check written for the field toggles.
     * The master switch is one of them: it defaults on with the boards it governs.
     */
    showOnLeaderboard: stored.showOnLeaderboard !== false,
    showLbBounties: stored.showLbBounties !== false,
    showLbColony: stored.showLbColony !== false,
    showLbTrade: stored.showLbTrade !== false,
    plainFonts: stored.plainFonts === true,
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
    /*
     * Emitted UNCONDITIONALLY, and false when there is no verification at all.
     *
     * Omitting it for unverified members would make "we checked and it is not
     * confirmed" indistinguishable from "this build does not report it", and a
     * badge that is silent in both cases cannot be trusted in either.
     */
    squadronVerified: source.squadronVerified === true,
    /*
     * Emitted UNCONDITIONALLY too, and `none` when there is no grant at all —
     * the same argument as the line above. A badge that is silent for "we
     * checked and Frontier does not confirm this" and silent for "this build
     * does not report it" cannot be trusted in either case.
     *
     * `?? 'none'` rather than a cast: an internal row assembled by something
     * that does not know about this field must land on the claim-nothing state,
     * never on `undefined` leaking through to a component's switch.
     */
    frontierVerification: source.frontierVerification ?? 'none',
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
