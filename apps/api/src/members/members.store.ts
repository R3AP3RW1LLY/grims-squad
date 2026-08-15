import type { PrismaClient } from '@grims/db';
import { tokenState } from '@grims/ed-clients';
import type {
  PrivacySettings,
  ProfileSource,
  FrontierVerification,
} from './profile.serializer.js';
import {
  SNAPSHOT_EVENT_TYPES,
  type InaraRanks,
  type SnapshotEvent,
} from './commander-snapshot.js';
import { PROFILE_EVENT_TYPES, type ProfileEvent } from './commander-profile.service.js';

export interface MemberRow {
  readonly source: ProfileSource;
  readonly privacy: Partial<PrivacySettings> | null;
}

export interface MembersStore {
  byHandle(handle: string): Promise<MemberRow | null>;
  /** A member's handle from their id, or null. Used to make @mention links resolvable. */
  handleForId(userId: string): Promise<string | null>;
  roster(): Promise<MemberRow[]>;
  privacyOf(userId: string): Promise<Partial<PrivacySettings> | null>;
  savePrivacy(userId: string, patch: Partial<PrivacySettings>): Promise<PrivacySettings>;
  handleOf(userId: string): Promise<string | null>;
  /** Latest journal event of each interesting type, for the roster cards. */
  snapshotEvents(userIds: readonly string[]): Promise<SnapshotEvent[]>;
  inaraRanks(userIds: readonly string[]): Promise<Map<string, InaraRanks>>;
  /** Every event one member's own dashboard reads. */
  profileEvents(userId: string): Promise<ProfileEvent[]>;
  /** Every guild role we know the name and colour of, keyed by snowflake. */
  discordRoleCatalogue(): Promise<Map<string, DiscordRoleInfo>>;
  /** What this member has done in the squadron this calendar month. */
  activityThisMonth(userId: string, now?: Date): Promise<SquadronActivity | null>;
  /**
   * When Discord says they joined the guild, or null.
   *
   * ★ THE ONLY REAL SQUADRON TENURE SIGNAL ★
   *
   * `User.joinedAt` is when somebody created a WEBSITE account — a commander
   * who has flown here for years and signed in yesterday reads as one day.
   * Inara cannot answer it either: `getCommanderProfile` returns the squadron
   * name and the member's rank in it, and no join date anywhere.
   */
  guildJoinedAt(userId: string): Promise<Date | null>;
}

/**
 * One member's squadron activity for a calendar month.
 *
 * ★ JOINS, NOT MINUTES ★
 *
 * The field this replaces was called `voiceMinutes` and the profile page divided
 * it by sixty to render "hours in voice" — invented the moment anyone populated
 * it, because nothing recorded a minute of voice at the time.
 *
 * The bot DOES bank real minutes now (`member_activity_months.voice_minutes`,
 * settled when a session ends), and they are ADMIN CONSOLE ONLY by the owner's
 * decision. This member-facing shape deliberately does not carry them — do not
 * add the field back here.
 */
export interface SquadronActivity {
  readonly messages: number;
  readonly voiceJoins: number;
  readonly forumPosts: number;
  /**
   * A game session was observed this month.
   *
   * The single input the monthly promotion check reads (rank-progression.yaml),
   * which is why it is worth a member being able to see it on their own page.
   */
  readonly gameObserved: boolean;
}

/** One Discord role, as Discord defines it. */
export interface DiscordRoleInfo {
  readonly name: string;
  readonly colour: string | null;
  readonly position: number;
  readonly hoist: boolean;
  /** What the role MEANS to us. Discord has no such concept. */
  readonly category: 'rank' | 'membership' | 'award' | 'hidden' | 'other';
  /** Ladder position of the internal role this maps to, or null if it maps to none. */
  readonly rankOrder: number | null;
}

/**
 * Below this is a LEADERSHIP APPOINTMENT; at or above it is a TENURE RANK.
 *
 * ★ NOT A GUESS — THE LADDER SAYS SO ★
 *
 * The roles below 100 describe themselves as "Reserved" and "Leadership. Admin
 * area access". The roles from 100 up are earned by qualifying months: Cadet at
 * one, Grand Master General at twelve.
 *
 * So seniority-sounding names are misleading and must not be used. "Grand
 * Master General" is the TOP of the tenure ladder and confers no office; "Cadet"
 * is its floor. Somebody can be both a Cadet and a Squadron Leader, and only the
 * second makes them an officer.
 */
