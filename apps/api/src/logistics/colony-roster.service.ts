import type { PrismaClient } from '@grims/db';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclDbService } from '../authz/acl-db.service.js';

/**
 * Who is on a build, and who is bringing what.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we also need a way for people to join the project ahead of time, and a way that we can assign
 * people who do join what materials we want them to haul" — and, asked how binding that is:
 * "Officers can assign on Squadron Projects, Project Owners can assign on Members Projects", with
 * members also claiming freely.
 *
 * ★ TWO RULES, AND THEY ARE NOT THE SAME RULE ★
 *
 * CLAIMING is something a member does to themselves. Anybody who can see the board can say "I will
 * bring the steel", and nobody needs to approve it — the whole point is that a build gets covered
 * without an officer in the loop.
 *
 * ASSIGNING is something done TO somebody, and who may do it depends on whose build it is:
 *
 *   squadron project   COLONY_MANAGE. It is the squadron's effort, so directing it is an officer's
 *                      call — the same bar as declaring it the current effort.
 *   personal project   the poster. It is their build; nobody else decides who hauls to it.
 *
 * Both land in the same table, distinguished by `assignedById`. That is deliberate: a page showing
 * "who is covering what" should not have to read two lists, and the difference still matters for
 * the message shown and for who may take it away.
 */

export interface RosterEntry {
  readonly userId: string;
  readonly name: string;
  readonly joinedAt: Date;
  /** What they have taken on, claimed or assigned. */
  readonly assignments: ReadonlyArray<{
    readonly id: string;
    readonly commodity: string;
    readonly tonnes: number | null;
    /** True when somebody else put this on them, rather than them claiming it. */
    readonly assigned: boolean;
  }>;
  /** Tonnes they have actually delivered, from the ledger. */
  readonly delivered: number;
  /**
   * True for the caller's own row.
   *
   * ★ THE SERVER DECIDES WHO YOU ARE ★
   *
   * The app cannot work this out: it holds a device token, not a user id, and nothing in the
   * roster payload identified the reader. Sending the caller's id down for the client to compare
   * would be one more value the app could get wrong about its own identity — and it is the answer
   * to "should this button say Join or Leave", which had better not be a guess.
   */
  readonly you: boolean;
}

export class ColonyRosterService {
  constructor(
    private readonly db: PrismaClient,
    private readonly acl: AclDbService,
  ) {}

