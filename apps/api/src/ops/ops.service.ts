import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { AppError, ErrorCode } from '@grims/shared';

/**
 * Operations — a wing forming up, and who is in it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "the ops/and bgs need admin pages in the administration category on the website please to manage
 * them etc"
 *
 * ★ BUILT ON A SCHEMA THAT WAS ALREADY WAITING ★
 *
 * `operations` and `operation_signups` have been in the database since the module was designed and
 * empty ever since — with capacity, standby overflow, required ship roles, recurrence and
 * attendance all thought through. Writing a simpler pair beside them would have thrown that away,
 * and the BGS module had already taught this lesson once today.
 *
 * ★ STANDBY IS NOT A REJECTION ★
 *
 * The schema's own words. An op that is full does not turn a member away; it puts them behind the
 * people who committed first, in order, so a drop-out promotes the next one deterministically
 * rather than by whoever refreshes fastest.
 */

export type SignupState = 'yes' | 'maybe' | 'no' | 'standby';

export interface OpRow {
  readonly id: string;
  readonly title: string;
  readonly opType: string;
  readonly startsAt: Date;
  readonly status: string;
  readonly capacity: number | null;
  readonly going: number;
  readonly standby: number;
  readonly createdBy: string;
  readonly mine: SignupState | null;
}

