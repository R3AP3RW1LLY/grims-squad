import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { satisfiesMask } from './category.service.js';

/**
 * The recruitment tracker (P2.7).
 *
 * ★ A TRACKER, NOT A FRONT DOOR — AND THAT WAS A DECISION ★
 *
 * Squadron owner, 2026-07-30, asked which was the real way in: "In-app tracks, Inara/in-game stay
 * primary."
 *
 * So applications ARRIVE through Inara and the in-game squadron screen — exactly as the joining
 * guides tell people — and this records and works them. That is why there is no public application
 * form here and no Turnstile: P2.7's acceptance lists both, and both describe a front door the
 * owner deliberately did not want. Building them anyway would have contradicted the guides that
 * were just written and approved.
 *
 * What is kept from that acceptance, because it applies either way:
 *
 *   - answers stored as structured JSONB, so the funnel is reportable
 *   - an applicant reaches their OWN thread and not another's, 404 rather than 403
 *   - approval sets probationEndsAt to decidedAt + 30 days
 *   - a duplicate application is rejected WITH ITS CURRENT STATUS
 *
 * ★ EVERY DECISION IS AUDITED ★
 *
 * Approving or rejecting somebody is a privileged action, so INV-009 applies: actor, action, target
 * and a real before/after. The same reasoning as moderation — an application decision nobody can
 * review is one nobody can be wrong about.
 */

/** What an officer sees in the queue. */
export interface ApplicationRow {
  readonly id: string;
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly state: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedByHandle: string | null;
  readonly probationEndsAt: string | null;
}

/** The funnel, for "is recruitment working". */
export interface FunnelReport {
  readonly submitted: number;
  readonly interviewing: number;
  readonly approved: number;
  readonly rejected: number;
  readonly withdrawn: number;
  /** Approved as a share of everything decided. Null when nothing has been decided yet. */
  readonly approvalRate: number | null;
}

/** Probation, in days. Named rather than inlined because P2.7 pins the number. */
const PROBATION_DAYS = 30;

const TERMINAL: readonly string[] = ['approved', 'rejected', 'withdrawn'];

