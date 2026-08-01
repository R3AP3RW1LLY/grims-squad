import type { PrismaClient } from '@grims/db';
import { AppError, ErrorCode, sourceOf, coverageOf, type ShipBuild } from '@grims/shared';
import {
  buildCatalogue,
  computeStats,
  decodeCoriolis,
  decodeEdsy,
  decodeLoadout,
  type BuildCatalogue,
  type EdsySymbolLookup,
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

export class ShipBuildService {
  #catalogue: BuildCatalogue | null = null;
  #loadedAt = 0;

  constructor(private readonly db: PrismaClient) {}

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
        select: { data: true },
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
    };

    /*
     * A journal build is keyed on member + ship, so a refit updates the row it replaces. A pasted
     * link always creates: two members may share the same build and one member may keep several
     * plans for one hull, and neither is a duplicate.
     */
    const row =
      options.fromJournal && options.submittedById !== null
        ? await this.db.shipBuild.upsert({
            where: {
              one_journal_build_per_ship: {
                submittedById: options.submittedById,
                shipId: build.shipId,
                fromJournal: true,
              },
            },
            create: data,
            update: data,
          })
        : await this.db.shipBuild.create({ data });

    return {
      id: row.id,
      shipName: build.shipName,
      buildName: build.buildName,
      fitted: coverage.modulesRead,
      slots: coverage.slotsTotal,
      warnings: coverage.warnings,
    };
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
export class ShipBuildQueries {
  constructor(private readonly db: PrismaClient) {}

  async list(options: { shipId?: string; baselineOnly?: boolean } = {}): Promise<BuildView[]> {
    const rows = await this.db.shipBuild.findMany({
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
    const row = await this.db.shipBuild.findUnique({
      where: { id },
      select: { submittedById: true },
    });

    if (row === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such build.');
    }
    if (!canModerate && row.submittedById !== actorId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'That is not your build.');
    }

    await this.db.shipBuild.delete({ where: { id } });
  }
}