  /**
   * The project, as far as authorisation is concerned.
   *
   * Read through a bound client (INV-002) — `ColonyProject` carries a visibility, so a caller who
   * may not see the project must not be able to join it either. Resolving it here means every
   * method below starts from a row the caller is genuinely allowed to act on.
   */
  async #project(
    projectId: string,
    userId: string,
  ): Promise<{ owner: string; postedById: string; completedAt: Date | null }> {
    const db = await this.acl.forCaller(userId);
    const found = await db.colonyProject.findFirst({
      where: { id: projectId },
      select: { owner: true, postedById: true, completedAt: true },
    });

    if (found === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }
    return found;
  }

  /** Everybody on the build, with what they have taken on and what they have actually delivered. */
  async roster(projectId: string, callerId: string): Promise<readonly RosterEntry[]> {
    await this.#project(projectId, callerId);

    const [members, assignments, delivered] = await Promise.all([
      this.db.$queryRawUnsafe<Array<{ user_id: string; name: string; joined_at: Date }>>(
        `SELECT m.user_id, u.display_name AS name, m.joined_at
           FROM colony_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.project_id = $1::uuid
          ORDER BY m.joined_at`,
        projectId,
      ),
      this.db.$queryRawUnsafe<
        Array<{ id: string; user_id: string; commodity: string; tonnes: number | null; assigned_by_id: string | null }>
      >(
        `SELECT id, user_id, commodity, tonnes, assigned_by_id
           FROM colony_assignments
          WHERE project_id = $1::uuid
          ORDER BY commodity`,
        projectId,
      ),
      /*
       * Summed from the LEDGER rather than from anything the roster stores. What somebody has
       * actually hauled is a fact about deliveries, and keeping a second running total on the
       * member row would be a number that could disagree with the contributions it came from.
       */
      this.db.$queryRawUnsafe<Array<{ user_id: string; tonnes: bigint }>>(
        `SELECT user_id, SUM(amount)::bigint AS tonnes
           FROM colony_contributions
          WHERE project_id = $1::uuid AND user_id IS NOT NULL
          GROUP BY user_id`,
        projectId,
      ),
    ]);

    const byUser = new Map(delivered.map((d) => [d.user_id, Number(d.tonnes)]));

    return members.map((m) => ({
      userId: m.user_id,
      name: m.name,
      joinedAt: m.joined_at,
      you: m.user_id === callerId,
      assignments: assignments
        .filter((a) => a.user_id === m.user_id)
        .map((a) => ({
          id: a.id,
          commodity: a.commodity,
          tonnes: a.tonnes,
          assigned: a.assigned_by_id !== null,
        })),
      delivered: byUser.get(m.user_id) ?? 0,
    }));
  }

  /** Puts the caller on the roster. Idempotent — pressing Join twice is one intention. */
  async join(projectId: string, userId: string): Promise<void> {
    const project = await this.#project(projectId, userId);

    /*
     * A finished build takes no new volunteers. Not an error worth a scary message — it is simply
     * over, and the button should not have been there.
     */
    if (project.completedAt !== null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That build is already finished.');
    }

    await this.db.colonyMember.createMany({
      data: [{ projectId, userId }],
      skipDuplicates: true,
    });
  }

  /**
   * Takes the caller off the roster, and with them anything they had claimed.
   *
   * ★ THEIR CLAIMS GO; THEIR DELIVERIES STAY ★
   *
   * Leaving says "I am not going to do this after all", which is about intent. It says nothing
   * about the cargo they already hauled, and deleting that would quietly reduce a build's recorded
   * progress below what was actually delivered.
   */
  async leave(projectId: string, userId: string): Promise<void> {
    await this.#project(projectId, userId);

    await this.db.$transaction([
      this.db.colonyAssignment.deleteMany({ where: { projectId, userId } }),
      this.db.colonyMember.deleteMany({ where: { projectId, userId } }),
    ]);
  }

  /**
   * Takes on a commodity, or puts it on somebody else.
   *
   * `targetUserId` equal to the caller is a CLAIM and needs no permission beyond seeing the board.
   * Anything else is an ASSIGNMENT and is checked against whose build it is.
   */
  async assign(input: {
    projectId: string;
    callerId: string;
    callerMask: bigint;
    targetUserId: string;
    commodity: string;
    tonnes: number | null;
  }): Promise<void> {
    const project = await this.#project(input.projectId, input.callerId);

    const commodity = input.commodity.trim();
    if (commodity === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the commodity.');
    }

    const isClaim = input.targetUserId === input.callerId;

    if (!isClaim) {
      /*
       * ★ WHOSE BUILD IT IS DECIDES WHO MAY DIRECT IT ★
       *
       * A squadron project is the squadron's effort, so directing it is an officer's call. A
       * personal project belongs to whoever posted it, and nobody else chooses who hauls to it —
       * not even an officer, because it is not the squadron's build.
       */
      const may =
        project.owner === 'squadron'
          ? (input.callerMask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE
          : project.postedById === input.callerId;

      if (!may) {
        throw new AppError(
          ErrorCode.PERMISSION_DENIED,
          project.owner === 'squadron'
            ? 'Only officers can assign work on a squadron project.'
            : 'Only the member who posted this project can assign work on it.',
        );
      }
    }

    /*
     * Assigning somebody adds them to the roster if they are not already on it. An assignment to
     * a person who does not appear on the build is a row nothing on the page would draw — and
     * making an officer add them first would be a second step for no reason.
     */
    await this.db.colonyMember.createMany({
      data: [{ projectId: input.projectId, userId: input.targetUserId }],
      skipDuplicates: true,
    });

    // Tonnes floored and nulled when meaningless: "0 tonnes of steel" is not a claim, and a
    // negative one is nonsense that would subtract from what the build believes is covered.
    const tonnes =
      input.tonnes === null || !Number.isFinite(input.tonnes) || input.tonnes <= 0
        ? null
        : Math.trunc(input.tonnes);

    await this.db.colonyAssignment.upsert({
      where: {
        projectId_userId_commodity: {
          projectId: input.projectId,
          userId: input.targetUserId,
          commodity,
        },
      },
      create: {
        projectId: input.projectId,
        userId: input.targetUserId,
        commodity,
        tonnes,
        // Null for a claim, so the page can tell "you took this" from "you were asked".
        assignedById: isClaim ? null : input.callerId,
      },
      // Re-assigning is a correction, not a second claim. The amount moves and the authorship
      // follows it — an officer changing a member's own claim has made it an assignment.
      update: { tonnes, assignedById: isClaim ? null : input.callerId },
    });
  }

  /**
   * Removes a claim or an assignment.
   *
   * A member may always drop their own, whoever put it there — being assigned work is not being
   * bound to it, and a squadron that cannot say no has a rota rather than volunteers. Anybody who
   * could have assigned it may also remove it.
   */
  async unassign(input: {
    projectId: string;
    callerId: string;
    callerMask: bigint;
    targetUserId: string;
    commodity: string;
  }): Promise<void> {
    const project = await this.#project(input.projectId, input.callerId);

    const mayDirect =
      project.owner === 'squadron'
        ? (input.callerMask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE
        : project.postedById === input.callerId;

    if (input.targetUserId !== input.callerId && !mayDirect) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'That is not yours to remove.');
    }

    await this.db.colonyAssignment.deleteMany({
      where: {
        projectId: input.projectId,
        userId: input.targetUserId,
        commodity: input.commodity.trim(),
      },
    });
  }
}
