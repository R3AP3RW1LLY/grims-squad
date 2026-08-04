import { randomBytes } from 'node:crypto';
import { AclDbService } from '../authz/acl-db.service.js';
import { notifySquadron, Prisma, type LiveNudge, type PrismaClient } from '@grims/db';
import {
  AppError,
  ErrorCode,
  sourceOf,
  coverageOf,
  classifyBuild,
  buildProgress,
  isShareToken,
  SHARE_TOKEN_ALPHABET,
  SHARE_TOKEN_LENGTH,
  type BuildVisibility,
  type ShipBuild,
  type BuildRole,
  type BuildRoleProgress,
} from '@grims/shared';
import {
  buildCatalogue,
  computeStats,
  decodeCoriolis,
  decodeEdsy,
  decodeLoadout,
  fitForRole,
  type BuildCatalogue,
  type EdsySymbolLookup,
  type FitRequest,
  type FitResult,
} from '@grims/ed-clients';

/**
 * Importing ship builds, and keeping the catalogue they are read against.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "users should be able to submit links to existing coriolis and other elite dangerous ship builds
 * and it should take that link and learn everything about that ship and build" — and, clarified
 * later, "the training import are for builds they find in the wild".
 *
 * That distinction shapes the whole feature. A member pasting a link is contributing something they
 * FOUND — a build off a forum, a video, a friend — not necessarily their own ship. Their own ships
 * arrive separately and automatically from their journals, which is a different claim entirely and
 * is stored as one.
 */

/** How long the ship and module tables are held before being read again. */
const CATALOGUE_TTL_MS = 10 * 60_000;

export interface ImportOutcome {
  readonly id: string;
  readonly shipName: string;
  readonly buildName: string | null;
  readonly fitted: number;
  readonly slots: number;
  readonly warnings: readonly string[];
}

/**
 * ★ SHIP BUILDS ARE ACL-BEARING, SO EVERY READ IS BOUND (INV-002) ★
 *
 * `visibility` made ShipBuild an ACL model, and `acl-usage.spec.ts` failed the build the moment it
 * did. That guard is right: a controller check protects one route, and the second route onto the
 * same data is the one nobody guards.
 *
 * So nothing here touches `prisma.shipBuild` directly. Reads go through a client bound to whoever
 * is asking, and the predicate in `acl-extension.ts` — public to everyone, squadron to anyone
 * signed in, private to its author — is applied inside the query rather than after it. Counts and
 * `findFirst` are covered by the same mechanism, which application-level filtering never is.
 *
 * The two `forSystem` uses are named and narrow. Both are below, with their reasons.
 */
export class ShipBuildService {
  #catalogue: BuildCatalogue | null = null;
  #loadedAt = 0;

  constructor(
    private readonly db: PrismaClient,
    private readonly acl: AclDbService,
    /**
     * How a build-published notice nudges live bell badges. Optional so the telemetry module's
     * loadout-import construction, and every existing test, stays exactly as it was; rows still
     * land without it (notify.ts).
     */
    private readonly nudge?: LiveNudge,
  ) {}

