import type { PrismaClient } from '@grims/db';
import {
  AppError,
  ErrorCode,
  Permission,
  describeNexus,
  nexusTrade,
  systemMarket,
  type MeasuredRow,
  type NexusReport,
  type NexusSystem,
  type PredictedLists,
} from '@grims/shared';
import type { ColonyPlanService } from './colony-plan.service.js';

/**
 * Groups of our own systems, and what they can feed each other.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "we need a way to allow members who have multiple systems in their colonization to create a nexus
 * that will predict trade routes, and work like the raven colonial nexus system please."
 *
 * ★ THE TABLE EXISTED AND THE FEATURE DID NOT ★
 *
 * `colony_blocs` has been in the schema for weeks with no service, no route and no page — and zero
 * rows in production, which is what a feature nobody can reach looks like from the database. What
 * was there assumed officers: blocs were squadron property, and the name was unique across the whole
 * table.
 *
 * Both assumptions had to go for this to be a member's tool. `owner` and `visibility` now mirror
 * ColonyPlan exactly, because the squadron owner asked for member-owned groups to work the way
 * shared plans do — one concept members already understand, rather than a second one to learn.
 */

/** A bloc as the list and the header need it. */
export interface BlocSummary {
  readonly id: string;
  readonly name: string;
  readonly owner: 'squadron' | 'personal';
  readonly visibility: 'private' | 'squadron';
  readonly note: string | null;
  readonly createdById: string;
  readonly createdBy: string;
  readonly systems: readonly string[];
  /** Whether the CALLER may change it. Computed here so no surface has to re-derive the rule. */
  readonly mayEdit: boolean;
}

export interface BlocNexus extends BlocSummary {
  readonly report: NexusReport;
  /** The report in a member's words, gaps first. */
  readonly summary: readonly string[];
  /** Per system, so a page can badge each one honestly. */
  readonly bases: ReadonlyArray<{ readonly systemName: string; readonly basis: string }>;
}

export class ColonyBlocService {
  constructor(
    private readonly db: PrismaClient,
    private readonly plans: ColonyPlanService,
  ) {}