export class RecruitmentService {
  /**
   * Records an application that arrived via Inara or in game.
   *
   * ★ A DUPLICATE IS REFUSED *WITH ITS CURRENT STATUS* ★
   *
   * P2.7 asks for exactly that, and the "with its status" half is the useful part: an officer
   * recording somebody who applied last week should be told "already interviewing" rather than
   * "duplicate". The first answers their next question; the second sends them to go and look.
   *
   * A previously REJECTED or WITHDRAWN application does not block a new one — people reapply, and
   * a permanent bar from one rejection is not a policy anybody chose.
   */
  async record(
    db: AclBoundClient,
    userId: string,
    answers: Record<string, unknown>,
    actorId: string,
    mask: bigint,
  ): Promise<{ id: string; state: string }> {
    this.#assertRecruiter(mask);

    const applicant = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, handle: true },
    });
    if (applicant === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such member.');
    }

    const existing = await db.application.findUnique({
      where: { userId },
      select: { id: true, state: true },
    });

    if (existing !== null && !TERMINAL.includes(existing.state)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `${applicant.handle} already has an application, currently "${existing.state}".`,
      );
    }

    /*
     * The answers are stored as a structured object, not free text. That is what makes the funnel
     * reportable later — "how many applicants found us through Inara" is a query rather than
     * somebody reading a hundred paragraphs.
     *
     * Deliberately NOT validated against a fixed schema here: the questions will change, and a
     * validator that rejected an answer shape from six months ago would make old applications
     * unreadable. The columns that matter for process — state, decidedAt, probation — are real
     * columns.
     */
    const row =
      existing === null
        ? await db.application.create({
            data: { userId, answers: answers as object, state: 'submitted' },
            select: { id: true, state: true },
          })
        : await db.application.update({
            where: { userId },
            data: {
              answers: answers as object,
              state: 'submitted',
              // A reapplication starts clean: the previous decision is history, not a live fact.
              decidedById: null,
              decidedAt: null,
              decisionNote: null,
              probationEndsAt: null,
            },
            select: { id: true, state: true },
          });

    await db.auditLog.create({
      data: {
        actorId,
        actorType: 'user',
        action: 'recruitment.record',
        targetType: 'application',
        targetId: row.id,
        before: existing === null ? {} : ({ state: existing.state } as object),
        after: { state: 'submitted' } as object,
      },
    });

    return row;
  }

  /**
   * Moves an application along, and audits it.
   *
   * ★ APPROVAL SETS PROBATION, AND THAT IS COMPUTED HERE ★
   *
   * `decidedAt + 30 days`, computed from the decision rather than from "now at the time somebody
   * looks". Those are the same instant today and would silently diverge the moment a decision is
   * backdated or replayed.
   */
  async decide(
    db: AclBoundClient,
    applicationId: string,
    state: 'interviewing' | 'approved' | 'rejected' | 'withdrawn',
    note: string | null,
    actorId: string,
    mask: bigint,
  ): Promise<{ state: string; probationEndsAt: string | null }> {
    this.#assertRecruiter(mask);

    const app = await db.application.findUnique({
      where: { id: applicationId },
      select: { id: true, state: true, userId: true },
    });
    if (app === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such application.');
    }

    /*
     * A decided application is not re-decided silently. Reopening is legitimate — an appeal, a
     * mistake — but it should be a deliberate act that starts from `record`, so the history shows a
     * new application rather than a state that changed twice with no explanation.
     */
    if (TERMINAL.includes(app.state) && state !== 'withdrawn') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `That application is already "${app.state}". Record a new one if they are reapplying.`,
      );
    }

    const decidedAt = new Date();
    const probationEndsAt =
      state === 'approved'
        ? new Date(decidedAt.getTime() + PROBATION_DAYS * 24 * 60 * 60 * 1000)
        : null;

    await db.$transaction([
      db.application.update({
        where: { id: app.id },
        data: {
          state,
          // Only a DECISION records a decider. Moving to `interviewing` is progress, not a verdict.
          ...(state === 'interviewing'
            ? {}
            : { decidedById: actorId, decidedAt, decisionNote: note }),
          probationEndsAt,
        },
      }),
      db.auditLog.create({
        data: {
          actorId,
          actorType: 'user',
          action: `recruitment.${state}`,
          targetType: 'application',
          targetId: app.id,
          before: { state: app.state } as object,
          after: {
            state,
            probationEndsAt: probationEndsAt?.toISOString() ?? null,
          } as object,
        },
      }),
    ]);

    return { state, probationEndsAt: probationEndsAt?.toISOString() ?? null };
  }

  /** The queue an officer works. */
  async queue(db: AclBoundClient, mask: bigint, state?: string): Promise<ApplicationRow[]> {
    this.#assertRecruiter(mask);

    const rows = await db.application.findMany({
      where: state === undefined ? {} : { state: state as never },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        userId: true,
        state: true,
        createdAt: true,
        decidedAt: true,
        probationEndsAt: true,
        user: { select: { handle: true, displayName: true } },
        decidedBy: { select: { handle: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      handle: r.user.handle,
      displayName: r.user.displayName ?? r.user.handle,
      state: r.state,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedByHandle: r.decidedBy?.handle ?? null,
      probationEndsAt: r.probationEndsAt?.toISOString() ?? null,
    }));
  }

  /**
   * An applicant's OWN application.
   *
   * ★ THE OWNERSHIP PREDICATE, AND WHY IT 404s ★
   *
   * P2.7 is explicit: an applicant reaches their own and not another's, "which returns 404, not
   * 403". A 403 confirms the other application exists — and in a squadron of a hundred people,
   * confirming that a named person applied is exactly the thing an applicant should not be able to
   * find out.
   *
   * So ownership is part of the WHERE clause rather than a check after the read. A row that is not
   * theirs is not returned, and "not yours" and "not there" produce the same answer because they
   * take the same path.
   */
  async mine(db: AclBoundClient, userId: string): Promise<ApplicationRow | null> {
    const row = await db.application.findFirst({
      where: { userId },
      select: {
        id: true,
        userId: true,
        state: true,
        createdAt: true,
        decidedAt: true,
        probationEndsAt: true,
        user: { select: { handle: true, displayName: true } },
        decidedBy: { select: { handle: true } },
      },
    });
    if (row === null) return null;

    return {
      id: row.id,
      userId: row.userId,
      handle: row.user.handle,
      displayName: row.user.displayName ?? row.user.handle,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      /*
       * The decider's handle is NOT exposed to the applicant — see the officer-facing `queue` for
       * where it is. An applicant learning which officer rejected them turns a squadron decision
       * into a personal one.
       */
      decidedByHandle: null,
      probationEndsAt: row.probationEndsAt?.toISOString() ?? null,
    };
  }

  /**
   * The funnel.
   *
   * Counted in the database with a groupBy rather than by fetching applications and tallying — the
   * numbers are the point, and pulling rows to count them would grow with the squadron.
   */
  async funnel(db: AclBoundClient, mask: bigint): Promise<FunnelReport> {
    this.#assertRecruiter(mask);

    const grouped = await db.application.groupBy({
      by: ['state'],
      _count: { state: true },
    });

    const count = (s: string): number =>
      grouped.find((g) => g.state === s)?._count.state ?? 0;

    const approved = count('approved');
    const rejected = count('rejected');
    const decided = approved + rejected;

    return {
      submitted: count('submitted'),
      interviewing: count('interviewing'),
      approved,
      rejected,
      withdrawn: count('withdrawn'),
      /*
       * Null rather than 0 when nothing has been decided. A rate of 0% and "no decisions yet" mean
       * completely different things to whoever is reading it, and showing the first for the second
       * would make recruitment look broken on the day it started.
       */
      approvalRate: decided === 0 ? null : approved / decided,
    };
  }

  /**
   * Who may work the queue.
   *
   * `MEMBER_MANAGE` — the permission that already means "handles people". Inventing a RECRUIT
   * permission would add a bit for a job the existing one describes, and every extra bit is another
   * thing to get wrong in the role editor.
   */
  #assertRecruiter(mask: bigint): void {
    if (!satisfiesMask(mask, Permission.MEMBER_MANAGE)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot work the recruitment queue.');
    }
  }
}