  /**
   * Tells the squadron a build became visible to it.
   *
   * ★ FROM THE SERVICE, NOT A CONTROLLER — TWO DOORS, ONE BELL ★
   *
   * The website's outfitter and the companion's shipyard door both save through this service, so
   * a notice here covers both without either controller remembering. Journal loadout imports do
   * NOT pass through `save`/`setVisibility` and therefore never announce — automatic refits are
   * volume, not news. `notifySquadron` swallows failure: the build is saved by now.
   */
  async #announcePublished(
    build: { shipName: string; buildName: string | null; shareToken: string | null },
    authorId: string,
  ): Promise<void> {
    await notifySquadron(
      this.db,
      {
        kind: 'shipyard.build-published',
        title:
          build.buildName === null
            ? `${build.shipName} build published`
            : `${build.shipName} build published: ${build.buildName}`,
        body: 'A fitted ship is now on the squadron shipyard for anybody to open and fly.',
        ...(build.shareToken === null ? {} : { link: `/shipyard/build/${build.shareToken}` }),
        actorUserId: authorId,
      },
      this.nudge,
    );
  }

  /**
   * The ship and module tables, rebuilt when they go stale.
   *
   * ★ CACHED, BUT NOT FOR LONG ★
   *
   * Building it is one pass over 47 ships and 89 module groups — cheap, but not free, and an import
   * form can be pressed repeatedly. Ten minutes is long enough that a member submitting three builds
   * pays for it once, and short enough that a coriolis refresh is picked up the same session rather
   * than at the next deploy.
   */
  async catalogue(): Promise<BuildCatalogue> {
    if (this.#catalogue !== null && Date.now() - this.#loadedAt < CATALOGUE_TTL_MS) {
      return this.#catalogue;
    }

    const [ships, modules] = await Promise.all([
      this.db.knowledgeItem.findMany({
        where: { source: 'coriolis', kind: 'ship' },
        select: { extKey: true, name: true, data: true },
      }),
      this.db.knowledgeItem.findMany({
        where: { source: 'coriolis', kind: 'module' },
        // `name` is the GROUP's display name ("Power Distributor"). 168 of 970 modules carry no
        // name of their own and would fall back to their symbol without it.
        select: { name: true, data: true },
      }),
    ]);

    if (ships.length === 0) {
      /*
       * Said out loud rather than returning an empty catalogue. With no ships every import fails
       * with "we do not have a ship called X" — technically true, and it would send an officer
       * looking at the link rather than at the ingest that has not run.
       */
      throw new AppError(
        ErrorCode.AI_OFFLINE,
        'The ship database has not been loaded yet. Run the Coriolis ingest and try again.',
      );
    }

    this.#catalogue = buildCatalogue(ships, modules);
    this.#loadedAt = Date.now();
    return this.#catalogue;
  }

  /**
   * Imports a build from a pasted link.
   *
   * ★ THE HOST DECIDES THE DECODER, AND THE HOST IS PARSED ★
   *
   * `sourceOf` parses the URL and compares the hostname. A string test would accept
   * `coriolis.io.evil.test`, and since a decoder is chosen from the answer that is not a cosmetic
   * distinction.
   */
  async importLink(
    url: string,
    options: { submittedById: string | null; isBaseline: boolean },
  ): Promise<ImportOutcome> {
    const trimmed = url.trim();
    const source = sourceOf(trimmed);

    if (source === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That is not a build link we can read. Paste one from coriolis.io, orbis.zone or edsy.org.',
      );
    }

    const catalogue = await this.catalogue();

    const result =
      source === 'edsy'
        ? decodeEdsy(trimmed, catalogue, await this.#edsyLookup())
        : decodeCoriolis(trimmed, catalogue);

    if (!result.ok) throw new AppError(ErrorCode.VALIDATION_FAILED, result.problem);

    return this.#store(result.build, catalogue, {
      submittedById: options.submittedById,
      isBaseline: options.isBaseline,
      fromJournal: false,
    });
  }

  /**
   * Imports a member's own ship from a `Loadout` event.
   *
   * ★ REPLACES RATHER THAN ADDS ★
   *
   * A refit is the same ship, fitted differently. Keeping every version would fill the table with
   * one member's afternoon at the outfitting screen and leave the AI choosing between six Anacondas
   * that are all the same ship.
   */
  async importLoadout(payload: unknown, submittedById: string): Promise<ImportOutcome | null> {
    const catalogue = await this.catalogue();
    const result = decodeLoadout(payload, catalogue, 'journal');

    /*
     * A loadout we cannot read is not an error a member should see. This runs automatically, behind
     * them, on a ship they did not ask us to import — so a new hull we lack data for should be
     * silent here and visible in the logs, not a failed request in the middle of playing.
     */
    if (!result.ok) return null;

    return this.#store(result.build, catalogue, {
      submittedById,
      isBaseline: false,
      fromJournal: true,
    });
  }

  /**
   * Fits a ship for a role, within a budget.
   *
   * The catalogue is this service's already, so the fitter lives behind it rather than being wired
   * separately — one place that knows how to load ships and modules.
   */
  async fit(request: FitRequest): Promise<FitResult | null> {
    return fitForRole(await this.catalogue(), request);
  }

  /**
   * EDSY's own numbering, resolved to the game's symbols.
   *
   * ★ TWO KEYS, BECAUSE SHIPS AND MODULES JOIN DIFFERENTLY ★
   *
   * Modules join on `fdname`, the game's symbol, which is the same key the journal importer uses.
   * Ships cannot: EDSY calls the Alliance Challenger `TypeX_3` and Coriolis calls it
   * `alliance_challenger`, and nothing normalises one into the other. They join on Frontier's own
   * number instead, which both files record and which agrees exactly.
   *
   * Loaded per import, like the catalogue. It is one small table and an import is rare.
   */
  async #edsyLookup(): Promise<EdsySymbolLookup> {
    const rows = await this.db.edsyId.findMany({
      select: { kind: true, edsyId: true, fdname: true, fdid: true },
    });

    if (rows.length === 0) {
      throw new AppError(
        ErrorCode.AI_OFFLINE,
        'EDSY links cannot be read until the EDSY reference has been loaded. Try a Coriolis link, ' +
          'or ask an officer to run the EDSY refresh.',
      );
    }

    const byId = new Map(
      rows.map((r) => [
        `${r.kind}:${r.edsyId}`,
        { fdname: r.fdname, fdid: r.fdid === null ? null : Number(r.fdid) },
      ]),
    );

    return (kind, edsyId) => byId.get(`${kind}:${edsyId}`) ?? null;
  }

  async #store(
    build: ShipBuild,
    catalogue: BuildCatalogue,
    options: { submittedById: string | null; isBaseline: boolean; fromJournal: boolean },
  ): Promise<ImportOutcome> {
    const stats = computeStats(build, catalogue);
    const coverage = coverageOf(build);

    /*
     * ★ CLASSIFIED HERE, WHERE THE CATALOGUE IS ★
     *
     * Working out what a build is FOR needs its module groups, which needs the ship catalogue. Doing
     * it on read would make listing five numbers load 47 ships and 970 modules; doing it here costs
     * a lookup per slot on data already in hand.
     */
    const groups = build.modules
      .map((m) => {
        if (m.moduleId === null) return null;
        const slot = catalogue.ship(build.shipId)?.slots.find(
          (sl) => sl.group === m.group && sl.index === m.index,
        );
        if (slot === undefined) return null;
        return catalogue.module(
          slot.group === 'standard'
            ? 'standard'
            : slot.group === 'internal'
              ? 'internal'
              : slot.size === 0
                ? 'utility'
                : 'hardpoint',
          m.moduleId,
        )?.grp ?? null;
      })
      .filter((g): g is string => g !== null);

    const role: BuildRole = classifyBuild(groups);

    const data = {
      shipId: build.shipId,
      shipName: build.shipName,
      buildName: build.buildName,
      source: build.source,
      sourceUrl: build.sourceUrl,
      build: build as unknown as object,
      /*
       * `null`, not `undefined`, when there are no stats.
       *
       * Under `exactOptionalPropertyTypes` an undefined here is not "leave it out" — it is a
       * different type from the column, and Prisma reads it as an omitted field rather than as an
       * empty one. Null is what the column actually holds for a build we could not compute.
       */
      stats: (stats ?? null) as unknown as object,
      submittedById: options.submittedById,
      isBaseline: options.isBaseline,
      fromJournal: options.fromJournal,
      role,
    };

    /*
     * A journal build is keyed on member + ship, so a refit updates the row it replaces. A pasted
     * link always creates: two members may share the same build and one member may keep several
     * plans for one hull, and neither is a duplicate.
     */
    /*
     * ★ FIND-THEN-WRITE, NOT `upsert` ★
     *
     * The uniqueness is a PARTIAL index (`... WHERE from_journal`), because a member may keep
     * several pasted plans for one hull but only one journal row. Prisma's `upsert` can only key on
     * a unique it knows about in the schema, and it cannot model a partial one — so the lookup is
     * explicit.
     *
     * The partial index still exists and still holds: this is the happy path, and the database
     * remains the thing that guarantees it if two journal uploads race.
     */
    let row;
    if (options.fromJournal && options.submittedById !== null) {
      /*
       * Bound to the submitter, who by definition may see their own rows — so the ACL predicate
       * changes nothing here and the binding costs one cheap read. That is the point: the rule is
       * "reads of this model are bound", not "bound when it would have mattered", because the
       * second version is a judgement somebody eventually gets wrong.
       */
      const db = await this.acl.forCaller(options.submittedById);

      const existing = await db.shipBuild.findFirst({
        where: { submittedById: options.submittedById, shipId: build.shipId, fromJournal: true },
        select: { id: true },
      });

      row =
        existing === null
          ? await db.shipBuild.create({ data })
          : await db.shipBuild.update({ where: { id: existing.id }, data });
    } else {
      /*
       * Baseline imports carry `submittedById: null` — they belong to the squadron rather than to
       * whoever pasted them — so there is no caller to bind to. A write, and writes are never ACL
       * filtered; the binding exists so the accessor is reached through the same door as every
       * other one.
       */
      row = await this.acl.forSystem('baseline build import, owned by the squadron').shipBuild.create({
        data,
      });
    }

    return {
      id: row.id,
      shipName: build.shipName,
      buildName: build.buildName,
      fitted: coverage.modulesRead,
      slots: coverage.slotsTotal,
      warnings: coverage.warnings,
    };
  }

  // ----------------------------------------------------------------- sharing
  /**
   * Saves a build somebody put together in the outfitter.
   *
   * ★ SQUADRON OWNER, 2026-08-01 ★
   *
   * "the ability for our users to share their builds and make them visible to the squadron and
   * public if they choose to."
   *
   * ★ STATS ARE COMPUTED HERE, NOT ACCEPTED FROM THE BROWSER ★
   *
   * The outfitter already knows the jump range — it has been showing it — and posting it would
   * save a computation. It would also mean the stored figure is whatever the client said, which is
   * how a build reaches the share board claiming a jump range no ship achieves. The browser chooses
   * the MODULES; the server decides what they do.
   */
  async save(
    input: { build: ShipBuild; buildName: string | null; visibility: BuildVisibility },
    ownerId: string,
  ): Promise<{ id: string; shareToken: string | null; visibility: BuildVisibility }> {
    const catalogue = await this.catalogue();
    if (catalogue.ship(input.build.shipId) === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'We do not have that ship in our data.');
    }

    const stats = computeStats(input.build, catalogue);
    const groups = input.build.modules
      .map((m) => m.moduleId)
      .filter((v): v is string => v !== null);

    /*
     * A token is minted only when the build is actually shared. Minting one on every private save
     * would put a live URL behind a build nobody chose to publish — unguessable, but present, and
     * "unguessable" is not the promise `private` makes.
     */
    const shareToken = input.visibility === 'private' ? null : await this.#mintToken();

    const db = await this.acl.forCaller(ownerId);

    const row = await db.shipBuild.create({
      data: {
        shipId: input.build.shipId,
        shipName: input.build.shipName,
        buildName: input.buildName,
        // Ours. Not `coriolis` — nobody imported this from anywhere, and labelling it as a coriolis
        // build would put a source on the board that cannot be checked.
        source: 'outfitter',
        sourceUrl: `/shipyard?ship=${encodeURIComponent(input.build.shipId)}`,
        build: input.build as unknown as Prisma.InputJsonValue,
        stats: (stats as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        submittedById: ownerId,
        role: classifyBuild(groups),
        isBaseline: false,
        fromJournal: false,
        visibility: input.visibility,
        shareToken,
      },
      select: { id: true, shareToken: true, visibility: true },
    });

    // Saved shared is published: the build was visible to the squadron from its first moment.
    if (input.visibility !== 'private') {
      await this.#announcePublished(
        { shipName: input.build.shipName, buildName: input.buildName, shareToken: row.shareToken },
        ownerId,
      );
    }

    return {
      id: row.id,
      shareToken: row.shareToken,
      visibility: row.visibility as BuildVisibility,
    };
  }

  /**
   * Changes who may open a build.
   *
   * ★ THE TOKEN SURVIVES GOING PRIVATE ★
   *
   * Setting a build back to private does NOT clear its token. Somebody who shares, un-shares and
   * shares again has almost certainly pasted the first link into Discord, and minting a second one
   * would leave that message pointing at a dead page while a working link exists elsewhere.
   *
   * The token is not the permission. `visibility` is checked on every read, so a stale link stops
   * working the moment the build goes private and starts working again if it comes back — which is
   * what somebody toggling this expects, and is only true because the token is stable.
   */
  async setVisibility(
    id: string,
    visibility: BuildVisibility,
    actorId: string,
  ): Promise<{ shareToken: string | null; visibility: BuildVisibility }> {
    /*
     * `findFirst`, not `findUnique`. Prisma's `findUnique` takes only the unique key, so the ACL
     * predicate cannot be merged into it — which is why `acl-find-unique.spec.ts` forbids it on
     * these models outright. A build this member cannot see now reads as "no such build", which is
     * also the right answer.
     */
    const db = await this.acl.forCaller(actorId);

    const row = await db.shipBuild.findFirst({
      where: { id },
      // The pre-change state rides along: the publish notice below fires on the private→shared
      // TRANSITION, and only what was stored before the update can witness one.
      select: { submittedById: true, shareToken: true, visibility: true, shipName: true, buildName: true },
    });

    if (row === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such build.');

    /*
     * Ownership only — no moderator override. An officer may DELETE a build, because a bad build
     * teaches bad answers; publishing somebody else's plan under their name is not moderation.
     */
    if (row.submittedById !== actorId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'That is not your build.');
    }

    const shareToken =
      visibility === 'private' ? row.shareToken : (row.shareToken ?? (await this.#mintToken()));

    const updated = await db.shipBuild.update({
      where: { id },
      data: { visibility, shareToken },
      select: { shareToken: true, visibility: true },
    });

    /*
     * ★ ANNOUNCED ONLY ON THE PRIVATE→SHARED TRANSITION ★
     *
     * A build leaving the drawer is publication; squadron→public widens an audience that was
     * already told, and re-sharing after an unshare would re-announce a build the feed already
     * carries. The transition test — was private, now is not — is the narrowest true statement.
     */
    if (row.visibility === 'private' && visibility !== 'private') {
      await this.#announcePublished(
        { shipName: row.shipName, buildName: row.buildName, shareToken: updated.shareToken },
        actorId,
      );
    }

    return {
      shareToken: updated.visibility === 'private' ? null : updated.shareToken,
      visibility: updated.visibility as BuildVisibility,
    };
  }

  /**
   * One shared build, by its token.
   *
   * `viewerIsMember` decides whether a squadron-only build is readable. Passed in rather than read
   * here, so this method gives the same answer for the same inputs.
   */
  async byToken(token: string, viewerId: string | null): Promise<SharedBuild | null> {
    if (!isShareToken(token)) return null;

    /*
     * ★ THE ACL DOES THE WORK NOW ★
     *
     * `viewerId` binds the read, and the predicate — public to everyone, squadron to anyone signed
     * in, private to its author — decides what comes back. The explicit visibility checks that used
     * to sit below this were doing the same job one layer too late.
     *
     * They are kept anyway, because they say out loud what the caller may rely on and because a
     * defence that only exists in a shared extension is one refactor from being absent.
     */
    const db = await this.acl.forCaller(viewerId ?? undefined);

    const row = await db.shipBuild.findFirst({
      where: { shareToken: token },
      select: {
        shipId: true,
        shipName: true,
        buildName: true,
        build: true,
        stats: true,
        role: true,
        visibility: true,
        updatedAt: true,
        submittedBy: { select: { displayName: true } },
      },
    });

    if (row === null) return null;

    /*
     * A private build, and a squadron build read by somebody signed out, both return null rather
     * than a 403. A 403 confirms the token is real, which turns the share URL into an oracle for
     * anybody enumerating them.
     */
    if (row.visibility === 'private') return null;
    if (row.visibility === 'squadron' && viewerId === null) return null;

    return {
      shipId: row.shipId,
      shipName: row.shipName,
      buildName: row.buildName,
      build: row.build as unknown as ShipBuild,
      stats: (row.stats as Record<string, unknown> | null) ?? null,
      role: row.role,
      author: row.submittedBy?.displayName ?? null,
      visibility: row.visibility as BuildVisibility,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Builds published to the squadron, or to everybody.
   *
   * ★ SQUADRON OWNER, 2026-08-01 ★
   *
   * "add a Squadron page and Public build pages to the Shipyard category ... the public page must
   * also be visible along with the builds in them to anyone not signed in."
   *
   * ★ 'squadron' INCLUDES THE PUBLIC ONES ★
   *
   * A build published to the whole internet is, necessarily, also visible to the squadron. Filtering
   * the squadron page to `visibility = 'squadron'` exactly would hide the most widely shared builds
   * from the members they were shared with — which reads as a bug and is one.
   *
   * The public page is the strict filter, because that page is about what the squadron shows the
   * world.
   */
  async shared(scope: 'squadron' | 'public', viewerId: string | null): Promise<SharedBuildRow[]> {
    const db = await this.acl.forCaller(viewerId ?? undefined);

    const rows = await db.shipBuild.findMany({
      where:
        scope === 'public'
          ? { visibility: 'public', shareToken: { not: null } }
          : { visibility: { in: ['squadron', 'public'] }, shareToken: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        shipName: true,
        buildName: true,
        role: true,
        stats: true,
        visibility: true,
        shareToken: true,
        updatedAt: true,
        submittedBy: { select: { displayName: true } },
      },
    });

    return rows.map((r) => ({
      shipName: r.shipName,
      buildName: r.buildName,
      role: r.role,
      stats: (r.stats as Record<string, unknown> | null) ?? null,
      visibility: r.visibility as BuildVisibility,
      /*
       * Non-null by the query's own filter. Asserted rather than defaulted to '': a row that
       * reached here without a token is a broken invariant, and an empty string would render a
       * link to nowhere instead of failing where somebody would notice.
       */
      shareToken: r.shareToken as string,
      author: r.submittedBy?.displayName ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /** Every build this member saved in the outfitter, with its share state. */
  async mine(ownerId: string): Promise<SavedBuildRow[]> {
    const db = await this.acl.forCaller(ownerId);

    const rows = await db.shipBuild.findMany({
      where: { submittedById: ownerId, source: 'outfitter' },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        shipName: true,
        buildName: true,
        role: true,
        stats: true,
        visibility: true,
        shareToken: true,
        updatedAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      shipName: r.shipName,
      buildName: r.buildName,
      role: r.role,
      stats: (r.stats as Record<string, unknown> | null) ?? null,
      visibility: r.visibility as BuildVisibility,
      // Withheld while private, so the page cannot show a link that would not work.
      shareToken: r.visibility === 'private' ? null : r.shareToken,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /**
   * A share token that is not already taken.
   *
   * ★ RETRIES, RATHER THAN TRUSTING THE ODDS ★
   *
   * 58 bits makes a collision vanishingly unlikely, and "vanishingly unlikely" handled by nothing
   * at all is a unique-constraint violation surfacing as a 500 to whoever happened to be there.
   * Three attempts, then it says so plainly.
   */
  async #mintToken(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const bytes = randomBytes(SHARE_TOKEN_LENGTH);
      let token = '';
      for (const byte of bytes) {
        token += SHARE_TOKEN_ALPHABET[byte % SHARE_TOKEN_ALPHABET.length];
      }

      /*
       * ★ forSystem, AND IT HAS TO BE ★
       *
       * A uniqueness check that could not see private builds would happily mint a token already
       * held by one, and the unique index would then reject the insert — turning a collision that
       * should be retried into a 500 for whoever was saving.
       *
       * It reads one boolean and returns no data, so seeing everything costs nothing.
       */
      const taken = await this.acl
        .forSystem('share-token uniqueness across every build, including private ones')
        .shipBuild.findFirst({
          where: { shareToken: token },
          select: { id: true },
        });
      if (taken === null) return token;
    }

    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Could not allocate a share link. Try again.');
  }
}

/** One build as the browser sees it. */
export interface BuildView {
  readonly id: string;
  readonly shipId: string;
  readonly shipName: string;
  readonly buildName: string | null;
  readonly source: string;
  readonly sourceUrl: string;
  readonly isBaseline: boolean;
  readonly fromJournal: boolean;
  /** Who contributed it, by display name. Null for the squadron's own baseline. */
  readonly submittedBy: string | null;
  readonly submittedById: string | null;
  readonly stats: Record<string, unknown> | null;
  readonly fitted: number;
  readonly slots: number;
  readonly createdAt: string;
}

/**
 * Reading and removing builds.
 *
 * ★ EVERYTHING IS VISIBLE TO EVERY MEMBER ★
 *
 * The squadron owner chose squadron-wide and credited on 2026-08-01: "any member can ask what
 * people are flying and get real answers with names". A build nobody can see teaches the assistant
 * nothing anybody asked for.
 */
/**
 * Reads for the admin console and the training page.
 *
 * ACL-bound like everything else that touches this model — see the note on ShipBuildService. The
 * one `forSystem` here is the training progress count, and its reason is written where it is used.
 */
export class ShipBuildQueries {
  constructor(private readonly acl: AclDbService) {}

  /**
   * How far the collection is from being worth training on, per role.
   *
   * ★ COUNTED PER ROLE, NOT IN TOTAL ★
   *
   * Forty exploration builds teach the assistant nothing about mining. A single total would fill up
   * while leaving whole questions unanswerable, and the bar would say ready when it was not.
   */
  async progress(): Promise<BuildRoleProgress[]> {
    /*
     * ★ forSystem: this counts the CORPUS, not what one person may read ★
     *
     * "Do we have enough combat builds to train on" is a question about the training set. Bound to
     * a caller it would answer "enough that YOU can see", so an officer and a cadet would be shown
     * different progress bars for the same shared corpus and both would be told it was the
     * squadron's total.
     *
     * It returns counts per role and no build content whatsoever.
     */
    const rows = await this.acl
      .forSystem('training corpus totals, which are about the corpus rather than about a reader')
      .shipBuild.groupBy({ by: ['role'], _count: true });

    const counts: Partial<Record<BuildRole, number>> = {};
    for (const row of rows) {
      if (row.role === null) continue;
      counts[row.role as BuildRole] = row._count;
    }

    return buildProgress(counts);
  }

  async list(
    options: { shipId?: string; baselineOnly?: boolean } = {},
    viewerId: string | null = null,
  ): Promise<BuildView[]> {
    /*
     * Bound to the reader, which changes what this list contains: somebody else's PRIVATE build is
     * no longer in it. That is a behaviour change and the right one — before `visibility` existed
     * every stored build was a contribution to the squadron, and now a build can be a plan its
     * author has not shared.
     */
    const db = await this.acl.forCaller(viewerId ?? undefined);

    const rows = await db.shipBuild.findMany({
      where: {
        ...(options.shipId === undefined ? {} : { shipId: options.shipId }),
        ...(options.baselineOnly === true ? { isBaseline: true } : {}),
      },
      select: {
        id: true,
        shipId: true,
        shipName: true,
        buildName: true,
        source: true,
        sourceUrl: true,
        isBaseline: true,
        fromJournal: true,
        submittedById: true,
        stats: true,
        build: true,
        createdAt: true,
        submittedBy: { select: { displayName: true } },
      },
      /*
       * Baseline first, then newest. An officer or the assistant looking for "how do we do this"
       * should meet the squadron's reference before somebody's experiment from Tuesday.
       */
      orderBy: [{ isBaseline: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    return rows.map((r) => {
      const modules = ((r.build as { modules?: Array<{ moduleId: string | null }> })?.modules ?? []);
      return {
        id: r.id,
        shipId: r.shipId,
        shipName: r.shipName,
        buildName: r.buildName,
        source: r.source,
        sourceUrl: r.sourceUrl,
        isBaseline: r.isBaseline,
        fromJournal: r.fromJournal,
        submittedBy: r.submittedBy?.displayName ?? null,
        submittedById: r.submittedById,
        stats: (r.stats as Record<string, unknown> | null) ?? null,
        fitted: modules.filter((m) => m.moduleId !== null).length,
        slots: modules.length,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /**
   * Removes a build.
   *
   * ★ YOUR OWN, OR ANY OF THEM IF YOU MODERATE ★
   *
   * The owner chose "straight in, removable by officers". A member can always withdraw what they
   * contributed — that is the other half of contributing it — and an officer can remove anything,
   * because a bad build teaches bad answers and a review queue nobody empties is worse than a
   * delete button somebody uses.
   */
  async remove(id: string, actorId: string, canModerate: boolean): Promise<void> {
    /*
     * A moderator must be able to remove a build they cannot READ — a private one somebody reported
     * — so the lookup is unbound and the ownership check below is what authorises it. Bound to the
     * actor, a private build would read as "no such build" and the moderation route would be a lie.
     *
     * `findFirst`, not `findUnique`: banned on ACL models so that a bound call cannot silently drop
     * its predicate, and using it here would be the one exception somebody later copies.
     */
    const row = await this.acl
      .forSystem('moderation lookup: an officer may remove a build they cannot read')
      .shipBuild.findFirst({
        where: { id },
        select: { submittedById: true },
      });

    if (row === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such build.');
    }
    if (!canModerate && row.submittedById !== actorId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'That is not your build.');
    }

    await this.acl
      .forSystem('moderation delete, authorised by the ownership check above')
      .shipBuild.delete({ where: { id } });
  }

}

/** A shared build as a reader receives it. */
export interface SharedBuild {
  readonly shipId: string;
  readonly shipName: string;
  readonly buildName: string | null;
  readonly build: ShipBuild;
  readonly stats: Record<string, unknown> | null;
  readonly role: string | null;
  readonly author: string | null;
  readonly visibility: BuildVisibility;
  readonly updatedAt: string;
}

/** One row on the squadron or public build boards. */
export interface SharedBuildRow {
  readonly shipName: string;
  readonly buildName: string | null;
  readonly role: string | null;
  readonly stats: Record<string, unknown> | null;
  readonly visibility: BuildVisibility;
  readonly shareToken: string;
  readonly author: string | null;
  readonly updatedAt: string;
}

/** One row on "my builds". */
export interface SavedBuildRow {
  readonly id: string;
  readonly shipName: string;
  readonly buildName: string | null;
  readonly role: string | null;
  readonly stats: Record<string, unknown> | null;
  readonly visibility: BuildVisibility;
  readonly shareToken: string | null;
  readonly updatedAt: string;
}

/**
 * What the Shipyard needs to render an outfitting screen.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "a page under squadron called Shipyard that operates like the signature builder, 2 options build
 * my own or AI Assisted build, build my own should give a builder that looks and feels like
 * coriolis, works the same way etc but styled to match our theme".
 *
 * ★ THE WHOLE CATALOGUE GOES DOWN ONCE ★
 *
 * A Coriolis-style outfitter changes a module and re-computes everything instantly. Asking the
 * server on every click would put a round trip between picking a power plant and seeing what it did
 * to the power budget, which is the one thing that outfitter has to feel immediate about.
 *
 * So the ship's slots and every module that could go in them are sent with the page, and the
 * browser does the arithmetic. It is a few hundred kilobytes for a screen somebody spends ten
 * minutes on.
 */
export interface ShipyardModule {
  readonly id: string;
  readonly grp: string;
  readonly name: string;
  readonly class: number;
  readonly rating: string | null;
  readonly mass: number | null;
  readonly power: number | null;
  readonly cost: number | null;
  /** Everything else coriolis records — cargo, fuel, pgen, damage, the shield curve. */
  readonly raw: Record<string, unknown>;
}

export interface ShipyardShip {
  readonly id: string;
  readonly name: string;
  readonly hullCost: number;
  readonly properties: Record<string, unknown>;
  readonly bulkheads: ShipyardModule[];
  readonly slots: Array<{
    group: string;
    index: number;
    size: number;
    fixedGroup: string | null;
    eligible: readonly string[] | null;
  }>;
  /** The factory loadout, per group, so "reset to stock" needs no second request. */
  readonly defaults: Record<string, readonly (string | null)[]>;
}

export class ShipyardService {
  constructor(private readonly builds: ShipBuildService) {}

  /** Every hull, with enough to list and price them. */
  async ships(): Promise<Array<{ id: string; name: string; hullCost: number; pad: number }>> {
    const catalogue = await this.builds.catalogue();

    return catalogue
      .ships()
      .map((ship) => ({
        id: ship.id,
        name: ship.name,
        hullCost:
          typeof ship.properties['hullCost'] === 'number'
            ? ship.properties['hullCost']
            : typeof ship.properties['retailCost'] === 'number'
              ? ship.properties['retailCost']
              : 0,
        // Landing pad size decides where a ship can dock at all, which is the first thing anybody
        // filters a shipyard by.
        pad: typeof ship.properties['class'] === 'number' ? ship.properties['class'] : 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** One hull and everything that fits it. */
  async outfit(shipId: string): Promise<{ ship: ShipyardShip; modules: ShipyardModule[] } | null> {
    const catalogue = await this.builds.catalogue();
    const ship = catalogue.ship(shipId);
    if (ship === null) return null;

    const strip = (m: {
      id: string;
      grp: string;
      name: string;
      class: number;
      rating: string | null;
      mass: number | null;
      power: number | null;
      cost: number | null;
      raw: Readonly<Record<string, unknown>>;
    }): ShipyardModule => ({
      id: m.id,
      grp: m.grp,
      name: m.name,
      class: m.class,
      rating: m.rating,
      mass: m.mass,
      power: m.power,
      cost: m.cost,
      raw: { ...m.raw },
    });

    /*
     * Only what this hull can actually take. Sending all 970 modules for a Sidewinder would be four
     * times the payload and every one of them wrong for it — the outfitter would then have to
     * filter by size on the client, which is the server's job and it has the slot list.
     */
    const wanted = new Set<string>();
    const seen = new Set<string>();
    const modules: ShipyardModule[] = [];

    for (const slot of ship.slots) {
      const category =
        slot.group === 'standard'
          ? 'standard'
          : slot.group === 'internal'
            ? 'internal'
            : slot.size === 0
              ? 'utility'
              : 'hardpoint';

      const groups: readonly string[] =
        slot.fixedGroup !== null
          ? [slot.fixedGroup]
          : (slot.eligible ?? GROUPS_BY_CATEGORY[category] ?? []);

      for (const group of groups) {
        wanted.add(`${category}:${group}`);
        for (const module of catalogue.modulesIn(category, group)) {
          if (module.class > slot.size) continue;

          const key = `${category}:${module.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          modules.push(strip(module));
        }
      }
    }

    return {
      ship: {
        id: ship.id,
        name: ship.name,
        hullCost:
          typeof ship.properties['hullCost'] === 'number'
            ? ship.properties['hullCost']
            : 0,
        properties: { ...ship.properties },
        bulkheads: ship.bulkheads.map(strip),
        slots: ship.slots.map((s) => ({
          group: s.group,
          index: s.index,
          size: s.size,
          fixedGroup: s.fixedGroup,
          eligible: s.eligible,
        })),
        defaults: { ...ship.defaults },
      },
      modules,
    };
  }
}

/**
 * Which module groups belong in which kind of slot.
 *
 * ★ LISTED, NOT DERIVED ★
 *
 * The catalogue knows every group it holds, but "every internal group" includes fighter hangars and
 * luxury cabins that most hulls cannot take and nobody is outfitting for. This is the vocabulary of
 * the outfitter — what a person picking a module expects to see offered — and it is a shorter list
 * than everything that technically exists.
 */
const GROUPS_BY_CATEGORY: Record<string, readonly string[]> = {
  standard: ['pp', 't', 'fsd', 'ls', 'pd', 's', 'ft'],
  hardpoint: ['mc', 'pl', 'bl', 'c', 'rg', 'pa', 'ml', 'abl', 'sdm', 'mr', 'tp', 'nl', 'axmc', 'rfl'],
  utility: ['sb', 'ch', 'hs', 'ecm', 'pwa', 'xs', 'kw', 'ws', 'sfn'],
  internal: [
    'cr', 'sg', 'bsg', 'psg', 'hr', 'mrp', 'scb', 'fs', 'am', 'rf', 'cc', 'pc', 'dtl', 'fx',
    'rpl', 'rsl', 'mlc', 'hb', 'pce', 'pci', 'pcm', 'pcq', 'fh', 'pas', 'gsc', 'sua', 'dc', 'sc',
  ],
};