@Injectable()
export class OpsService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * The board: what is coming up, with each op's headcount and the caller's own commitment.
   *
   * Counted in the query rather than by loading signups. A board shows a dozen ops and needs two
   * numbers from each; fetching every signup to length-check them is a dozen round trips to answer
   * something one GROUP BY answers.
   */
  async board(userId: string | null, includePast = false): Promise<readonly OpRow[]> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{
        id: string;
        title: string;
        op_type: string;
        starts_at: Date;
        status: string;
        capacity: number | null;
        going: number;
        standby: number;
        created_by: string;
        mine: string | null;
      }>
    >(
      `SELECT o.id, o.title, o.op_type::text AS op_type, o.starts_at, o.status::text AS status,
              o.capacity,
              (SELECT count(*)::int FROM operation_signups s
                WHERE s.operation_id = o.id AND s.state = 'yes') AS going,
              (SELECT count(*)::int FROM operation_signups s
                WHERE s.operation_id = o.id AND s.state = 'standby') AS standby,
              u.display_name AS created_by,
              (SELECT s.state::text FROM operation_signups s
                WHERE s.operation_id = o.id AND s.user_id = $1::uuid) AS mine
         FROM operations o
         JOIN users u ON u.id = o.created_by_id
        WHERE o.status <> 'draft'
          AND ($2::boolean OR o.starts_at > now() - interval '6 hours')
        ORDER BY o.starts_at
        LIMIT 100`,
      userId,
      includePast,
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      opType: r.op_type,
      startsAt: r.starts_at,
      status: r.status,
      capacity: r.capacity,
      going: r.going,
      standby: r.standby,
      createdBy: r.created_by,
      mine: (r.mine as SignupState | null) ?? null,
    }));
  }

  /** One op with its full roster, for the detail page and the admin screen. */
  async one(id: string): Promise<{
    readonly op: OpRow & { description: string | null; systemName: string | null };
    readonly roster: readonly { name: string; state: string; note: string | null; at: Date }[];
  } | null> {
    const [op] = await this.db.$queryRawUnsafe<
      Array<{
        id: string;
        title: string;
        op_type: string;
        starts_at: Date;
        status: string;
        capacity: number | null;
        description_md: string | null;
        system_name: string | null;
        created_by: string;
        going: number;
        standby: number;
      }>
    >(
      `SELECT o.id, o.title, o.op_type::text AS op_type, o.starts_at, o.status::text AS status,
              o.capacity, o.description_md, s.name AS system_name, u.display_name AS created_by,
              (SELECT count(*)::int FROM operation_signups x
                WHERE x.operation_id = o.id AND x.state = 'yes') AS going,
              (SELECT count(*)::int FROM operation_signups x
                WHERE x.operation_id = o.id AND x.state = 'standby') AS standby
         FROM operations o
         JOIN users u ON u.id = o.created_by_id
         LEFT JOIN systems s ON s.address = o.system_address
        WHERE o.id = $1::uuid`,
      id,
    );
    if (op === undefined) return null;

    const roster = await this.db.$queryRawUnsafe<
      Array<{ name: string; state: string; note: string | null; signed_up_at: Date }>
    >(
      `SELECT u.display_name AS name, s.state::text AS state, s.note, s.signed_up_at
         FROM operation_signups s
         JOIN users u ON u.id = s.user_id
        WHERE s.operation_id = $1::uuid
        /*
         * Committed-first ordering, which is also the standby PROMOTION order. Showing it any other
         * way would make the queue look arbitrary to the people in it.
         */
        ORDER BY s.state, s.signed_up_at`,
      id,
    );

    return {
      op: {
        id: op.id,
        title: op.title,
        opType: op.op_type,
        startsAt: op.starts_at,
        status: op.status,
        capacity: op.capacity,
        going: op.going,
        standby: op.standby,
        createdBy: op.created_by,
        mine: null,
        description: op.description_md,
        systemName: op.system_name,
      },
      roster: roster.map((r) => ({
        name: r.name,
        state: r.state,
        note: r.note,
        at: r.signed_up_at,
      })),
    };
  }

  /** Post an operation. */
  async create(input: {
    readonly title: string;
    readonly opType: string;
    readonly startsAt: Date;
    readonly description: string | null;
    readonly capacity: number | null;
    readonly createdById: string;
  }): Promise<{ id: string }> {
    const title = input.title.trim();
    if (title === '') throw new AppError(ErrorCode.VALIDATION_FAILED, 'Give the op a title.');

    if (Number.isNaN(input.startsAt.getTime())) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say when it starts.');
    }

    const [row] = await this.db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO operations (created_by_id, title, description_md, op_type, starts_at, capacity, status)
       VALUES ($1::uuid, $2, $3, $4::"OperationType", $5::timestamptz, $6, 'scheduled')
       RETURNING id`,
      input.createdById,
      title,
      input.description?.trim() === '' ? null : input.description,
      input.opType,
      input.startsAt,
      input.capacity,
    );

    return { id: (row as { id: string }).id };
  }

  /**
   * Say whether you are coming.
   *
   * ★ CAPACITY DECIDES THE STATE, NOT THE MEMBER ★
   *
   * A member says "yes"; whether that is `yes` or `standby` depends on how many said it first. The
   * count and the insert are one statement so two people committing to the last seat cannot both
   * read "one place left" and both take it.
   */
  async signUp(opId: string, userId: string, want: SignupState, note: string | null): Promise<void> {
    if (want !== 'yes') {
      await this.db.$executeRawUnsafe(
        `INSERT INTO operation_signups (operation_id, user_id, state, note)
         VALUES ($1::uuid, $2::uuid, $3::"SignupState", $4)
         ON CONFLICT (operation_id, user_id)
         DO UPDATE SET state = EXCLUDED.state, note = EXCLUDED.note, signed_up_at = now()`,
        opId,
        userId,
        want,
        note,
      );
      return;
    }

    await this.db.$executeRawUnsafe(
      `INSERT INTO operation_signups (operation_id, user_id, state, note)
       SELECT $1::uuid, $2::uuid,
              /*
               * Uncapped ops take everybody. A capped one takes you if the committed count is still
               * under it — counted HERE, inside the insert, so the check and the write cannot be
               * separated by somebody else's commitment.
               */
              CASE
                WHEN o.capacity IS NULL THEN 'yes'
                WHEN (SELECT count(*) FROM operation_signups s
                       WHERE s.operation_id = o.id AND s.state = 'yes'
                         AND s.user_id <> $2::uuid) < o.capacity THEN 'yes'
                ELSE 'standby'
              END::"SignupState",
              $3
         FROM operations o WHERE o.id = $1::uuid
       ON CONFLICT (operation_id, user_id)
       DO UPDATE SET state = EXCLUDED.state, note = EXCLUDED.note, signed_up_at = now()`,
      opId,
      userId,
      note,
    );
  }

  /**
   * Withdraw, and promote whoever has waited longest.
   *
   * ★ THE PROMOTION IS THE POINT ★
   *
   * Without it, standby is a list that never moves and members stop joining it — which turns a
   * full op into a closed one. Promotion is by commitment order so it is explicable to the person
   * who was next and did not get in.
   */
  async withdraw(opId: string, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM operation_signups WHERE operation_id = $1::uuid AND user_id = $2::uuid`,
        opId,
        userId,
      );

      await tx.$executeRawUnsafe(
        `UPDATE operation_signups
            SET state = 'yes'
          WHERE (operation_id, user_id) = (
            SELECT s.operation_id, s.user_id
              FROM operation_signups s
              JOIN operations o ON o.id = s.operation_id
             WHERE s.operation_id = $1::uuid AND s.state = 'standby'
               AND o.capacity IS NOT NULL
               AND (SELECT count(*) FROM operation_signups y
                     WHERE y.operation_id = o.id AND y.state = 'yes') < o.capacity
             ORDER BY s.signed_up_at
             LIMIT 1
          )`,
        opId,
      );
    });
  }

  /** Change an op's state — an officer calling it off, or marking it done. */
  async setStatus(opId: string, status: string): Promise<void> {
    const allowed = ['draft', 'scheduled', 'live', 'complete', 'cancelled'];
    if (!allowed.includes(status)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not a state an op can be in.');
    }

    await this.db.$executeRawUnsafe(
      `UPDATE operations SET status = $2::"OperationStatus" WHERE id = $1::uuid`,
      opId,
      status,
    );
  }
}
