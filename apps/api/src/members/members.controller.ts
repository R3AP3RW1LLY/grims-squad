import { Controller, Get, Patch, Param, Body, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { MEMBERS_STORE, type MembersStore } from './members.tokens.js';
import { LEADERSHIP_CEILING } from './members.store.js';
import {
  buildSnapshots,
  withInaraRanks,
  fillLadders,
  EMPTY_SNAPSHOT,
  type CommanderSnapshot,
} from './commander-snapshot.js';
import {
  buildCommanderProfile,
  type CommanderProfile,
} from './commander-profile.service.js';
import {
  serializeProfile,
  resolvePrivacy,
  visibleOnRoster,
  DEFAULT_PRIVACY,
  type PrivacySettings,
  type PublicProfile,
} from './profile.serializer.js';

const TOGGLES = Object.keys(DEFAULT_PRIVACY) as Array<keyof PrivacySettings>;

/**
 * Reads a privacy patch out of an untrusted body.
 *
 * Only the six known toggles are read, and only when the value is a real
 * boolean. A string "false" is rejected rather than coerced: it arrives from a
 * form that forgot to parse its own checkbox, and coercing it would silently
 * turn a member's OFF into an ON — the exact direction INV-027 cares about.
 */
function readPatch(body: unknown): Partial<PrivacySettings> {
  if (typeof body !== 'object' || body === null) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Expected an object of privacy toggles.');
  }
  const src = body as Record<string, unknown>;
  const patch: Record<string, boolean> = {};
  for (const key of TOGGLES) {
    const v = src[key];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${key} must be true or false.`);
    }
    patch[key] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'No recognised privacy toggle in the body.');
  }
  return patch as Partial<PrivacySettings>;
}

@Controller('v1')
export class MembersController {
  constructor(@Inject(MEMBERS_STORE) private readonly store: MembersStore) {}

  /**
   * The squadron roster.
   *
   * ★ NO LONGER @Public, AS OF 2026-07-28 ★
   *
   * Moved behind the sign-in on the squadron owner's instruction. Gating the
   * PAGE alone would have been theatre — the data was one curl away, and an
   * endpoint that answers anybody is public however the interface is arranged.
   *
   * ★ EVERY ACTIVE MEMBER APPEARS ★
   *
   * Presence is no longer opt-in. This is the squadron's own directory — the
   * answer to "who is in this squadron" — and one most of the squadron is
   * missing from does not answer it.
   *
   * ★ FIELD-LEVEL PRIVACY IS UNTOUCHED ★
   *
   * Location, credits, fleet and activity are still opt-in and still default to
   * off, and are OMITTED rather than blanked for anybody who has not turned
   * them on (INV-027). A member who shares nothing appears as a name and a
   * rank, which is what being on a team roster means.
   */
  /**
   * The signed-in member's own commander dashboard.
   *
   * ★ THEIR OWN DATA, SO NO PRIVACY FILTER ★
   *
   * The toggles govern what OTHER people see. A member looking at their own
   * dashboard is not an audience, and hiding somebody's fleet from them because
   * they chose not to publish it would misread what the toggle is for.
   *
   * Scoped to the SESSION user. There is no id parameter and there must never
   * be one — that is the whole difference between "my dashboard" and an
   * endpoint that reads anybody's.
   */
  @Get('me/commander')
  async myCommander(@User() caller: CurrentUser | undefined): Promise<CommanderProfile> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to see your commander.');
    }

    const [events, inara, handle] = await Promise.all([
      this.store.profileEvents(caller.userId),
      this.store.inaraRanks([caller.userId]),
      this.store.handleOf(caller.userId),
    ]);

    // The verified name comes from the member row. Two reads rather than one
    // join, because `byHandle` is the only lookup that resolves verifications
    // and it is keyed on the handle.
    const row = handle === null ? null : await this.store.byHandle(handle);

    const cached = inara.get(caller.userId);
    return buildCommanderProfile(
      events,
      row?.source.cmdrName ?? null,
      cached === undefined ? null : { ranks: [...cached.ranks], fetchedAt: cached.fetchedAt },
    );
  }

  @Get('members')
  async roster(): Promise<{
    members: Array<
      PublicProfile & {
        commander: CommanderSnapshot;
        discordRoles: Array<{
          name: string;
          colour: string | null;
          category: 'rank' | 'membership' | 'award';
        }>;
        isOfficer: boolean;
        siteRoles: ReadonlyArray<{ name: string; colour: string | null }>;
      }
    >;
    total: number;
  }> {
    const rows = await this.store.roster();
    const visible = visibleOnRoster(rows);

    /*
     * ONE query for everybody's journal state, not one per member. At a hundred
     * members the per-member version is a hundred round trips to render a page
     * — the classic N+1, and the classic place to introduce it.
     */
    const ids = visible.map((r) => r.source.id);
    const [snapshots, inara, catalogue] = await Promise.all([
      this.store.snapshotEvents(ids).then((events) => buildSnapshots(events)),
      /*
       * Inara's ranks, from the CACHE the worker fills every twenty minutes.
       * Never a call to Inara — ADR-004 forbids it on a request path, and a
       * roster that could be slowed by a third party is one that will be.
       */
      this.store.inaraRanks(ids),
      /*
       * The guild's role names and colours, fetched ONCE. A few dozen rows for
       * the whole page rather than a join multiplied by the roster.
       */
      this.store.discordRoleCatalogue(),
    ]);

    return {
      members: visible.map((r) => ({
        ...serializeProfile(r.source, r.privacy, { audience: 'public' }),
        /*
         * Ranks, squadron rank and last-played come from the BASELINE
         * categories every member running the app supplies, and the audience
         * here is other members — which is what "who do I fly with" means.
         *
         * Ships are deliberately NOT in this object. They are governed by
         * `showFleet` and stay governed by it; this must never become a way
         * around a toggle somebody set.
         */
        /*
          Inara first, journal as the fallback, THEN expand to all six ladders.
          In that order: filling before the merge would make Inara's "I have
          nothing" indistinguishable from six real readings.
        */
        commander: fillLadders(
          withInaraRanks(snapshots.get(r.source.id) ?? EMPTY_SNAPSHOT, inara.get(r.source.id)),
        ),
        /*
         * ★ WHAT THEY ACTUALLY WEAR IN DISCORD ★
         *
         * Not our permission roles — those are `ranks`, and most Discord roles
         * never map to one. Colour roles, division roles, ping roles: a member
         * wearing them is wearing them, and a roster that showed only the ones
         * our permission system cares about would show a fraction of somebody's
         * actual standing in the server.
         *
         * Ordered by Discord POSITION, highest first, which is the order
         * Discord itself displays them in. Matching that is why somebody can
         * glance between the two and recognise the same person.
         *
         * A role Discord has since deleted is absent from the catalogue and is
         * dropped rather than rendered as a snowflake.
         */
        discordRoles: (r.source.guildRoleIds ?? [])
          .map((id) => catalogue.get(id))
          .filter((role): role is NonNullable<typeof role> => role !== undefined)
          /*
           * `hidden` and `other` never leave the API.
           *
           * Filtered HERE rather than in the browser: a card that received
           * eleven roles and rendered three would still have sent eleven, and
           * "which channels can this member see" is not the roster's business
           * to publish even to other members.
           */
          .filter(
            (role): role is typeof role & { category: 'rank' | 'membership' | 'award' } =>
              role.category === 'rank' ||
              role.category === 'membership' ||
              role.category === 'award',
          )
          .sort((a, b) => b.position - a.position)
          .map(({ name, colour, category }) => ({ name, colour, category })),
        /*
         * ★ OFFICER IS A SQUADRON RANK, NOT A WEBSITE PERMISSION ★
         *
         * This used to read the permission mask, which made the webmaster an
         * officer — someone who holds every permission on the platform and no
         * standing in the squadron at all. Corrected on the squadron owner's
         * instruction: rank decides.
         *
         * A leadership APPOINTMENT (rankOrder below 100) makes an officer. The
         * tenure ladder from Cadet up does not, however senior it sounds —
         * "Grand Master General" is twelve qualifying months, not an office.
         */
        isOfficer: (r.source.guildRoleIds ?? []).some((id) => {
          const order = catalogue.get(id)?.rankOrder;
          return order !== null && order !== undefined && order < LEADERSHIP_CEILING;
        }),
        siteRoles: r.source.siteRoles ?? [],
      })),
      // The COUNT of active members is not private — it is the squadron's size,
      // which is public on Inara anyway. Who they are is the private part.
      total: rows.length,
    };
  }

  /**
   * One member's profile.
   *
   * Behind the sign-in with the roster it is reached from. A profile that
   * answered anonymously while the list of profiles did not would leave the
   * whole thing enumerable by anybody who could guess a handle.
   *
   * `audience: 'self'` only when the caller IS this member. There is no officer
   * branch and there must not be one: INV-027 is a promise to the member, not a
   * permission level — and being signed in is not the same as being them.
   */
  /**
   * Resolves a member id to their handle.
   *
   * ★ WHY THIS EXISTS ★
   *
   * A @mention stores a user ID, deliberately: resolving the name once, when the author picks
   * somebody, is what makes a mention survive a rename. But the profile route keys on HANDLE, so
   * a mention has to be turned back into one somewhere. Doing it at RENDER time would mean a
   * roster lookup per mention per page view, which is the cost the id was meant to avoid.
   *
   * Doing it here means it costs a request only when somebody actually clicks a mention.
   *
   * ★ AUTHENTICATED, AND 404 WHEN ABSENT ★
   *
   * Same reasoning as the profile route below: answering this anonymously would make the id space
   * enumerable. A missing or inactive account is a 404 rather than a distinct answer.
   */
  @Get('members/id/:userId')
  async handleFor(
    @Param('userId') userId: string,
    @User() caller: CurrentUser | undefined,
  ): Promise<{ handle: string }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const handle = await this.store.handleForId(userId);
    if (handle === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Member not found.');
    }
    return { handle };
  }

  @Get('members/:handle')
  async profile(
    @Param('handle') handle: string,
    @User() caller: CurrentUser | undefined,
  ): Promise<
    PublicProfile & {
      commander: CommanderSnapshot;
      discordRoles: Array<{
        name: string;
        colour: string | null;
        category: 'rank' | 'membership' | 'award';
      }>;
      isOfficer: boolean;
      siteRoles: ReadonlyArray<{ name: string; colour: string | null }>;
      /** When Discord says they joined the squadron. Null when not known. */
      guildJoinedAt: string | null;
    }
  > {
    const row = await this.store.byHandle(handle);
    if (row === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such member.');
    }
    const isSelf = caller !== undefined && caller.userId === row.source.id;

    /*
     * ★ THE SAME BUILDERS THE ROSTER USES ★
     *
     * A profile page showing different pilot ranks from the card that links to
     * it is the kind of contradiction nobody reports and everybody notices. So
     * the snapshot, the Inara merge and the ladder fill all come from the same
     * three functions, in the same order — Inara first, journal as the
     * fallback, THEN expand to all six ladders. Filling before the merge would
     * make Inara's "I have nothing" indistinguishable from six real readings.
     */
    const [snapshots, inara, catalogue, activity, journal] = await Promise.all([
      this.store.snapshotEvents([row.source.id]).then((events) => buildSnapshots(events)),
      this.store.inaraRanks([row.source.id]),
      this.store.discordRoleCatalogue(),
      this.store.activityThisMonth(row.source.id),
      /*
       * ★ THE SAME JOURNAL DATA THE DASHBOARD SHOWS ★
       *
       * Position, hangar and balance were permanently null here: `ProfileSource`
       * carried the fields and NOTHING populated them. The store still said they
       * would "arrive with cAPI (P1.8, blocked on Frontier)" — written before the
       * companion app existed and true when it was.
       *
       * Meanwhile /dashboard has been reading all three out of the member's own
       * journal for weeks. So a commander looked at their own record and was
       * told nothing had been reported, while the dashboard one click away
       * showed their ship, their system and their balance.
       */
      this.store.profileEvents(row.source.id),
    ]);

    /*
     * ★ SQUADRON TENURE IS THE DISCORD JOIN DATE, NOT THE ACCOUNT ONE ★
     *
     * `joinedAt` on the profile is when somebody created a WEBSITE account.
     * The page labelled it "in the squadron", so a commander who has flown here
     * for years and signed in yesterday read as "1 day".
     *
     * Inara cannot answer it — `getCommanderProfile` returns the squadron name
     * and the member's rank in it, and no join date anywhere in the response.
     * Discord is the only place this squadron's membership has a timestamp, and
     * we have written it at every sign-in all along (INV-047).
     */
    const guildJoinedAt = await this.store.guildJoinedAt(row.source.id);

    const fromJournal = buildCommanderProfile(journal, row.source.cmdrName, null);

    const worn = (row.source.guildRoleIds ?? [])
      .map((id) => catalogue.get(id))
      .filter((role): role is NonNullable<typeof role> => role !== undefined);

    return {
      /*
       * Activity goes through the SERIALIZER, not around it.
       *
       * It is governed by `showActivity` like any other gated field, so merging
       * it into the source is what keeps INV-027 in one place. Attaching it to
       * the response afterwards would have published it for everybody and left
       * the toggle silently doing nothing.
       */
      ...serializeProfile(
        {
          ...row.source,
          activity,
          /*
           * ★ MERGED INTO THE SOURCE, SO THE TOGGLES STILL DECIDE ★
           *
           * Each of these is governed by its own switch — showLocation,
           * showFleet, showCredits — and the serializer is the only thing that
           * may apply them (INV-027). Attaching them to the response afterwards
           * would publish a member's position and balance to everybody and
           * leave three settings silently doing nothing.
           */
          location:
            fromJournal.currentSystem === null
              ? null
              : /*
                 * ★ THE STATION IS REAL NOW ★
                 *
                 * This read `station: null` with a note that it was "a separate fact we do not
                 * carry here" — true when it was written, and no longer. The profile derives the
                 * sublocation from the newest of Docked / Location / SupercruiseExit /
                 * ApproachSettlement, with Undocked clearing it.
                 *
                 * Still inside `source`, so `showLocation` governs it exactly as it governs the
                 * system (INV-027). Attaching it after serialisation would publish every member's
                 * docking to everybody and leave the setting silently doing nothing — which is the
                 * whole reason this object exists rather than being spread onto the response.
                 */
                { system: fromJournal.currentSystem, station: fromJournal.currentLocation },
          fleet: fromJournal.fleet.map((s) => ({ shipType: s.shipType, name: s.name })),
          /*
           * BigInt, because the profile type is `bigint | null` and serialises
           * to a STRING — a balance above 2^53 rounds silently through Number,
           * and the members that hits are exactly the ones who would notice.
           */
          credits: fromJournal.credits === null ? null : BigInt(fromJournal.credits),
        },
        row.privacy,
        { audience: isSelf ? 'self' : 'public' },
      ),
      commander: fillLadders(
        withInaraRanks(snapshots.get(row.source.id) ?? EMPTY_SNAPSHOT, inara.get(row.source.id)),
      ),
      /*
       * `hidden` and `other` never leave the API — filtered HERE rather than in
       * the browser, exactly as on the roster. Which channels a member can see
       * is not this page's business to publish either.
       */
      discordRoles: worn
        .filter(
          (role): role is typeof role & { category: 'rank' | 'membership' | 'award' } =>
            role.category === 'rank' ||
            role.category === 'membership' ||
            role.category === 'award',
        )
        .sort((a, b) => b.position - a.position)
        .map(({ name, colour, category }) => ({ name, colour, category })),
      // A leadership APPOINTMENT, not a permission and not a tenure rank. Same
      // rule as the roster, for the same reason.
      isOfficer: worn.some(
        (role) => role.rankOrder !== null && role.rankOrder < LEADERSHIP_CEILING,
      ),
      /*
       * Null when they have never linked Discord, or linked before we recorded
       * it. Null renders as "not known" rather than falling back to the account
       * date — a wrong number presented confidently is worse than an absent one.
       */
      guildJoinedAt: guildJoinedAt?.toISOString() ?? null,
      siteRoles: row.source.siteRoles ?? [],
    };
  }

  /** The caller's own toggles, for the settings page. */
  @Get('me/privacy')
  async myPrivacy(@User() caller: CurrentUser | undefined): Promise<PrivacySettings> {
    const userId = requireUser(caller);
    // Resolved rather than returned raw, so a member with no row sees the
    // conservative defaults instead of a null the UI has to interpret.
    return resolvePrivacy(await this.store.privacyOf(userId));
  }

  @Patch('me/privacy')
  async updatePrivacy(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<PrivacySettings> {
    const userId = requireUser(caller);
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);

    // A member may only ever change their OWN settings. The user id comes from
    // the session and is never read from the body or the path, so there is no
    // parameter here for anyone to tamper with.
    return this.store.savePrivacy(userId, readPatch(body));
  }
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to manage your privacy settings.');
  }
  return caller.userId;
}