  /**
   * The blocs a caller may see.
   *
   * The same three ways as plans: the squadron's, your own, and a personal one its creator chose to
   * share. Written into the WHERE clause rather than filtered afterwards, because a count or a
   * paginated read that filtered in TypeScript would be wrong in a way nothing would notice.
   */
  async list(callerId: string, mask: bigint): Promise<readonly BlocSummary[]> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT b.id, b.name, b.owner::text AS owner, b.visibility::text AS visibility, b.note,
              b.created_by_id, u.display_name AS created_by,
              COALESCE(
                (SELECT array_agg(s.system_name ORDER BY s.system_name)
                   FROM colony_bloc_systems s WHERE s.bloc_id = b.id),
                ARRAY[]::text[]
              ) AS systems
         FROM colony_blocs b
         JOIN users u ON u.id = b.created_by_id
        WHERE b.owner = 'squadron'
           OR b.created_by_id = $1::uuid
           OR b.visibility = 'squadron'
        ORDER BY b.owner DESC, b.name`,
      callerId,
    );

    return rows.map((r) => this.#summary(r, callerId, mask));
  }

  async byId(id: string, callerId: string, mask: bigint): Promise<BlocSummary | null> {
    const [row] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT b.id, b.name, b.owner::text AS owner, b.visibility::text AS visibility, b.note,
              b.created_by_id, u.display_name AS created_by,
              COALESCE(
                (SELECT array_agg(s.system_name ORDER BY s.system_name)
                   FROM colony_bloc_systems s WHERE s.bloc_id = b.id),
                ARRAY[]::text[]
              ) AS systems
         FROM colony_blocs b
         JOIN users u ON u.id = b.created_by_id
        WHERE b.id = $1::uuid
          AND (
            -- The same three ways as the list. A bloc you can see listed and cannot open would be
            -- the worst of both, and two predicates that must agree are two that eventually will not.
            b.owner = 'squadron'
            OR b.created_by_id = $2::uuid
            OR b.visibility = 'squadron'
          )`,
      id,
      callerId,
    );

    return row === undefined ? null : this.#summary(row, callerId, mask);
  }

  /**
   * Makes a bloc.
   *
   * ★ A MEMBER MAY MAKE ONE — THAT IS THE WHOLE CHANGE ★
   *
   * A personal bloc needs no permission at all: it is a member grouping systems they are already
   * allowed to see, and it starts `private`. Only claiming it for the SQUADRON needs the officer
   * bit, because that makes it every member's and takes the name for good.
   */
  async create(input: {
    name: string;
    note: string | null;
    owner: 'squadron' | 'personal';
    callerId: string;
    mask: bigint;
  }): Promise<string> {
    const name = input.name.trim();
    if (name === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Give the group a name.');
    }

    if (
      input.owner === 'squadron' &&
      (input.mask & Permission.COLONY_MANAGE) !== Permission.COLONY_MANAGE
    ) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Only officers can make a group the squadron owns. You can still make your own.',
      );
    }

    const [existing] = await this.db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM colony_blocs WHERE created_by_id = $1::uuid AND lower(name) = lower($2)`,
      input.callerId,
      name,
    );

    if (existing !== undefined) {
      /*
       * Checked before inserting so the member reads a sentence rather than a constraint violation.
       * The unique index is still what guarantees it — two clicks in the same second reach the
       * database together and only one can win, and the index is what makes the loser fail.
       */
      throw new AppError(ErrorCode.VALIDATION_FAILED, `You already have a group called “${name}”.`);
    }

    const [row] = await this.db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO colony_blocs (name, note, owner, visibility, created_by_id)
       VALUES ($1, $2, $3::"ColonyOwner", 'private'::"ColonyVisibility", $4::uuid)
       RETURNING id`,
      name,
      input.note?.trim() === '' ? null : (input.note?.trim() ?? null),
      input.owner,
      input.callerId,
    );

    if (row === undefined) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That group could not be created.');
    }
    return row.id;
  }

  /** Shares a personal bloc with the squadron to VIEW, or stops sharing it. */
  async setVisibility(input: {
    blocId: string;
    callerId: string;
    shared: boolean;
  }): Promise<void> {
    const bloc = await this.#owned(input.blocId, input.callerId);

    if (bloc.owner === 'squadron') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'A squadron group is already visible to every member.',
      );
    }

    await this.db.$executeRawUnsafe(
      `UPDATE colony_blocs SET visibility = $2::"ColonyVisibility" WHERE id = $1::uuid`,
      input.blocId,
      input.shared ? 'squadron' : 'private',
    );
  }

  async addSystem(input: {
    blocId: string;
    systemName: string;
    role: string | null;
    callerId: string;
    mask: bigint;
  }): Promise<void> {
    await this.#mayEdit(input.blocId, input.callerId, input.mask);

    const systemName = input.systemName.trim();
    if (systemName === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the system to add.');
    }

    await this.db.$executeRawUnsafe(
      `INSERT INTO colony_bloc_systems (bloc_id, system_name, role, added_by_id)
       VALUES ($1::uuid, $2, $3, $4::uuid)
       ON CONFLICT (bloc_id, system_name) DO UPDATE SET role = EXCLUDED.role`,
      input.blocId,
      systemName,
      input.role?.trim() === '' ? null : (input.role?.trim() ?? null),
      input.callerId,
    );
  }

  async removeSystem(input: {
    blocId: string;
    systemName: string;
    callerId: string;
    mask: bigint;
  }): Promise<void> {
    await this.#mayEdit(input.blocId, input.callerId, input.mask);
    await this.db.$executeRawUnsafe(
      `DELETE FROM colony_bloc_systems WHERE bloc_id = $1::uuid AND system_name = $2`,
      input.blocId,
      input.systemName.trim(),
    );
  }

  async remove(blocId: string, callerId: string, mask: bigint): Promise<void> {
    await this.#mayEdit(blocId, callerId, mask);
    await this.db.$executeRawUnsafe(`DELETE FROM colony_blocs WHERE id = $1::uuid`, blocId);
  }

  /**
   * The nexus for one bloc: what its systems can feed each other, and what they cannot.
   *
   * ★ REAL WHERE WE HAVE IT, PREDICTED ELSEWHERE, AND IT SAYS WHICH ★
   *
   * Two reads, then a pure rule. The measured half comes from the market mirror; the predicted half
   * from whichever plan the CALLER may see, which is why it is fetched through the plan service
   * rather than joined here — visibility is that service's rule to enforce, and a join would quietly
   * bypass it.
   */
  async nexus(blocId: string, callerId: string, mask: bigint): Promise<BlocNexus | null> {
    const bloc = await this.byId(blocId, callerId, mask);
    if (bloc === null) return null;

    const [measured, predicted] = await Promise.all([
      this.#measured(bloc.systems),
      this.plans.predictedTradeFor(bloc.systems, callerId),
    ]);

    const systems: NexusSystem[] = bloc.systems.map((systemName) =>
      systemMarket({
        systemName,
        measured: measured.get(systemName) ?? [],
        predicted: this.#asList(predicted.get(systemName)),
      }),
    );

    const report = nexusTrade(systems);

    return {
      ...bloc,
      report,
      summary: describeNexus(report),
      bases: systems.map((s) => ({ systemName: s.systemName, basis: s.basis ?? 'predicted' })),
    };
  }

  /** `predictedTradeFor` returns one set of lists per system; `systemMarket` takes an array. */
  #asList(lists: PredictedLists | undefined): readonly PredictedLists[] {
    return lists === undefined ? [] : [lists];
  }

  /**
   * What these systems really trade today, from the market mirror.
   *
   * ★ market_entries, NOT market_orders ★
   *
   * `market_orders` and `stations` are both EMPTY in production — the Prisma models are vestigial,
   * and the live mirror is `market_entries`, twenty million rows maintained outside Prisma by the
   * collector. Querying the models the schema advertises would have returned nothing at all, for
   * every system, forever, and looked exactly like "none of our systems are built yet".
   *
   * It stores DISPLAY names, which is the reason the measured and predicted halves can be compared
   * at all: the economy model speaks the same vocabulary, so no FDevIDs resolution stands between
   * them.
   *
   * ★ CARRIERS ARE MATCHED BY PATTERN BECAUSE THE OBVIOUS LITERAL IS WRONG ★
   *
   * A parked fleet carrier is somebody's mobile shop, not something the system produces, and
   * counting it would invent an export that flies away overnight. The first version of this excluded
   * `station_type = 'FleetCarrier'` — a value that does not exist in this table. Real carriers are
   * stored as `Drake-Class Carrier`, so the filter matched nothing and six carrier rows in our own
   * systems would have been reported as production. Checked against the data rather than assumed.
   *
   * Construction depots are deliberately KEPT. Their demand is real, standing, and buyable tonight —
   * it is precisely what a member wants a route for while a system is being built.
   */
  async #measured(systems: readonly string[]): Promise<Map<string, MeasuredRow[]>> {
    const out = new Map<string, MeasuredRow[]>();
    if (systems.length === 0) return out;

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT system_name, commodity,
              MAX(supply)::int AS supply,
              MAX(demand)::int AS demand
         FROM market_entries
        WHERE system_name = ANY($1::text[])
          AND COALESCE(station_type, '') NOT ILIKE '%carrier%'
        GROUP BY system_name, commodity`,
      [...systems],
    );

    for (const r of rows) {
      const systemName = String(r['system_name']);
      const list = out.get(systemName) ?? [];
      list.push({
        commodity: String(r['commodity']),
        supply: Number(r['supply'] ?? 0),
        demand: Number(r['demand'] ?? 0),
      });
      out.set(systemName, list);
    }

    return out;
  }

  #summary(row: Record<string, unknown>, callerId: string, mask: bigint): BlocSummary {
    const owner = String(row['owner']) === 'squadron' ? 'squadron' : 'personal';
    const createdById = String(row['created_by_id']);

    return {
      id: String(row['id']),
      name: String(row['name']),
      owner,
      visibility: String(row['visibility']) === 'squadron' ? 'squadron' : 'private',
      note: row['note'] === null ? null : String(row['note']),
      createdById,
      createdBy: String(row['created_by'] ?? ''),
      systems: Array.isArray(row['systems']) ? (row['systems'] as string[]) : [],
      // Sharing never confers editing: `owner` decides that, exactly as it does for a plan.
      mayEdit:
        owner === 'squadron'
          ? (mask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE
          : createdById === callerId,
    };
  }

  /** The row, if it is the caller's own. Used where sharing is the thing being changed. */
  async #owned(
    blocId: string,
    callerId: string,
  ): Promise<{ owner: string; created_by_id: string }> {
    const [bloc] = await this.db.$queryRawUnsafe<
      Array<{ owner: string; created_by_id: string }>
    >(`SELECT owner::text AS owner, created_by_id FROM colony_blocs WHERE id = $1::uuid`, blocId);

    /*
     * The same opaque answer for "no such group" and "not yours", so a caller learns only that they
     * cannot have it — the rule every other colonisation route follows.
     */
    if (bloc === undefined || bloc.created_by_id !== callerId) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'We hold no such group of yours.');
    }
    return bloc;
  }

  async #mayEdit(blocId: string, callerId: string, mask: bigint): Promise<void> {
    const [bloc] = await this.db.$queryRawUnsafe<Array<{ owner: string; created_by_id: string }>>(
      `SELECT owner::text AS owner, created_by_id FROM colony_blocs WHERE id = $1::uuid`,
      blocId,
    );

    if (bloc === undefined) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That group is not available.');
    }

    const may =
      bloc.owner === 'squadron'
        ? (mask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE
        : bloc.created_by_id === callerId;

    if (!may) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        bloc.owner === 'squadron'
          ? 'Only officers can change a squadron group.'
          : 'Only the member who made this group can change it.',
      );
    }
  }
}
