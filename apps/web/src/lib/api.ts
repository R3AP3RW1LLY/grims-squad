import { cookies } from 'next/headers';

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
}

export interface AdminAuditRow {
  id: string;
  action: string;
  actorHandle: string | null;
  /** Discord server nickname, kept matching the member's in-game name. */
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
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
  discord: {
    messages: number;
    forumPosts: number;
    voiceJoins: number;
    activeMembers: number;
    trackedMembers: number;
    /** Messages per day of the month, index 0 = the 1st. */
    daily: number[];
    /** Distinct members active on each day, index 0 = the 1st. */
    dailyMembers: number[];
    top: Array<{ name: string; messages: number; voice: number; cmdrName: string | null }>;
  };
  game: {
    events: number;
    reporting: number;
    sessionsThisMonth: number;
    flyingThisMonth: number;
    playingNow: number;
    ships: Array<{ ship: string; pilots: number }>;
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

export const getAdminDashboard = (): Promise<AdminDashboard | null> =>
  get('/v1/admin/dashboard', { authed: true });

export const getAdminActivity = (
  month?: string,
): Promise<{ month: string; rows: AdminActivityRow[] } | null> =>
  get(`/v1/admin/activity${month === undefined ? '' : `?month=${encodeURIComponent(month)}`}`, {
    authed: true,
  });

export const getAdminAudit = (): Promise<{
  entries: AdminAuditRow[];
  actions: string[];
  total: number;
  page: number;
  pageSize: number;
} | null> => get('/v1/admin/audit?limit=100&page=1', { authed: true });

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
   * Always null today. The companion app strips Credits before sending, and
   * Inara does not report a balance — see the note on the server type.
   */
  credits: number | null;
  lastPlayedAt: string | null;
  squadronRank: number | null;
  /** The system they were last seen in. Null until something reports one. */
  currentSystem: string | null;
  systemSeenAt: string | null;
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
  section: 'squadron' | 'personal' | 'admin';
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
