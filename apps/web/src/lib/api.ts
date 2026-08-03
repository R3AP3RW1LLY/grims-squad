import { cookies } from 'next/headers';
import type { SignatureView } from '@grims/shared';
import type { BannerIdentity } from '../components/forum/banner-render';

/**
 * Server-side calls into our own API.
 *
 * The browser reaches the API through the same origin (Caddy routes `/v1/*` to
 * it), but a React Server Component runs INSIDE the container, where that
 * origin does not resolve to anything useful. So server calls go direct and
 * browser calls go relative — the same URL string would be wrong in one of the
 * two places.
 */
/**
 * Where the API lives, as seen FROM THE SERVER.
 *
 * ★ THIS DEFAULT AND THE ONE IN next.config.mjs MUST AGREE ★
 *
 * They did not. The rewrite used :5001 and this used :3001, so every
 * browser-side call worked (it went through the proxy) and every SERVER-side
 * call failed with ECONNREFUSED — which the client then swallowed and turned
 * into a null. The visible symptom was a dashboard that said "sign in with
 * Discord" immediately after signing in successfully, with nothing anywhere
 * explaining why.
 *
 * The API's own default is API_PORT ?? 5001 (apps/api/src/main.ts), which is
 * the number all three have to match. There is a test asserting these two
 * agree, because one value written down twice will drift again.
 */
export const DEFAULT_API_ORIGIN = 'http://localhost:5001';

const SERVER_API = process.env['API_INTERNAL_URL'] ?? DEFAULT_API_ORIGIN;

export interface PublicProfile {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  timezone: string;
  /** Journal still being written as of this instant. Drives "playing now".*/
  lastPlayingAt: string | null;
  joinedAt: string;
  status: string;
  /** Squadron roles, highest first, with the colour Discord shows them in. */
  ranks: Array<{ name: string; colour: string | null }>;
  cmdrName: string | null;
  /**
   * Inara confirms BOTH the commander name and that they fly with this
   * squadron.
   *
   * Required, not optional: it is always emitted, and `false` is a real answer
   * meaning "checked, not confirmed". Typing it as optional would let a card
   * treat a missing key and a negative result the same way, which is the
   * ambiguity the badge exists to remove.
   */
  squadronVerified: boolean;
  /*
   * These are OPTIONAL in the type, not nullable, and that is deliberate
   * (INV-027). A member who has not opted in produces a response with the key
   * ABSENT, and typing them as `x | null` would let a component render "—" for
   * a value it was never given, quietly implying the field exists and is empty.
   */
  location?: { system: string; station: string | null } | null;
  credits?: string | null;
  fleet?: Array<{ shipType: string; name: string | null }> | null;
  /**
   * This calendar month's squadron activity.
   *
   * Voice is JOINS, not minutes: Discord reports somebody entering a channel
   * and never how long they stayed, so nothing records a minute of voice. The
   * field this replaces was called `voiceMinutes` and the profile page divided
   * it by sixty to render "hours in voice" — which would have been invented the
   * moment anyone populated it.
   */
  activity?: {
    messages: number;
    voiceJoins: number;
    forumPosts: number;
    /** A game session was seen. The single input the promotion check reads. */
    gameObserved: boolean;
  } | null;
}

export interface PrivacySettings {
  showLocation: boolean;
  showCredits: boolean;
  showFleet: boolean;
  showActivity: boolean;
  showOnPublicRoster: boolean;
  showOnLeaderboard: boolean;
  /** Render every post and signature in the site face, whatever their author chose. */
  plainFonts: boolean;
}

/**
 * Fetches from the API as the signed-in visitor.
 *
 * Forwards the request's cookies, because the API decides `self` versus
 * `public` from the session — without them a member's own profile page would
 * render them the public view of themselves.
 */
async function get<T>(path: string, opts: { authed?: boolean } = {}): Promise<T | null> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.authed === true) {
    const jar = await cookies();
    const cookieHeader = jar
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    if (cookieHeader !== '') headers['cookie'] = cookieHeader;
  }

  try {
    const res = await fetch(`${SERVER_API}${path}`, {
      headers,
      // Profiles change when a member edits them. A cached roster that keeps
      // showing someone who has just opted OUT would be a privacy failure with
      // a perfectly innocent cause.
      cache: 'no-store',
    });
    if (!res.ok) {
      /*
       * A non-2xx is USUALLY 401 on an authed call, which is an ordinary
       * signed-out request and not worth a log line. Anything else is worth
       * knowing about, because the symptom on the page is identical — an empty
       * state — and silence makes "not signed in" and "the API is broken" look
       * exactly the same to whoever is debugging it.
       */
      if (res.status !== 401 && process.env.NODE_ENV !== 'production') {
        console.error(`[api] ${path} → ${res.status}`);
      }
      return null;
    }
    return (await res.json()) as T;
  } catch (cause) {
    /*
     * The page renders its empty state rather than a 500: an API that is down
     * should not take the public site down with it.
     *
     * But it SAYS SO in development. A bare `catch { return null }` here cost
     * real debugging time — a dashboard that rendered "sign in" after a
     * successful login, with nothing anywhere to explain it, because the fetch
     * never reached the API at all.
     */
    if (process.env.NODE_ENV !== 'production') {
      const inner = (cause as { cause?: { code?: string; message?: string } }).cause;
      console.error(
        `[api] ${SERVER_API}${path} FAILED:`,
        cause instanceof Error ? cause.message : cause,
        inner?.code ?? inner?.message ?? '',
      );
    }
    return null;
  }
}

/**
 * ★ `authed: true` IS LOAD-BEARING ★
 *
 * The endpoint moved behind the sign-in and this call did not follow. Without
 * credentials the API answered 401, `get` swallowed it, and the roster rendered
 * "nobody has opted in yet" — a sentence that was both wrong and impossible to
 * debug from, because it described a privacy setting rather than a failed
 * request.
 */
/** What the journal knows about a commander, for the roster cards. */
export interface CommanderSnapshot {
  /** All six ladders, always. `name` is null for one nothing has been reported for. */
  ranks: Array<{ key: string; label: string; name: string | null; index: number | null }>;
  /** Where the ranks came from. Inara is self-reported; the journal is the game. */
  rankSource: 'inara' | 'journal' | null;
  /** When Inara was last asked. Null unless rankSource is 'inara'. */
  ranksFetchedAt: string | null;
  squadronRank: number | null;
  currentShip: string | null;
  lastPlayedAt: string | null;
}

/** A Discord role, with what it means to us. Channel-access roles never arrive. */
export interface DiscordRoleBadge {
  name: string;
  /** `#rrggbb`, or null where Discord reports no colour. */
  colour: string | null;
  category: 'rank' | 'membership' | 'award';
}

export type RosterMember = PublicProfile & {
  commander: CommanderSnapshot;
  /** Membership, rank and awards, highest first. Channel access is filtered server-side. */
  discordRoles: DiscordRoleBadge[];
  /**
   * Holds a squadron LEADERSHIP appointment. Drives the officers tab.
   *
   * A rank question, not a permission one: the webmaster holds every permission
   * on the platform and no standing in the squadron at all.
   */
  isOfficer: boolean;
  /** Platform roles such as webmaster. Shown as a title, never as a rank. */
  siteRoles: Array<{ name: string; colour: string | null }>;
};

/**
 * One commander's full record.
 *
 * Everything a roster entry has, plus the squadron join date — which the roster
 * has no room for and which is the only honest answer to "how long have they
 * been here".
 */
export type MemberProfileExtras = {
  /**
   * When DISCORD says they joined the squadron. Null when not known.
   *
   * Not `joinedAt`, which is when they created a website account: a commander
   * who has flown here for years and signed in yesterday read as "1 day".
   * Inara cannot answer it — its commander profile carries the squadron name
   * and the member's rank in it, and no join date anywhere.
   */
  guildJoinedAt: string | null;
};

export const getRoster = (): Promise<{ members: RosterMember[]; total: number } | null> =>
  get('/v1/members', { authed: true });

/**
 * One commander's full record.
 *
 * ★ THE SAME SHAPE AS A ROSTER ENTRY, DELIBERATELY ★
 *
 * The profile page is reached from a card, and a page that showed different
 * pilot ranks from the card that linked to it is the kind of contradiction
 * nobody reports and everybody notices. Identical shape, built by identical
 * code on the server.
 */
export type MemberProfile = RosterMember & MemberProfileExtras;