export const LEADERSHIP_CEILING = 100;

/**
 * Reads only what a profile needs.
 *
 * Every query names its columns. `select` rather than the whole row is not a
 * micro-optimisation here: it means a column added to User later — an address,
 * a phone number, an internal note — cannot reach the serializer at all, so
 * INV-027 does not quietly depend on someone remembering to exclude it.
 */
export class PrismaMembersStore implements MembersStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  static readonly #SELECT = {
    id: true,
    handle: true,
    displayName: true,
    avatarUrl: true,
    avatarStoredHash: true,
    bio: true,
    timezone: true,
    lastPlayingAt: true,
    joinedAt: true,
    status: true,
    privacySettings: {
      select: {
        showLocation: true,
        showCredits: true,
        showFleet: true,
        showActivity: true,
        showOnPublicRoster: true,
        showOnLeaderboard: true,
      },
    },
    /*
     * ★ `isVerified: true` IS LOAD-BEARING, NOT BELT-AND-BRACES ★
     *
     * This filtered on `revokedAt: null` alone, which let an UNPROVEN claim
     * supply the commander name the roster prints.
     *
     * It was not merely cosmetic. `createPending` stores the claimed name with
     * `verifiedAt` set to NOW, and this orders by `verifiedAt desc` — so a
     * claim opened seconds ago sorted ABOVE a genuinely verified row and
     * replaced it. And INV-005's uniqueness lock deliberately applies only to
     * `isVerified = true`, so a pending claim may name a commander somebody
     * else has already proven.
     *
     * Together: anybody could type another member's verified CMDR name into
     * the claim form and have the roster attribute it to them, with no
     * verification step and nothing revoked. The name is an identity here, so
     * only a proven one may appear.
     */
    cmdrVerifications: {
      where: { revokedAt: null, isVerified: true },
      /*
       * The squadron fields ride along because the card states whether Inara
       * confirms BOTH the name and the squadron. Read from the same row as the
       * name, so the two can never describe different verifications.
       */
      select: { cmdrName: true, squadronVerifiedAt: true, inaraSquadron: true },
      orderBy: { verifiedAt: 'desc' as const },
      take: 1,
    },
    discordIdentity: { select: { guildRoles: true } },
    userRoles: {
      select: {
        role: {
          select: {
            /*
             * The KEY, as well as the name. A name is what somebody reads and
             * an admin may retype; a key is the stable identifier, and it is
             * the only thing founding standing may be recognised by — see
             * `founding.ts`. Recognising "Founder" by its name would break the
             * Founders tab the first time the owner edited the label.
             */
            key: true,
            name: true,
            colour: true,
            rankOrder: true,
            isHierarchical: true,
            permMask: true,
          },
        },
      },
      // Highest first, so a card showing only the top one shows the top one.
      orderBy: { role: { rankOrder: 'desc' as const } },
    },
  };

  /**
   * What Frontier says about each of these members, right now.
   *
   * ★ THE PREDICATE, AND EVERY CLAUSE IN IT ★
   *
   *   method: 'fdev_capi'   Only Frontier's own answer counts. An Inara claim or
   *                         an officer's manual grant is a different badge with
   *                         a different meaning and a lower trust tier.
   *   revokedAt: null       A superseded claim is KEPT as the record that
   *                         somebody claimed it in good faith. It must never
   *                         vouch for anybody afterwards.
   *   cmdrName: { not: '' } The row is created the moment a member authorises,
   *                         with an EMPTY name, and the name arrives from a
   *                         separate profile call. Holding somebody's tokens is
   *                         not knowing who they are — linked-but-unidentified
   *                         is not verified.
   *   isStale === false     Applied below rather than in SQL, because the column
   *                         alone is not the whole truth. See the ceiling note.
   *
   * ★ WHY THIS IS A SECOND QUERY AND NOT PART OF `#SELECT` ★
   *
   * Two reasons, either sufficient.
   *
   * First, `#SELECT` filters `cmdrVerifications` on `isVerified: true`, which is
   * load-bearing there and pinned by a test — and NO cAPI ROW EVER SATISFIES IT.
   * `CapiService` creates its row with the column at its default of false and
   * only ever writes `cmdrName` afterwards; every writer of `isVerified: true`
   * in the tree is on the Inara or officer-manual path. Reading the badge off
   * that relation would have produced a badge that is dark for the entire
   * squadron with nothing to explain why.
   *
   * Second, that relation takes ONE row ordered by `verifiedAt desc`. A member
   * can hold an Inara row and a Frontier row at once, so whichever was touched
   * last would decide both badges — linking Frontier would put out the Inara
   * badge, and an Inara re-check would put out this one. Two independent claims
   * need two independent reads.
   *
   * Prisma cannot select the same relation twice under two filters, so a second
   * query it is: one indexed read (`@@index([userId])`) for the whole page,
   * never one per member.
   *
   * ★ THE CEILING IS READ FROM THE CLOCK, NOT ONLY FROM THE COLUMN ★
   *
   * `isStale` is written LAZILY — by whoever next tries to spend the token. A
   * member nothing has polled (worker down, 30-minute idle cadence, never plays)
   * sails past Frontier's hard 25-day ceiling with the column still false, and
   * trusting it alone would keep a badge lit days after its proof expired.
   *
   * So `tokenState` decides as well, which is the SAME function the token
   * refresher and the connection banner already use. This is deliberately not a
   * second opinion about when 25 days is up: there is one definition of that
   * ceiling and it lives in `@grims/ed-clients`.
   */
  async #frontier(
    userIds: readonly string[],
    now: Date,
  ): Promise<Map<string, FrontierVerification>> {
    const states = new Map<string, FrontierVerification>();
    if (userIds.length === 0) return states;

    const rows = await this.#db.cmdrVerification.findMany({
      where: {
        userId: { in: [...userIds] },
        method: 'fdev_capi',
        revokedAt: null,
        cmdrName: { not: '' },
      },
      select: { userId: true, isStale: true, verifiedAt: true },
      /*
       * ASCENDING, so the last row written into the map for a member is their
       * NEWEST grant. `CapiService` maintains one live row per member, but
       * nothing in the schema enforces it and a raced double-authorisation would
       * leave two — at which point an abandoned grant from three weeks ago must
       * not black out a link made this morning. Same rule as the Inara relation,
       * which orders `verifiedAt desc` and takes one.
       */
      orderBy: { verifiedAt: 'asc' },
    });

    for (const row of rows) {
      states.set(
        row.userId,
        row.isStale || tokenState(row.verifiedAt, now).stale ? 'expired' : 'verified',
      );
    }

    return states;
  }

  #toRow(
    u: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    avatarStoredHash: string | null;
    bio: string | null;
    timezone: string;
    lastPlayingAt: Date | null;
    joinedAt: Date;
    status: string;
    privacySettings: Partial<PrivacySettings> | null;
    cmdrVerifications: Array<{
      cmdrName: string;
      squadronVerifiedAt: Date | null;
      inaraSquadron: string | null;
    }>;
    discordIdentity: { guildRoles: string[] } | null;
    userRoles: Array<{
      role: {
        key: string;
        name: string;
        colour: string | null;
        rankOrder: number;
        isHierarchical: boolean;
        permMask: unknown;
      };
    }>;
    },
    /*
     * Passed in rather than derived here, because it comes from a different
     * query — see `#frontier`. Required rather than defaulted, so a future
     * caller that assembles a row cannot forget it and silently publish `none`
     * for a squadron that is verified.
     */
    frontier: FrontierVerification,
  ): MemberRow {
    return {
      source: {
        id: u.id,
        handle: u.handle,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        avatarStoredHash: u.avatarStoredHash,
        bio: u.bio,
        timezone: u.timezone,
        lastPlayingAt: u.lastPlayingAt,
        joinedAt: u.joinedAt,
        status: u.status,
        ranks: u.userRoles.map((r) => ({ name: r.role.name, colour: r.role.colour })),
        // Snowflakes only. Names and colours are resolved separately, from the
        // cached guild roles — see `discordRoleCatalogue`.
        guildRoleIds: u.discordIdentity?.guildRoles ?? [],
        /*
         * ★ SITE ROLES ARE NOT SQUADRON RANKS ★
         *
         * `webmaster` is a platform role: it grants every permission and confers
         * no standing in the squadron whatsoever. Shown as a title beside the
         * commander name, never as a rank and never as an officer.
         *
         * ★ THE KEY AND THE rank_order TRAVEL WITH THEM, AND STOP AT THE API ★
         *
         * Founding standing is one of these roles (`founder`, `co_founder`,
         * `roster_pin`), and deriving it needs the key to recognise the role
         * and the rank_order to know where the holder is pinned on the roster.
         * Both are stripped in the controller before the response is built —
         * the browser gets the name and the colour it always did.
         */
        siteRoles: u.userRoles
          .filter((r) => !r.role.isHierarchical)
          .map((r) => ({
            key: r.role.key,
            name: r.role.name,
            colour: r.role.colour,
            rankOrder: r.role.rankOrder,
          })),
        cmdrName: u.cmdrVerifications[0]?.cmdrName ?? null,
        /*
         * ★ BOTH HALVES, OR IT IS NOT VERIFIED ★
         *
         * A proven commander name says somebody controls that account. It says
         * nothing about whether they fly with US — which is the question a
         * squadron roster is actually asking. Inara confirming the squadron is
         * the second, separate check, and only the two together earn the badge.
         *
         * A row exists here only when `isVerified` is true, so the name is
         * already proven by the time this is read; the squadron timestamp is
         * what remains to decide.
         */
        squadronVerified: u.cmdrVerifications[0]?.squadronVerifiedAt != null,
        /*
         * ★ A DIFFERENT CLAIM, DELIBERATELY BESIDE THE ONE ABOVE ★
         *
         * Inara's badge asserts a name AND a squadron. Frontier's asserts the
         * NAME only — proven against Frontier itself, which is the strongest
         * identity check on the platform and still says nothing about who
         * somebody flies with. Squadron verification via cAPI is out of scope
         * and no copy on this journey may imply it.
         *
         * Kept adjacent so the next person to touch either one can see that
         * they are two answers to two questions, not one fact stored twice.
         */
        frontierVerification: frontier,
        // location, credits and fleet arrive with cAPI (P1.8, blocked on
        // Frontier). Absent here means absent from the response, which is the
        // correct behaviour rather than a placeholder to fill in.
      },
      privacy: u.privacySettings,
    };
  }

  async byHandle(handle: string): Promise<MemberRow | null> {
    const u = await this.#db.user.findFirst({
      where: { handle, status: { not: 'banned' } },
      select: PrismaMembersStore.#SELECT,
    });
    if (u === null) return null;

    /*
     * The profile page reads through here, and it must give the same answer as
     * the card that linked to it. A page that showed a Frontier badge the roster
     * did not is the kind of contradiction nobody reports and everybody notices
     * — so the SAME predicate answers both, from the same function.
     */
    const frontier = await this.#frontier([u.id], new Date());
    return this.#toRow(u as never, frontier.get(u.id) ?? 'none');
  }

  /**
   * The handle behind a user id.
   *
   * Deliberately narrow — one column, no profile assembly. The only caller is the mention
   * redirect, which needs a handle to build a URL and nothing else; returning a full profile row
   * would make an internal redirect cost the same as rendering a profile.
   *
   * Banned accounts are excluded, matching `byHandle`: a mention of somebody since removed is a
   * dead link rather than a route into their page.
   */
  async handleForId(userId: string): Promise<string | null> {
    const u = await this.#db.user.findFirst({
      where: { id: userId, status: { not: 'banned' } },
      select: { handle: true },
    });
    return u?.handle ?? null;
  }

  /**
   * This calendar month's activity for one member.
   *
   * ★ THE CURRENT MONTH ONLY, AND IN UTC ★
   *
   * Promotions are defined in UTC and counted per calendar month, so the window
   * has to be built the same way. Using the server's local month would put a
   * host in a negative offset a day out at the start of every month, and the
   * figure a member reads would disagree with the one the promotion job used.
   */
  async activityThisMonth(userId: string, now: Date = new Date()): Promise<SquadronActivity | null> {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const row = await this.#db.memberActivityMonth.findFirst({
      where: { userId, month },
      select: {
        messageCount: true,
        voiceJoinCount: true,
        forumPostCount: true,
        gameActivity: true,
      },
    });

    // No row means no activity recorded, which is a real answer — zero — rather
    // than "we do not know". The month row is created on first activity.
    if (row === null) return null;

    return {
      messages: row.messageCount,
      voiceJoins: row.voiceJoinCount,
      forumPosts: row.forumPostCount,
      /*
       * `observed` only. The enum also carries `unknown` and `none`, and
       * treating anything-but-none as observed would report a member the check
       * has not run for as having qualified.
       */
      gameObserved: row.gameActivity === 'observed',
    };
  }

  async guildJoinedAt(userId: string): Promise<Date | null> {
    /*
     * ★ IT WAS ALREADY HERE ★
     *
     * Written at every sign-in by the Discord service and documented as the
     * sole input to tenure rank (INV-047). I very nearly added a second
     * `joined_at` to `discord_guild_members` before finding it — which would
     * have been the same fact in two tables, free to disagree, with nothing
     * saying which one won.
     *
     * ★ AND ON 2026-08-01 IT WAS ADDED ANYWAY, ON PURPOSE ★
     *
     * The warning above is right in general and wrong about this case. This
     * table is keyed on a WEBSITE ACCOUNT, so it only has a row once somebody
     * has signed in: 117 guild members, one identity row. The admin activity
     * roster needs a tenure for all 117.
     *
     * They are not the same fact in two tables. They are the same fact about two
     * different sets of people, and `discord_guild_members.joined_at` is the
     * larger set — refreshed on every bot start rather than snapshotted once at
     * sign-in, and therefore the one that wins where both exist.
     *
     * This read is left alone deliberately. Rank must keep working with no bot
     * running, and for anybody who has not left and rejoined since signing in
     * the two values are identical.
     */
    const identity = await this.#db.discordIdentity.findUnique({
      where: { userId },
      select: { guildJoinedAt: true },
    });

    return identity?.guildJoinedAt ?? null;
  }

  async roster(): Promise<MemberRow[]> {
    const rows = await this.#db.user.findMany({
      where: { status: 'active' },
      select: PrismaMembersStore.#SELECT,
      orderBy: { joinedAt: 'asc' },
    });

    /*
     * ONE query for the whole roster's Frontier state, not one per member — the
     * same rule as the journal snapshots and the Discord role catalogue above.
     * It cannot run in parallel with the query above because it is scoped to the
     * ids that one returns, and scoping it is what keeps a deactivated member's
     * row out of the read entirely.
     *
     * ★ ONE CLOCK FOR THE WHOLE PAGE ★
     *
     * `new Date()` is taken ONCE and passed down. Calling it per row would let
     * two members' badges be decided by two different instants, which on a
     * hundred-card page is a real chance of the same member reading differently
     * from one refresh to the next at exactly the moment their grant expires.
     */
    const frontier = await this.#frontier(
      rows.map((u) => u.id),
      new Date(),
    );

    return rows.map((u) => this.#toRow(u as never, frontier.get(u.id) ?? 'none'));
  }

  /**
   * The latest journal event of each interesting type, per member.
   *
   * ★ NARROWED IN SQL, NOT IN MEMORY ★
   *
   * `distinct` on (userId, eventType) with a descending sort becomes DISTINCT ON
   * in Postgres, so the database returns one row per pair rather than every
   * event ever ingested. At a hundred members with months of history that is the
   * difference between six rows and tens of thousands.
   */
  async snapshotEvents(userIds: readonly string[]): Promise<SnapshotEvent[]> {
    if (userIds.length === 0) return [];

    return this.#db.telemetryEvent.findMany({
      where: { userId: { in: [...userIds] }, eventType: { in: [...SNAPSHOT_EVENT_TYPES] } },
      select: { userId: true, eventType: true, occurredAt: true, payload: true },
      orderBy: [{ userId: 'asc' }, { eventType: 'asc' }, { occurredAt: 'desc' }],
      distinct: ['userId', 'eventType'],
    });
  }

  /**
   * The latest of each event type this member's dashboard reads.
   *
   * ★ ONE MEMBER, NOT THE ROSTER ★
   *
   * `snapshotEvents` narrows across many users for the roster's cards. This is
   * the same shape for exactly one, and it reads MORE types — a card does not
   * show a hangar and a dashboard does.
   */
  async profileEvents(userId: string): Promise<ProfileEvent[]> {
    return this.#db.telemetryEvent.findMany({
      where: { userId, eventType: { in: [...PROFILE_EVENT_TYPES] } },
      select: { eventType: true, occurredAt: true, payload: true },
      orderBy: [{ eventType: 'asc' }, { occurredAt: 'desc' }],
      distinct: ['eventType'],
    });
  }

  /**
   * Inara's cached ranks for these members.
   *
   * ★ READS THE CACHE. NEVER CALLS INARA ★
   *
   * ADR-004 forbids Inara on a request path, and this is a request path. A
   * member with no row simply has no Inara ranks and falls back to the journal;
   * nothing here can be slowed down, rate-limited or broken by Inara's
   * availability. The worker's twenty-minute sweep is the only writer.
   */
  async inaraRanks(userIds: readonly string[]): Promise<Map<string, InaraRanks>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.#db.inaraCommanderProfile.findMany({
      where: { userId: { in: [...userIds] }, isFound: true },
      select: { userId: true, ranks: true, fetchedAt: true },
    });

    return new Map(
      rows.map((r) => [
        r.userId,
        {
          // Stored already resolved onto our ladders. Cast rather than
          // re-derived: re-deriving would mean this endpoint knowing Inara's
          // wording, which is exactly what storing it resolved avoids.
          ranks: Array.isArray(r.ranks) ? (r.ranks as InaraRanks['ranks']) : [],
          fetchedAt: r.fetchedAt,
        },
      ]),
    );
  }

  /**
   * The guild's roles, by snowflake.
   *
   * ★ ONE QUERY FOR THE WHOLE PAGE ★
   *
   * A guild has a few dozen roles and a roster has a hundred members, so
   * fetching the catalogue ONCE and resolving in memory is a single small read
   * — whereas joining per member would multiply it by the roster.
   *
   * Roles Discord has since deleted simply are not in the map, and a member
   * still carrying one shows nothing for it rather than an id.
   */
  async discordRoleCatalogue(): Promise<Map<string, DiscordRoleInfo>> {
    const [rows, mappings] = await Promise.all([
      this.#db.discordRole.findMany({
        select: {
          discordRoleId: true,
          name: true,
          colour: true,
          position: true,
          hoist: true,
          category: true,
        },
      }),
      /*
       * The ladder position of each mapped role, which is what separates a
       * LEADERSHIP APPOINTMENT from a tenure rank — see LEADERSHIP_CEILING.
       *
       * Read from the mapping rather than from a member's granted roles, so it
       * reflects what they hold in Discord TODAY rather than what the nightly
       * reconciliation has got round to writing.
       */
      this.#db.roleMapping.findMany({
        where: { role: { isHierarchical: true } },
        select: { discordRoleId: true, role: { select: { rankOrder: true } } },
      }),
    ]);

    const rankOrders = new Map(mappings.map((m) => [m.discordRoleId, m.role.rankOrder]));

    return new Map(
      rows.map((r) => [
        r.discordRoleId,
        {
          name: r.name,
          colour: r.colour,
          position: r.position,
          hoist: r.hoist,
          category: r.category,
          rankOrder: rankOrders.get(r.discordRoleId) ?? null,
        },
      ]),
    );
  }

  async privacyOf(userId: string): Promise<Partial<PrivacySettings> | null> {
    return (await this.#db.privacySetting.findUnique({
      where: { userId },
      select: {
        showLocation: true,
        showCredits: true,
        showFleet: true,
        showActivity: true,
        showOnPublicRoster: true,
        showOnLeaderboard: true,
        showLbBounties: true,
        showLbColony: true,
        showLbTrade: true,
        showLbMining: true,
        showLbBgs: true,
        showLbRecruit: true,
        plainFonts: true,
      },
    })) as Partial<PrivacySettings> | null;
  }

  async savePrivacy(userId: string, patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    // Upsert because the row is created lazily — a member who has never opened
    // settings has none, and their first change must not 404.
    const saved = await this.#db.privacySetting.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
      select: {
        showLocation: true,
        showCredits: true,
        showFleet: true,
        showActivity: true,
        showOnPublicRoster: true,
        showOnLeaderboard: true,
        showLbBounties: true,
        showLbColony: true,
        showLbTrade: true,
        showLbMining: true,
        showLbBgs: true,
        showLbRecruit: true,
        plainFonts: true,
      },
    });
    return saved as PrivacySettings;
  }

  async handleOf(userId: string): Promise<string | null> {
    const u = await this.#db.user.findUnique({ where: { id: userId }, select: { handle: true } });
    return u?.handle ?? null;
  }
}