/**
 * The handle behind a member id, for resolving a @mention link.
 *
 * Null covers every failure — no such id, a banned account, the API unreachable — because the
 * caller turns all of them into the same 404. A mention that points at a removed member is a dead
 * link, not a page that confirms they existed.
 */
export const getHandleForId = (userId: string): Promise<{ handle: string } | null> =>
  get<{ handle: string }>(`/v1/members/id/${encodeURIComponent(userId)}`, { authed: true });

export const getProfile = (handle: string): Promise<MemberProfile | null> =>
  get<MemberProfile>(`/v1/members/${encodeURIComponent(handle)}`, { authed: true });

export const getMyPrivacy = (): Promise<PrivacySettings | null> =>
  get('/v1/me/privacy', { authed: true });

export interface SessionRow {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export const getMySessions = (): Promise<{ sessions: SessionRow[] } | null> =>
  get('/v1/me/sessions', { authed: true });

export interface DeviceRow {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export const getMyDevices = (): Promise<{ devices: DeviceRow[] } | null> =>
  get('/v1/me/devices', { authed: true });

/** One journal event, described for somebody deciding whether to share it. */
export interface CatalogueEntry {
  event: string;
  label: string;
  reveals: string;
}

export interface CatalogueGroup {
  category: string;
  label: string;
  purpose: string;
  /** True for `session`, which cannot be switched off. */
  required: boolean;
  entries: CatalogueEntry[];
}

/**
 * What the member has switched OFF, plus the catalogue of what they could.
 *
 * Opt-out (INV-013, amended 2026-07-29): empty lists mean everything is kept.
 * The catalogue travels with the answer so this page cannot drift from what the
 * server will actually accept.
 */
export interface TelemetryConsent {
  optOutCategories: string[];
  optOutEvents: string[];
  catalogue: CatalogueGroup[];
  requiredCategory: string;
}

export const getMyTelemetryConsent = (): Promise<TelemetryConsent | null> =>
  get('/v1/me/telemetry-consent', { authed: true });

export const getTotpStatus = (): Promise<{ enrolled: boolean } | null> =>
  get('/v1/auth/totp/status', { authed: true });

export interface AdminActivityRow {
  discordId: string;
  handle: string | null;
  displayName: string | null;
  /** Server nickname — the in-game name, by this squadron's convention. */
  nick: string | null;
  /** They have an account here, not merely a presence in Discord. */
  joinedWebsite: boolean;
  /** A verified commander name. Null when unverified. */
  cmdrName: string | null;
  /** How it was proven: `inara_nonce`, `fdev_capi`, `officer_manual`. */
  verifiedVia: string | null;
  /**
   * The last time they did anything in DISCORD, ever. Null if never.
   *
   * Not a website sign-in, and not scoped to the month on screen — somebody
   * who has not spoken since May must still show as gone quiet in July.
   */
  lastSeenAt: string | null;
  /**
   * When they joined the voice channel they are in RIGHT NOW. Null if not in one.
   *
   * The only field on this row about the present rather than the past, which is
   * why it takes precedence in the Last Seen column: a member who has been in
   * comms all evening without typing is not somebody who has gone quiet, however
   * old their last message is.
   */
  inVoiceSince: string | null;
  /** Their TENURE rank — the ladder promotion moves them up. */
  currentRank: string | null;
  /** A leadership APPOINTMENT, a separate axis. Not on the promotion ladder. */
  appointment: string | null;
  /** What to show when they hold no rank role. Display only — never a rung. */
  membershipRole: string | null;
  /** The next rung up, or null at the top of the ladder. */
  nextRank: string | null;
  messageCount: number;
  forumPostCount: number;
  voiceJoinCount: number;
  gameActivity: string;
  qualifies: boolean;
  lastActivityAt: string | null;
  /**
   * When Discord says they joined the server — how long they have been in the squadron.
   *
   * Not from Inara: its commander endpoint returns a squadron name and rank and no dates, and there
   * is no roster endpoint. The game does not record it either. Discord is the only source that has
   * it, and for a squadron that recruits through Discord it is the right one.
   *
   * Null for everybody who has left — Discord discards the date on departure — in which case the
   * column falls back to `activeSince` and says so.
   */
  joinedAt: string | null;
  /** Earliest recorded activity. A weaker claim than `joinedAt`, and labelled differently. */
  activeSince: string | null;
}

export interface AdminAuditRow {
  id: string;
  action: string;
  actorHandle: string | null;
  /** Discord server nickname, kept matching the member's in-game name. */
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  /**
   * The target's Discord nickname, when the target is a member.
   *
   * The id stays alongside it: a display name is chosen by the member and can be changed to match
   * somebody else's, so the stable identifier remains what actually identifies the row.
   */
  targetName: string | null;
  /** What changed (INV-009). Stored since the beginning; only now sent to the page. */
  before: unknown;
  after: unknown;
  createdAt: string;
}

/**
 * Admin reads return null on ANY non-2xx, which includes the 401 that the
 * two-factor gate produces. The page renders its own step-up prompt rather
 * than a crash — a locked door should look like a locked door.
 */
/** Squadron-wide figures for the admin dashboard. Aggregates only, never one member's data. */
export interface AdminDashboard {
  month: string;
  /** 28, 29, 30 or 31 — the axis length, sent so the client is not a second leap-year implementation. */
  daysInMonth: number;
  /** Months that actually have activity, newest first. Drives the history tabs. */
  availableMonths: string[];
  /** What one bar of the activity chart covers. `month` in the year view. */
  granularity: 'day' | 'month';
  discord: {
    messages: number;
    forumPosts: number;
    voiceJoins: number;
    activeMembers: number;
    trackedMembers: number;
    /** Messages per day of the month, index 0 = the 1st. */
    daily: number[];
    /** Distinct members active on each day, index 0 = the 1st. */
    /** Voice joins per day, split out of the old combined "actions" figure. */
    dailyVoice: number[];
    /** Forum posts per day. */
    dailyForum: number[];
    dailyMembers: number[];
    top: Array<{ name: string; messages: number; voice: number; cmdrName: string | null }>;
  };
  game: {
    events: number;
    reporting: number;
    sessionsThisMonth: number;
    /**
     * Elite sign-ins per day of the month, index 0 = the 1st.
     *
     * `LoadGame` in the journal — the event written when a commander loads into
     * the game, so counting them IS counting sign-ins. Drives the green line on
     * the activity chart.
     */
    dailySignIns: number[];
    flyingThisMonth: number;
    playingNow: number;
    ships: Array<{ ship: string; pilots: number }>;
    /** What the squadron is wearing on foot. Same journal source as `ships`, filtered the other way. */
    suits: Array<{ suit: string; pilots: number }>;
    /** Wealth distribution among members who opted in. Empty when too few to be anonymous. */
    creditBands: Array<{ band: string; pilots: number }>;
    byType: Array<{ type: string; count: number }>;
  };
  squadron: {
    /** Members of the GUILD, bots excluded. Not website accounts. */
    members: number;
    /** Of those, how many have an account here. */
    withAccounts: number;
    verified: number;
    /** Tenure ranks, highest first. */
    ranks: Array<{ rank: string; held: number }>;
    /** Leadership appointments — a separate axis, not on the promotion ladder. */
    appointments: Array<{ rank: string; held: number }>;
    qualifying: number;
  };
}

export const getAdminDashboard = (month?: string): Promise<AdminDashboard | null> =>
  get(`/v1/admin/dashboard${month === undefined ? '' : `?month=${encodeURIComponent(month)}`}`, {
    authed: true,
  });

export const getAdminActivity = (
  month?: string,
): Promise<{ month: string; rows: AdminActivityRow[] } | null> =>
  get(`/v1/admin/activity${month === undefined ? '' : `?month=${encodeURIComponent(month)}`}`, {
    authed: true,
  });

/**
 * One member of the Discord server, for the Squad Members roster.
 *
 * Not the same list as `getAdminMembers`, which returns WEBSITE accounts — one of them, against a
 * hundred and seventeen people in Discord. An officer moderating the squadron works from this one.
 */
export interface PromotionStanding {
  userId: string;
  currentRank: string | null;
  nextRank: string | null;
  qualifyingMonths: number;
  monthsRequired: number | null;
  earned: boolean;
}

export interface PromotionReport {
  dryRun: boolean;
  ranAt: string;
  considered: number;
  wouldPromote: Array<{ userId: string; handle: string; from: string; to: string; qualifyingMonths: number }>;
  skipped: Array<{ userId: string; handle: string; rank: string; reason: string }>;
  promoted: number;
  failed: Array<{ userId: string; handle: string; reason: string }>;
}

export const getPromotionStandings = (): Promise<{ standings: PromotionStanding[] } | null> =>
  get('/v1/admin/promotions/standings', { authed: true });

export interface SquadMemberRow {
  /** Their website user id, or null for somebody in the guild with no account. */
  userId: string | null;
  discordId: string;
  /** Server nickname — the in-game name, by this squadron's convention. */
  nick: string | null;
  username: string | null;
  globalName: string | null;
  isBot: boolean;
  /** Every Discord role they wear, by name. */
  roles: string[];
  /** Highest TENURE rank. Separate axis from `appointment`. */
  rank: string | null;
  appointment: string | null;
  joinedAt: string | null;
  /**
   * When a Discord timeout expires.
   *
   * A value IN THE PAST means not timed out — Discord expires a timeout silently, so this is
   * compared against the clock rather than tested for null.
   */
  timeoutUntil: string | null;
  inVoiceSince: string | null;
  lastSeenAt: string | null;
  hasAccount: boolean;
  handle: string | null;
  cmdrName: string | null;
  /**
   * Whether Discord will let the bot act on them at all.
   *
   * A bot cannot kick, ban or time out anybody whose highest role sits at or above its own,
   * whatever permissions it holds. Computed server-side so the page can disable the controls and
   * say why, rather than offering an action that always comes back 403.
   */
  moderatable: boolean;
  notModeratableBecause: string | null;
}

/**
 * The Discord roster, read through the gate.
 *
 * `getAdmin`, not `get`: a plain read collapses every failure into null, and the Squad Members page
 * would then show a two-factor code box to somebody who simply lacks MEMBER_MANAGE. That exact
 * confusion cost an officer an evening on 2026-07-30 — see the note on `getAdmin`.
 */
export const getSquadRosterGated = (): Promise<AdminRead<{ rows: SquadMemberRow[] }>> =>
  getAdmin('/v1/admin/squad');

export const getAdminAudit = (): Promise<{
  entries: AdminAuditRow[];
  actions: string[];
  total: number;
  page: number;
  pageSize: number;
} | null> => get('/v1/admin/audit?limit=100&page=1', { authed: true });

/**
 * A post the screener held, waiting for a human.
 *
 * Mirrors `HeldPost` on the API. `reason` is the field an officer actually triages on: `flagged`
 * means the model objected and `categories` says to what; `unavailable` means the screener could
 * not be reached and NOBODY has judged this post — which usually means it is fine and needs a
 * glance, not a verdict.
 */
export interface HeldPostRow {
  id: string;
  threadId: string;
  threadTitle: string;
  categorySlug: string;
  bodyHtml: string;
  authorHandle: string;
  authorName: string;
  createdAt: string;
  reason: 'flagged' | 'unavailable';
  categories: string[];
  /** The model's own words. For the reviewer only — never shown to the author. */
  modelReason: string | null;
}

/** The moderation queue. Null when the caller may not review, which the tab renders as no-access. */
export const getHeldPosts = (): Promise<{ posts: HeldPostRow[]; total: number } | null> =>
  get('/v1/forum/review/held', { authed: true });

/**
 * Whether the AI is answering, reported per runtime.
 *
 * Two GPUs, two services, and they fail independently — the usual state during a game session is
 * text up and image busy. One combined "AI: ok" would be wrong most evenings.
 */
export const getAiHealth = (): Promise<{
  /* No model identifier: the API deliberately does not return one. See AI_NAME. */
  text: { configured: boolean; reachable: boolean; tookMs: number };
  image: { configured: boolean; reachable: boolean; tookMs: number };
} | null> => get('/v1/ai/health', { authed: true });

export interface SquadronStats {
  /** People in the Discord guild, bots excluded. THIS is the squadron. */
  members: number;
  /** Of those, how many have signed up here. */
  withAccounts: number;
  activeThisMonth: number;
  activityThisMonth: number;
  verifiedCommanders: number;
  foundedYear: number;
  generatedAt: string;
}

/**
 * Squadron statistics for the landing page.
 *
 * From OUR database, never a third party (P1.9): the landing page is the first
 * thing anyone sees, and reading it live from Inara or EDSM would put their
 * uptime and rate limits in front of the squadron's front door.
 */
/** One ship a commander owns, from their game journal. */
export interface OwnedShip {
  shipType: string;
  name: string | null;
  /** The ship they were last flying. */
  current: boolean;
  location: string | null;
}

/** A commander's own dashboard data. Their data, so no privacy filter applies. */
export interface CommanderProfile {
  cmdrName: string | null;
  ranks: Array<{ key: string; label: string; name: string | null; index: number | null }>;
  rankSource: 'inara' | 'journal' | null;
  ranksFetchedAt: string | null;
  currentShip: string | null;
  fleet: OwnedShip[];
  /**
   * The commander's balance, from `LoadGame`.
   *
   * ★ THIS COMMENT SAID "ALWAYS NULL TODAY" AND WAS WRONG BY THE TIME IT WAS
   * READ AT P1 EXIT ★
   *
   * `Credits` was added to the `LoadGame` allowlist on 2026-07-29 when the
   * squadron owner asked for Balance to show on the profile. Verified in
   * production the same day: 68 of 68 `LoadGame` events carry it. A comment
   * asserting a field is always empty is exactly the kind of note somebody
   * later trusts instead of checking.
   *
   * Still nullable: a member who has never run the companion app has no
   * LoadGame, and the field is governed by the privacy toggles like the rest.
   */
  credits: number | null;
  lastPlayedAt: string | null;
  squadronRank: number | null;
  /** The system they were last seen in. Null until something reports one. */
  currentSystem: string | null;
  systemSeenAt: string | null;
  /** Station, settlement or body — whatever the journal last named inside the system. */
  currentLocation: string | null;
  /** Its own timestamp: a docking and a jump age at different rates. */
  locationSeenAt: string | null;
}

export const getMyCommander = (): Promise<CommanderProfile | null> =>
  get('/v1/me/commander', { authed: true });

export const getSquadronStats = (): Promise<SquadronStats | null> => get('/v1/public/stats');

export interface AdminRoleRow {
  id: string;
  key: string;
  name: string;
  /** DECIMAL STRING. Above 2^53 a JSON number would round it (INV-006). */
  permMask: string;
  rankOrder: number;
  /** True for the promotion ladder, false for orthogonal tags. */
  isHierarchical: boolean;
}

export interface AdminMappingRow {
  roleId: string;
  roleName: string;
  discordRoleId: string;
  /** The role's name and colour in Discord. Null when the guild no longer has it. */
  discordName: string | null;
  discordColour: string | null;
}

export const getAdminRoles = (): Promise<{ roles: AdminRoleRow[] } | null> =>
  get('/v1/admin/roles', { authed: true });

export const getAdminMappings = (): Promise<{ mappings: AdminMappingRow[] } | null> =>
  get('/v1/admin/mappings', { authed: true });

export interface InaraStatus {
  linked: boolean;
  cmdrName: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  source: string | null;
  /**
   * Name proven, squadron confirmed, or neither.
   *
   * One field rather than two booleans for each page to combine. Three states
   * have three messages, and letting every screen derive them invites two of
   * them to disagree about what "partially verified" means.
   */
  squadronStatus?: 'unverified' | 'partial' | 'verified';
  /** The squadron Inara last reported, verbatim. Null when they set none. */
  inaraSquadron?: string | null;
  /** The squadron we are looking for, so no page hardcodes it. */
  expectedSquadron?: string;
  /** They have said they applied. Drives the twenty-minute re-check. */
  squadronClaimed?: boolean;
  squadronCheckedAt?: string | null;
  /**
   * The Discord nickname they will wear, computed by the same function that
   * sets it. Shown rather than described as "RANK - COMMANDER", because a long
   * commander name drops the rank to fit Discord's 32 characters — the template
   * is sometimes a shape nobody wears.
   */
  discordNickname?: string | null;
}

/**
 * Whether an Inara key is on file, and the verified commander name.
 *
 * Note what is NOT in the type: the key. The server reports that one exists and
 * never what it is, so there is no shape here for a component to leak (INV-012).
 */
/** One companion-app installer, as offered for download. */
export interface ReleaseAsset {
  file: string;
  platform: 'windows' | 'macos' | 'linux';
  version: string | null;
  sizeBytes: number;
  builtAt: string;
}

/**
 * Installers available right now.
 *
 * Empty is a NORMAL answer — nothing built yet — and the page says so rather
 * than offering a dead button. Null means the call failed, which is different.
 */
export const getCompanionReleases = (): Promise<{ assets: ReleaseAsset[] } | null> =>
  get('/v1/companion/releases', { authed: true });

export const getInaraStatus = (): Promise<InaraStatus | null> =>
  get('/v1/me/inara', { authed: true });

export interface NavItem {
  href: string;
  label: string;
  // 'ai' added 2026-08-01 — the GMSD AI sidebar group. Mirrors NavItem in the API's nav.ts; the
  // API decides which items a member gets, this only names the headings.
  section: 'squadron' | 'personal' | 'ai' | 'admin';
  /**
   * A collapsible group WITHIN a section, closed by default. Absent for items that sit directly
   * under the heading.
   *
   * Squadron owner, 2026-08-01: the Shipyard is a subcategory of Squadron holding the Outfitter.
   */
  subsection?: string;
  blurb: string;
}

export interface MeResponse {
  user: {
    userId: string;
    handle: string;
    displayName: string;
    /** Our own URL, never Discord's. Null when they have no picture. */
    avatarUrl: string | null;
    rank: string | null;
    /** IANA zone. Every time outside the audit log renders in this. */
    timezone: string;
  } | null;
  nav: NavItem[];
  isAdmin: boolean;
  mustSecureAccount: boolean;
  /**
   * The rank being previewed, or null.
   *
   * Every page renders its chrome from this response, so the banner announcing a preview comes free
   * — and it has to, because a preview with nothing on screen saying so is indistinguishable from
   * having lost permissions.
   */
  viewingAs: { id: string; name: string } | null;
  /**
   * What they still owe. Decided by the SERVER (onboarding-gate.ts) so the
   * ordering lives in one place — two copies of a rule this fiddly drift, and
   * the symptom is a member bounced between two pages.
   */
  /** Absolute instants, so the browser can count down without clock agreement. */
  session: {
    expiresAt: string | null;
    twoFactorExpiresAt: string | null;
  };
  onboarding: {
    step: 'security' | 'commander' | 'verification' | null;
    path: string | null;
    promptForVerification: boolean;
    verified: boolean;
  };
}

/**
 * Everything the signed-in chrome needs, in ONE request.
 *
 * Four calls would mean four round trips per page AND four moments where the
 * answers can disagree — so a member briefly sees an admin link that the next
 * response takes away.
 *
 * Falls back to a signed-out shape rather than null: the navbar renders on
 * every page including the public ones, and `me === null` at every call site
 * would mean the same signed-out branch written a dozen times.
 */
export const getMe = async (): Promise<MeResponse> =>
  (await get<MeResponse>('/v1/me', { authed: true })) ?? {
    user: null,
    nav: [],
    isAdmin: false,
    mustSecureAccount: false,
    viewingAs: null,
    session: { expiresAt: null, twoFactorExpiresAt: null },
    onboarding: { step: null, path: null, promptForVerification: false, verified: false },
  };

/**
 * The zones the picker offers.
 *
 * Read from the SERVER's runtime rather than hard-coded here, because the IANA
 * database changes and a list we maintained would eventually deny somebody the
 * zone they actually live in.
 */
export const getTimezones = (): Promise<{ timezones: string[]; fallback: string } | null> =>
  get('/v1/me/timezones', { authed: true });

/** The member's own pending commander claim, if any. */
export const getMyClaim = (): Promise<{
  pending: { cmdrName: string; nonce: string; expiresAt: string } | null;
} | null> => get('/v1/me/cmdr', { authed: true });

export interface AccountStatus {
  privileged: boolean;
  twoFactorEnrolled: boolean;
  needsSecuring: boolean;
  /** The permission names that create the obligation, so the UI can say WHY. */
  because: string[];
}

/**
 * What this member still has to do.
 *
 * Takes no id — it reports the CALLER's own status and nothing else, so there
 * is no way to point it at somebody else or enumerate who holds privileged
 * permissions.
 */
export const getAccountStatus = (): Promise<AccountStatus | null> =>
  get('/v1/auth/me/account-status', { authed: true });

/**
 * What the website needs to decide whether to announce a new companion release.
 *
 * FACTS, not the decision — the rule lives in `update-banner-rules.ts`, where it
 * is tested. Splitting it across the API and the browser is how one of its three
 * conditions quietly stops being checked.
 */
export interface UpdateStatus {
  latestVersion: string | null;
  releasedAt: string | null;
  /** One entry per ACTIVE device. Null means it has not reported a version yet. */
  deviceVersions: Array<string | null>;
}

export const getUpdateStatus = (): Promise<UpdateStatus | null> =>
  get<UpdateStatus>('/v1/companion/update-status', { authed: true });

/** A forum category, as the signed-in caller is allowed to see it. */
export interface ForumCategory {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  isLocked: boolean;
  /**
   * Whether THIS member may start a thread here.
   *
   * A boolean, deliberately. The raw `postPerm` mask never leaves the server —
   * sending it would tell a member exactly which permission bit they are missing,
   * which is a map of the permission model handed to anybody who opens the
   * network tab.
   */
  canPost: boolean;
  /**
   * Threads with activity this member has not seen since they last opened the board.
   *
   * Optional because an anonymous visitor gets nothing: an unread badge for somebody with no
   * account is noise about content they cannot follow.
   */
  unreadCount?: number;
}

/**
 * The categories this caller can see.
 *
 * Returns null when the API could not be reached — the page renders its empty
 * state rather than a 500. An EMPTY ARRAY is a different answer and a real one:
 * it means the caller is entitled to see no categories, which for a signed-out
 * visitor is the correct result while every category is members-only.
 */
export const getForumCategories = (): Promise<{ categories: ForumCategory[] } | null> =>
  get<{ categories: ForumCategory[] }>('/v1/forum/categories', { authed: true });

/* ------------------------------------------------------------------ guides */

/**
 * Public guides, for the site navigation and the public guides pages.
 *
 * ★ THESE HIT THE SAME ENDPOINTS THE HUB USES, WITH NO CREDENTIALS ★
 *
 * Squadron owner, 2026-07-29: "when a post is public in guides it should be publically
 * visible on the website homepage navbar".
 *
 * `authed` is deliberately absent, so no cookie is forwarded and the API resolves the
 * caller as ANONYMOUS. Whatever comes back is therefore, by construction, exactly what
 * an unauthenticated visitor may see: the guides category (`view_perm IS NULL`) and
 * within it only threads with `is_public = true`.
 *
 * That matters more than it looks. Filtering "public" in the web layer would mean the
 * navigation's idea of public and the API's could drift, and the drift would be
 * invisible until a private draft appeared in a menu. Here there is only one filter and
 * it lives in the data layer.
 */
export interface PublicGuide {
  id: string;
  slug: string;
  title: string;
  postCount: number;
  createdAt: string;
  author: { handle: string; displayName: string };
}

export interface GuidePost {
  id: string;
  /** Pre-sanitised server-side (INV-035); safe to embed without escaping. */
  bodyHtml: string;
  createdAt: string;
  editedAt: string | null;
  author: { handle: string; displayName: string };
}

/**
 * Published threads on a PUBLIC board.
 *
 * ★ TAKES THE BOARD, RATHER THAN ONE PER BOARD ★
 *
 * There are two public boards now — Guides and Recruiting — and there will be more. A second
 * hardcoded fetcher would have been a second place for the "empty on failure" rule to live, and
 * the second place is the one that eventually throws instead.
 */
export const getPublicBoardThreads = async (slug: string): Promise<PublicGuide[]> => {
  const res = await get<{ threads: PublicGuide[] }>(
    `/v1/forum/categories/${encodeURIComponent(slug)}/threads`,
  );
  /*
   * An empty list on failure, not a thrown error. This feeds the site's navigation on
   * every page: if the API is briefly unreachable the header should render without a
   * Guides menu, not take the whole page down with it. A missing menu entry is a
   * degradation; a 500 on the home page is an outage.
   */
  return res?.threads ?? [];
};

/** Guides specifically — the navigation and the guides index both want exactly this. */
export const getPublicGuides = (): Promise<PublicGuide[]> => getPublicBoardThreads('guides');

export const getPublicBoardThread = (
  board: string,
  slug: string,
): Promise<{ thread: PublicGuide; posts: GuidePost[] } | null> =>
  get(
    `/v1/forum/categories/${encodeURIComponent(board)}/threads/${encodeURIComponent(slug)}`,
  );

export const getPublicGuide = (
  slug: string,
): Promise<{ thread: PublicGuide; posts: GuidePost[] } | null> =>
  getPublicBoardThread('guides', slug);

/* ------------------------------------------------------- forum, authenticated */

export interface HubCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  canPost: boolean;
  /** Threads with activity this member has not seen. Absent or 0 for an anonymous visitor. */
  unreadCount?: number;
}

export interface ForumIdentity {
  handle: string;
  displayName: string;
  /** A path on our own API, or null. Never a third-party address — see the API's `avatarPath`. */
  avatarUrl: string | null;
}

export interface HubThread {
  id: string;
  slug: string;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  postCount: number;
  viewCount: number;
  lastPostAt: string | null;
  createdAt: string;
  author: ForumIdentity;
  /** Null when nobody has replied, so a quiet thread cannot be made to look busy. */
  lastPoster: ForumIdentity | null;
  /** Server-decided: whether this caller may mark a reply as the answer. Re-checked on write. */
  canMarkSolution: boolean;
}

export interface HubPost {
  id: string;
  /** Keys the signature map on the thread response. */
  authorId: string;
  bodyHtml: string;
  createdAt: string;
  editedAt: string | null;
  editCount: number;
  author: ForumIdentity;
  /** The post this answers, when it answers one in particular. Who and where, never what. */
  replyTo: { postId: string; author: { handle: string; displayName: string } } | null;
  isSolution: boolean;
  /** Net votes. Denormalised on the post, so a thread render needs no aggregate. */
  score: number;
  /**
   * What THIS reader voted, or null.
   *
   * Sent per post rather than fetched separately: the arrows have to render in their correct state
   * on first paint, and a second request to find out would mean every post flickers from neutral
   * to voted on every page load.
   */
  myVote: 1 | -1 | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
  /** Server-decided: whether this caller may rewrite this post. Re-checked on write. */
  canEdit: boolean;
}

export interface ThreadGrant {
  userId: string;
  handle: string;
  displayName: string | null;
  grantedAt: string;
  grantedByHandle: string;
  reason: string | null;
}

/**
 * A category and its threads, as the signed-in caller sees them.
 *
 * `authed: true` forwards the session cookie, so the API resolves the real principal and the
 * ACL decides what comes back. Everything visibility-related is settled server-side — this
 * function has no idea which boards exist and must not.
 */
export const getHubThreads = (
  slug: string,
): Promise<{ category: HubCategory; threads: HubThread[] } | null> =>
  get(`/v1/forum/categories/${encodeURIComponent(slug)}/threads`, { authed: true });

export const getHubThread = (
  slug: string,
  threadSlug: string,
): Promise<{
  thread: HubThread;
  posts: HubPost[];
  /**
   * Keyed by author id, NOT attached per post — a thread with forty replies from twelve people
   * has twelve signatures, and repeating each one per post makes the response grow with the
   * conversation rather than with the number of people in it.
   */
  signatures: Record<string, SignatureView>;
  /**
   * What each author's banner text layers resolve to.
   *
   * Sent alongside the signatures rather than baked into them: a signature is a design, an identity
   * is a fact about a person, and freezing the second into the first is what would make a promotion
   * stop updating every banner its author has ever posted.
   */
  identities: Record<string, BannerIdentity>;
} | null> =>
  get(
    `/v1/forum/categories/${encodeURIComponent(slug)}/threads/${encodeURIComponent(threadSlug)}`,
    { authed: true },
  );

/**
 * Existing per-thread access grants.
 *
 * Returns null rather than throwing for a caller who may not manage access — the page then
 * simply does not render the panel, which is the correct outcome for somebody who should not
 * know the feature is there.
 */
export const getThreadGrants = (
  threadId: string,
): Promise<{ grants: ThreadGrant[] } | null> =>
  get(`/v1/forum/threads/${encodeURIComponent(threadId)}/grants`, { authed: true });

/* ------------------------------------------------- admin gating, with a REASON */

/**
 * Why an admin read was refused.
 *
 * ★ THE BUG THIS TYPE EXISTS TO KILL ★
 *
 * 2026-07-30, production: an officer with MEMBER_MANAGE but not ROLE_MANAGE opened
 * /app/roles and was shown the two-factor code box. They entered a valid code. It was
 * accepted — the API logged `POST /v1/auth/totp/verify 201` seven times — and the page
 * reloaded straight back to the code box. Forever.
 *
 * The cause was `get()` collapsing every failure into `null`, and the page reading:
 *
 *     // Null means the API refused — which for these routes is the two-factor gate
 *     if (roles === null) return <StepUp />;
 *
 * That comment was simply wrong. `null` also means "you do not hold ROLE_MANAGE" (the
 * route is @CloakAsNotFound, so it answers 404) and "the API is unreachable". Presenting a
 * PERMISSION problem as a 2FA problem creates a loop with no exit, and it made a working
 * authenticator look broken — which is exactly how it was reported.
 *
 * So the reason is now carried rather than discarded, and each one gets its own screen.
 */
export type AdminRead<T> =
  | { readonly state: 'ok'; readonly data: T }
  /** 403 TWO_FACTOR_REQUIRED — a code will fix this. Show the challenge. */
  | { readonly state: 'needs-step-up' }
  /** 403/404 on a permission — a code will NOT fix this. Never show a code box. */
  | { readonly state: 'forbidden' }
  /** 401 — the session is gone. */
  | { readonly state: 'signed-out' }
  /** Anything else, including the API being down. */
  | { readonly state: 'unavailable' };

/**
 * An authenticated GET that keeps the reason it failed.
 *
 * Deliberately separate from `get()` rather than changing it: `get()` returning null on
 * failure is right for the ~30 public and member pages that render an empty state, and
 * rewriting all of them to satisfy the admin console would be a large change with no
 * benefit to any of them.
 */
async function getAdmin<T>(path: string): Promise<AdminRead<T>> {
  try {
    const jar = await cookies();
    const cookieHeader = jar
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    const res = await fetch(`${SERVER_API}${path}`, {
      headers: {
        accept: 'application/json',
        ...(cookieHeader === '' ? {} : { cookie: cookieHeader }),
      },
      cache: 'no-store',
    });

    if (res.ok) return { state: 'ok', data: (await res.json()) as T };
    if (res.status === 401) return { state: 'signed-out' };

    /*
     * The API's own error code decides, not the status. A 403 is TWO_FACTOR_REQUIRED for
     * the step-up gate and PERMISSION_DENIED for a missing permission, and those need
     * opposite screens — so the body is read rather than guessed at from the number.
     */
    const code = await res
      .json()
      .then((b: unknown) => (b as { error?: { code?: string } })?.error?.code)
      .catch(() => undefined);

    if (code === 'TWO_FACTOR_REQUIRED') return { state: 'needs-step-up' };

    /*
     * RESOURCE_NOT_VISIBLE is the CLOAK (INV-024): the API refuses to confirm whether a
     * thing exists. That is right for a member-supplied id and it is not a reason to show
     * a code box here — the route is fixed and known to exist, so on the admin console the
     * only thing a 404 can mean is "not yours".
     *
     * The cloak is NOT weakened to fix this. The API still answers 404; the web layer just
     * stops mistaking it for a 2FA prompt.
     */
    if (code === 'PERMISSION_DENIED' || code === 'RESOURCE_NOT_VISIBLE' || res.status === 404) {
      return { state: 'forbidden' };
    }
    return { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}

export const getAdminRolesGated = (): Promise<AdminRead<{ roles: AdminRoleRow[] }>> =>
  getAdmin('/v1/admin/roles');

export const getAdminDashboardGated = (month?: string): Promise<AdminRead<AdminDashboard>> =>
  /*
   * `month` is `YYYY-MM`. Encoded even though it is validated server-side: a value that reaches a
   * URL unencoded is a value somebody will eventually put a slash in.
   */
  getAdmin(month === undefined ? '/v1/admin/dashboard' : `/v1/admin/dashboard?month=${encodeURIComponent(month)}`);

/**
 * What GMSD AI has learned, per source.
 *
 * Dates arrive as ISO strings over the wire — the shared `SourceStatus` types them as `Date`
 * because that is what the service produces, and pretending JSON preserved that would be a lie
 * the first time anything called a method on one.
 */
export interface TrainingSource {
  source: string;
  rows: number;
  /**
   * Rows with text that have not been embedded yet.
   *
   * Not an error. An ingest that has just written five thousand rows is SUPPOSED to leave them
   * waiting for the embedder; this going up after a run is the system working. What it answers is
   * "has the backlog stopped moving".
   */
  awaitingEmbedding: number;
  lastIngestedAt: string | null;
  ingesting: boolean;
  nextInHours: number | null;
  lastError: string | null;
  /** Started and then went quiet, as opposed to failing with a message. Never inferred from wording. */
  stalled: boolean;
  /** Only while something is running — what the live bar and countdown are computed from. */
  startedAt: string | null;
  rowsSoFar: number | null;
  expectedRows: number | null;
}

export const getAiTrainingGated = (): Promise<AdminRead<{ sources: TrainingSource[] }>> =>
  getAdmin('/v1/ai/training');

/** One screenshot a member has offered for training. */
export interface TrainingSubmission {
  id: string;
  uploadId: string;
  category: string;
  description: string;
  state: string;
  reviewNote: string | null;
  createdAt: string;
}

/**
 * Help Train the Bot.
 *
 * ★ CategoryProgress COMES FROM THE SHARED CONTRACT, NOT REDECLARED HERE ★
 *
 * The progress shape is a rule about training — how many images a concept needs before a LoRA
 * learns it rather than memorises it — and a second copy in the web layer is a second place for
 * those numbers to be wrong.
 */
export const getAiCorpusGated = (): Promise<
  AdminRead<{
    categories: import('@grims/shared').CategoryProgress[];
    mine: TrainingSubmission[];
    canSubmit: boolean;
  }>
> => getAdmin('/v1/ai/corpus');

export interface ForumSearchHit {
  postId: string;
  threadId: string;
  threadTitle: string;
  threadSlug: string;
  categorySlug: string;
  authorHandle: string;
  createdAt: string;
  snippet: string;
}

/**
 * Forum search (INV-024).
 *
 * `authed: true` forwards the session so the API resolves the real principal — the visible
 * categories are derived server-side from it and applied inside the SQL. This function has no idea
 * which boards exist and must not: a client that knew would be a second answer to the question the
 * invariant says has exactly one.
 */
export const getForumSearch = (
  query: string,
): Promise<{
  result: { hits: ForumSearchHit[]; total: number; query: string };
  snippets: string[];
} | null> =>
  get(`/v1/forum/search?q=${encodeURIComponent(query)}`, { authed: true });

/** The caller's follow state for one thread, for the Notify me button. */
export const getThreadSubscription = (
  threadId: string,
): Promise<{ level: 'watching' | 'muted' | 'none' } | null> =>
  get(`/v1/forum/threads/${encodeURIComponent(threadId)}/subscription`, { authed: true });

export interface DmPreferences {
  notifyDmDirectReply: boolean;
  notifyDmMention: boolean;
  notifyDmWatched: boolean;
}

/** Which Discord DMs this member has asked for. All default false — see the migration. */
export const getDmPreferences = (): Promise<DmPreferences | null> =>
  get('/v1/me/notifications', { authed: true });

/**
 * One conversation with GMSD AI, as the review screen lists them.
 *
 * ★ SQUADRON OWNER — NON-NEGOTIABLE ★
 *
 * "Every conversation logged for officer review ... it also need to be visible to the webmaster
 * role! this is non-negotiable as the webmaster is the AI developer."
 *
 * Collapsed to one row per thread rather than one per turn: a busy evening is hundreds of turns in
 * which consecutive lines belong to different people asking about different things, and that is not
 * something anybody reviews twice.
 */
export interface AiConversation {
  threadId: string;
  userId: string | null;
  displayName: string | null;
  turns: number;
  startedAt: string;
  lastAt: string;
  /** The first question asked — what the conversation is about. */
  opener: string;
  /** Turns that never reached the model: a rate limit, or nothing retrieved. */
  refusals: number;
}

export interface AiConversationTurn {
  prompt: string;
  response: string | null;
  refusedReason: string | null;
  tookMs: number | null;
  createdAt: string;
}

export const getAiConversationsGated = (): Promise<AdminRead<{ threads: AiConversation[] }>> =>
  getAdmin('/v1/ai/conversations');

export const getAiConversationGated = (
  threadId: string,
): Promise<AdminRead<{ turns: AiConversationTurn[] }>> =>
  getAdmin(`/v1/ai/conversations/${encodeURIComponent(threadId)}`);

/**
 * What the companion app is asking for, before a member approves it.
 *
 * Null when the code is wrong, already used, or expired — the three are deliberately
 * indistinguishable, because telling them apart only helps somebody working through codes.
 */
export const describeDeviceLink = (code: string): Promise<{ label: string } | null> =>
  get<{ label: string | null }>(`/v1/telemetry/links/${encodeURIComponent(code)}`).then((r) =>
    r === null || r.label === null ? null : { label: r.label },
  );

/**
 * What the squadron carries on foot.
 *
 * Aggregate only: how many members carry each weapon, never who. A per-member view would be a
 * different feature with a different privacy question.
 */
export interface WeaponsChart {
  weapons: Array<{ name: string; members: number; loadouts: number }>;
  suits: Array<{ name: string; members: number }>;
  /** Members who have reported any on-foot loadout. The denominator, and zero until some do. */
  members: number;
}

export const getSquadronWeapons = (): Promise<WeaponsChart | null> =>
  get('/v1/squadron/weapons', { authed: true });

/** A fitted ship the squadron holds. */
export interface ShipBuildView {
  id: string;
  shipId: string;
  shipName: string;
  buildName: string | null;
  /** `coriolis`, `edsy` or `journal` — see the note on BuildSource: not equally trusted. */
  source: string;
  sourceUrl: string;
  /** The squadron's reference build rather than a member's contribution. */
  isBaseline: boolean;
  /** Read out of a member's own journal rather than pasted. */
  fromJournal: boolean;
  submittedBy: string | null;
  submittedById: string | null;
  stats: {
    unladenMass?: number;
    ladenMass?: number;
    jumpRange?: number | null;
    ladenJumpRange?: number | null;
    powerDrawn?: number;
    powerGenerated?: number;
    powerDeficit?: boolean;
    cargoCapacity?: number;
    fuelCapacity?: number;
    armour?: number;
  } | null;
  fitted: number;
  slots: number;
  createdAt: string;
}

/**
 * The squadron's builds.
 *
 * Gated read, so a member without AI_TRAIN_SUBMIT gets the "no access" screen rather than a
 * two-factor code box — the confusion that cost an officer an evening on 2026-07-30.
 */
/** How far the build collection is from being worth training on, per role. */
export interface BuildRoleProgressView {
  role: string;
  label: string;
  have: number;
  need: number;
  ready: boolean;
}

export const getShipBuildsGated = (): Promise<
  AdminRead<{
    builds: ShipBuildView[];
    progress: BuildRoleProgressView[];
    canSubmit: boolean;
    canModerate: boolean;
  }>
> => getAdmin('/v1/ai/builds');

/** A hull in the Shipyard's picker. */
export interface ShipyardShipRow {
  id: string;
  name: string;
  hullCost: number;
  /** 1 small, 2 medium, 3 large. Decides where it can dock at all. */
  pad: number;
}

/**
 * Every hull, keeping the reason it failed.
 *
 * ★ GATED, NOT `get()` — AND THE REASON IS ON RECORD ★
 *
 * `get()` returns null for everything: 401, 403, a permission refusal and the API being down are
 * one value. That is what put an officer in a loop typing valid authenticator codes at a page that
 * was refusing them on a PERMISSION — see `no-access.tsx`, which exists because of it.
 *
 * `SHIPYARD_VIEW` is new, so this page can now refuse somebody, and it must refuse them with the
 * screen that names the permission rather than the one that asks for six digits.
 */
/** What this member wears, and whether they may choose it. */
export interface MyNicknameState {
  nickname: string | null;
  convention: string | null;
  override: string | null;
  source: string | null;
  mayOverride: boolean;
  unverified: boolean;
}

export const getMyNickname = (): Promise<MyNicknameState | null> =>
  get('/v1/me/nickname', { authed: true });

export const getShipyardShipsGated = (): Promise<AdminRead<{ ships: ShipyardShipRow[] }>> =>
  getAdmin('/v1/ai/shipyard/ships');

/**
 * One hull and every module that fits it.
 *
 * Typed loosely on purpose: the payload is coriolis's own module records, and the outfitter hands
 * them straight to `computeStats`, which is where their shape is actually known. Restating that
 * shape here would be a second definition free to drift from the one doing the arithmetic.
 */
/** One row on a build board. */
export interface SharedBuildRow {
  shipName: string;
  buildName: string | null;
  role: string | null;
  stats: Record<string, unknown> | null;
  visibility: 'private' | 'squadron' | 'public';
  shareToken: string;
  author: string | null;
  updatedAt: string;
}

/** A shared build, as its reader receives it. */
export interface SharedBuild {
  shipId: string;
  shipName: string;
  buildName: string | null;
  build: import('@grims/shared/ship-build').ShipBuild;
  stats: Record<string, unknown> | null;
  role: string | null;
  author: string | null;
  visibility: 'private' | 'squadron' | 'public';
  updatedAt: string;
}

/**
 * The squadron's or the world's published builds.
 *
 * Plain `get`, not the gated reader: both boards answer without a session — the owner asked for the
 * public page to be "visible ... to anyone not signed in" — so `null` here means the API is down
 * rather than that somebody was refused, and the page says exactly that.
 */
export const getSharedBuilds = (
  scope: 'squadron' | 'public',
): Promise<{ builds: SharedBuildRow[] } | null> =>
  get(`/v1/ai/shipyard/builds/shared?scope=${scope}`, { authed: true });

/** One shared build by its token. Null covers "no such build" and "not shared with you" alike. */
export const getSharedBuild = (token: string): Promise<SharedBuild | null> =>
  get(`/v1/ai/shipyard/builds/shared/${encodeURIComponent(token)}`, { authed: true });

/** The caller's own saved builds. */
export const getMyBuilds = (): Promise<{ builds: SavedBuildRow[] } | null> =>
  get('/v1/ai/shipyard/builds/mine', { authed: true });

export interface SavedBuildRow {
  id: string;
  shipName: string;
  buildName: string | null;
  role: string | null;
  stats: Record<string, unknown> | null;
  visibility: 'private' | 'squadron' | 'public';
  shareToken: string | null;
  updatedAt: string;
}

export const getShipyardOutfitGated = (
  shipId: string,
): Promise<AdminRead<import('../app/(hub)/shipyard/outfitter-catalogue').OutfitPayload>> =>
  getAdmin(`/v1/ai/shipyard/outfit/${encodeURIComponent(shipId)}`);

// ── Logistics & Trade ────────────────────────────────────────────────────────
//
// Squadron owner, 2026-08-02: "a realt time commodities market ... as well as the best places to
// buy both in general and based on the players current location and station they are at."
//
// Plain `get`, like the shared build boards above and for the same reason: these answer without a
// session, because the owner made them public. So `null` here means the API is down rather than
// that somebody was refused — and the page has to say the first thing, not the second.

/** One commodity as the market lists it. */
export interface MarketRow {
  commodity: string;
  category: string | null;
  avgBuy: number | null;
  avgSell: number | null;
  minBuy: number | null;
  maxSell: number | null;
  /** Tonnes, as a string: totals run into the billions and would lose precision as a JSON number. */
  supply: string;
  demand: string;
  buyMarkets: number;
  sellMarkets: number;
  /** Movement in the average sell price over a day, as a fraction. Null until we hold a day. */
  sellTrend: number | null;
}

/** One station trading one commodity. */
export interface MarketPlace {
  stationName: string;
  systemName: string;
  stationType: string | null;
  largePads: number;
  price: number;
  quantity: number;
  seenAt: string | null;
  distance: number | null;
}

export interface HistoryPoint {
  observedAt: string;
  avgBuy: number | null;
  avgSell: number | null;
  minBuy: number | null;
  maxSell: number | null;
  buyMarkets: number;
  sellMarkets: number;
}

export interface CommodityDetail {
  commodity: MarketRow | null;
  buys: MarketPlace[];
  sells: MarketPlace[];
  history: HistoryPoint[];
  origin: { system: string; station: string | null; from: 'typed' | 'journal' } | null;
  /** A system somebody typed that we cannot place — so no radius was applied. Never silent. */
  unknownSystem: string | null;
}

export const getCommodities = (): Promise<{ commodities: MarketRow[] } | null> =>
  get('/v1/logistics/commodities', { authed: true });

/** One commodity, with where to trade it. `query` carries the filters verbatim. */
export const getCommodity = (
  name: string,
  query: Record<string, string> = {},
): Promise<CommodityDetail | null> => {
  const qs = new URLSearchParams(query).toString();
  return get(
    `/v1/logistics/commodities/${encodeURIComponent(name)}${qs === '' ? '' : `?${qs}`}`,
    { authed: true },
  );
};

/** One leg of a planned run. */
export interface RouteLeg {
  stationName: string;
  systemName: string;
  stationType: string | null;
  largePads: number;
  price: number;
  quantity: number;
  seenAt: string | null;
  distance: number | null;
}

export interface Route {
  commodity: string;
  buy: RouteLeg;
  sell: RouteLeg;
  profitPerTonne: number;
  tonnes: number;
  totalProfit: number;
  outlay: number;
  distanceLy: number;
  /** What capped the load — shown, because a bare tonnage never explains itself. */
  limitedBy: 'hold' | 'supply' | 'demand' | 'budget';
}

export interface RoutePlan {
  routes: Route[];
  considered: string[];
  origin: { system: string; station: string | null; from: 'typed' | 'journal' } | null;
  unknownSystem: string | null;
}

/** The Freight Office. `query` carries the member's filters verbatim. */
export const getRoutes = (query: Record<string, string> = {}): Promise<RoutePlan | null> => {
  const qs = new URLSearchParams(query).toString();
  return get(`/v1/logistics/routes${qs === '' ? '' : `?${qs}`}`, { authed: true });
};

// ── Colonisation ─────────────────────────────────────────────────────────────
//
// Squadron owner, 2026-08-02: "allow our members to post their colonization project to the squadron
// for assistance etc ... keep our own full records too."
//
// `getAdmin` rather than plain `get`: these are members-only, so a refusal has to be distinguishable
// from the API being down. A signed-out visitor reaching /logistics/colonisation should be told to
// sign in, not shown "could not load".

export interface ColonyProject {
  id: string;
  owner: 'squadron' | 'personal';
  title: string;
  systemName: string;
  stationName: string | null;
  buildType: string | null;
  notes: string | null;
  visibility: 'private' | 'squadron' | 'public';
  shareToken: string | null;
  isPriority: boolean;
  /**
   * What the site actually is, worked out from what it asks for.
   *
   * Not the free-text `buildType` somebody typed — this is the catalogue row the requirement
   * fingerprints to. Null until somebody has docked there.
   */
  identified: {
    id: string;
    displayName: string;
    tier: number;
    padSize: string;
    location: string;
    totalTonnes: number;
  } | null;
  completedAt: string | null;
  postedBy: string | null;
  postedById: string;
  updatedAt: string;
  remaining: number;
  required: number;
  needCount: number;
}

export interface ColonyNeed {
  commodity: string;
  remaining: number;
  required: number | null;
  /** When the game last reported this. Null before anybody has docked at the site. */
  observedAt: string | null;
}

/** One delivery, straight off the append-only ledger. */
export interface ColonyDelivery {
  at: string;
  commander: string;
  commodity: string;
  amount: number;
}

export interface ColonyHauler {
  name: string;
  tonnes: number;
}

/** Where to buy what a project still needs — the Freight Office answering for each line. */
export interface ColonyShoppingRow {
  commodity: string;
  remaining: number;
  stationName: string | null;
  systemName: string | null;
  price: number | null;
  supply: number | null;
  distance: number | null;
  /**
   * When somebody last saw this price.
   *
   * Shown rather than filtered on. Half our market mirror is older than three months, and hiding
   * the stale rows would tell a member "nobody sells this" about commodities on a shelf right now.
   */
  seenAt: string | null;
  cost: number | null;
  /**
   * The nearest place selling this AT ALL, when nothing inside the radius does.
   *
   * "Nobody in range sells this" is true and useless on its own — it says the search failed and
   * nothing about what to do next.
   */
  nearestOutOfRange: {
    stationName: string;
    systemName: string;
    price: number;
    supply: number;
    distance: number | null;
    seenAt: string | null;
  } | null;
}

/**
 * One bar of the delivery chart.
 *
 * `bySeries` rather than `byCommodity`: the same bar is stacked by commodity in one view and by
 * commander in the other, and a field named for one of them while holding the other is a lie.
 */
export interface ColonyDeliveryBucket {
  at: string;
  bySeries: Record<string, number>;
  total: number;
}

/** One commander's column: everything they have hauled, split by commodity. */
export interface ColonyHaulerStack {
  commander: string;
  byCommodity: Record<string, number>;
  total: number;
}

/** Both charts on a project page, in one read. Switching between them costs no round trip. */
export interface ColonyCharts {
  bucket: 'hour' | 'day';
  byCommodity: ColonyDeliveryBucket[];
  byCommander: ColonyDeliveryBucket[];
  haulers: ColonyHaulerStack[];
}

export interface ColonyDetail {
  project: ColonyProject;
  needs: ColonyNeed[];
  haulers: ColonyHauler[];
  shopping: ColonyShoppingRow[];
  /*
   * ★ THE API HAS ALWAYS RETURNED THESE AND THIS TYPE DROPPED THEM ★
   *
   * Both controllers send `deliveries` — the literal ledger, newest first — and the website's own
   * type omitted the field, so "who delivered what and when" was visible in the companion app and
   * nowhere on the site. Nothing failed; the data simply arrived and was discarded.
   */
  deliveries: ColonyDelivery[];
  chart: ColonyCharts;
  /** What this reader may do to the project. A rendering hint — every write re-checks. */
  can: { manage: boolean; isPoster: boolean };
  origin: { system: string } | null;
  unknownSystem: string | null;
}

/** What the caller may do here. A rendering hint only — every write re-checks. */
export interface ColonyRights {
  post: boolean;
  manage: boolean;
  publish: boolean;
}

/** One kind of construction site, and what it costs to build. */
export interface ColonyBuildType {
  id: string;
  displayName: string;
  category: string;
  tier: number;
  location: 'orbital' | 'surface';
  padSize: 'none' | 'small' | 'medium' | 'large';
  totalTonnes: number;
  commodities: number;
  /**
   * Where the numbers came from.
   *
   * Frontier publishes none of this, so every figure is either community-gathered or a measurement
   * from one of our own builds — and somebody deciding whether to commit a fortnight of hauling to
   * a plan deserves to know which.
   */
  source: 'community' | 'observed';
  confirmations: number;
}

export interface ColonyBuildCostLine {
  commodity: string;
  tonnes: number;
  price: number | null;
  stationName: string | null;
  systemName: string | null;
  distance: number | null;
  cost: number | null;
}

export interface ColonyBuildTypeDetail extends ColonyBuildType {
  layouts: string[];
  costs: ColonyBuildCostLine[];
  total: number;
  unsourced: number;
}

/** One body in a system, with the slot counts somebody read off the in-game architect view. */
export interface PlanBody {
  bodyId: number;
  name: string;
  kind: string;
  subType: string | null;
  isLandable: boolean;
  gravity: number | null;
  temperature: number | null;
  distanceLs: number | null;
  hasRings: boolean;
  terraformable: boolean;
  hasVolcanism: boolean;
  hasAtmosphere: boolean;
  /** What this orbits, so a moon draws under its planet. Null for the primary star. */
  parentBodyId: number | null;
  orbitalSlots: number | null;
  surfaceSlots: number | null;
  slotsBy: string | null;
}

/** One intended build, in one slot, on one body. */
export interface PlanSite {
  id: string;
  bodyId: number | null;
  location: 'orbital' | 'surface';
  buildTypeId: string | null;
  buildTypeName: string | null;
  tier: number | null;
  totalTonnes: number | null;
  /** What this feeds into the port that receives it. `none` when it feeds nothing. */
  economyInfluence: string | null;
  position: number;
  /** The system's first station. The game charges nothing for it. */
  isPrimary: boolean;
  projectId: string | null;
}

/**
 * What the construction-point rules say about the plan.
 *
 * Computed on the SERVER, by the same module the companion's answer comes from. Two
 * implementations of a rule this fiddly would drift, and the half that drifted would be the one
 * deciding whether a fortnight of hauling is legal.
 */
export interface PlanSimStep {
  siteId: string;
  buildTypeId: string | null;
  spend: { tier: number; points: number } | null;
  /** How much of the spend is the surcharge on extra starports. Zero when untaxed. */
  surcharge: number;
  earn: { tier: number; points: number } | null;
  /** The balance AFTER this step. Negative means the plan cannot reach here. */
  tier2: number;
  tier3: number;
  isPrimary: boolean;
  problems: PlanProblem[];
}

export interface PlanProblem {
  kind: 'points' | 'prerequisite' | 'unchosen';
  message: string;
}

export interface PlanEffects {
  population: number;
  maxPopulation: number;
  security: number;
  technology: number;
  wealth: number;
  standardOfLiving: number;
  development: number;
}

/** One adjustment the economy model made, and why. */
export interface EconAudit {
  economy: string;
  delta: number;
  reason: string;
}

export interface SiteEconomy {
  siteId: string;
  buildTypeId: string | null;
  /** Only starports and outposts trade. Everything else FEEDS one. */
  receivesLinks: boolean;
  isReceiver: boolean;
  scores: Record<string, number>;
  leading: string | null;
  audit: EconAudit[];
  strongLinks: string[];
  weakLinks: string[];
}

export interface PlanEconomies {
  sites: SiteEconomy[];
  /** Inputs the game uses that we do not hold. Printed, never hidden. */
  blindSpots: string[];
}

export interface PlanSimulation {
  steps: PlanSimStep[];
  tier2: number;
  tier3: number;
  problems: PlanProblem[];
  effects: PlanEffects;
  surchargedPorts: number;
}

export interface ColonyPlan {
  id: string;
  owner: 'squadron' | 'personal';
  title: string;
  systemName: string;
  systemId64: string | null;
  notes: string | null;
  /** Optimistic concurrency. Every write carries the version it started from. */
  version: number;
  postedBy: string | null;
  postedById: string;
  updatedAt: string;
  bodies: PlanBody[];
  bodiesFetchedAt: string | null;
  sites: PlanSite[];
  simulation: PlanSimulation;
  economies: PlanEconomies;
}

export const getColonyPlans = (
  owner: 'squadron' | 'personal' | 'all' = 'all',
): Promise<AdminRead<{ plans: ColonyPlan[] }>> =>
  getAdmin(`/v1/logistics/colony/plans?owner=${owner}`);

export const getColonyPlan = (id: string): Promise<AdminRead<{ plan: ColonyPlan }>> =>
  getAdmin(`/v1/logistics/colony/plans/${encodeURIComponent(id)}`);

export const getBuildTypes = (): Promise<AdminRead<{ buildTypes: ColonyBuildType[] }>> =>
  getAdmin('/v1/logistics/colony/build-types');

export const getBuildType = (
  id: string,
  query: Record<string, string> = {},
): Promise<
  AdminRead<{
    buildType: ColonyBuildTypeDetail;
    origin: { system: string } | null;
    unknownSystem: string | null;
  }>
> => {
  const qs = new URLSearchParams(query).toString();
  return getAdmin(
    `/v1/logistics/colony/build-types/${encodeURIComponent(id)}${qs === '' ? '' : `?${qs}`}`,
  );
};

export const getColonyProjects = (
  owner: 'squadron' | 'personal' | 'all' = 'all',
): Promise<AdminRead<{ projects: ColonyProject[]; can: ColonyRights }>> =>
  getAdmin(`/v1/logistics/colony/projects?owner=${owner}`);

export const getColonyProject = (
  id: string,
  query: Record<string, string> = {},
): Promise<AdminRead<ColonyDetail>> => {
  const qs = new URLSearchParams(query).toString();
  return getAdmin(
    `/v1/logistics/colony/projects/${encodeURIComponent(id)}${qs === '' ? '' : `?${qs}`}`,
  );
};

/** A published project, by its token. No session: the token is the capability. */
export const getSharedColonyProject = (
  token: string,
): Promise<{ project: ColonyProject; needs: ColonyNeed[] } | null> =>
  get(`/v1/logistics/colony/shared/${encodeURIComponent(token)}`, { authed: true });
