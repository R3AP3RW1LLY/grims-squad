import { notifyMembers, type LiveNudge, type PrismaClient } from '@grims/db';
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
  /**
   * True when this member has declared THIS build their current one.
   *
   * Joining says "count me in"; current says "this is the one I am hauling to right now", and a
   * member holds at most one. Both surfaces read it off the roster so "who is on the build" and
   * "who is on the build NOW" come from the same response rather than a second round trip.
   */
  readonly current: boolean;
}

export class ColonyRosterService {
  constructor(
    private readonly db: PrismaClient,
    private readonly acl: AclDbService,
    /**
     * How the crew notices below nudge live bell badges. Optional so every existing test
     * constructs the service exactly as before; rows still land without it (notify.ts).
     */
    private readonly nudge?: LiveNudge,
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
  ): Promise<{ owner: string; postedById: string; completedAt: Date | null; title: string }> {
    const db = await this.acl.forCaller(userId);
    const found = await db.colonyProject.findFirst({
      where: { id: projectId },
      // The title rides along for the crew notices — a second read per join would be a query
      // for a string this lookup already had in hand.
      select: { owner: true, postedById: true, completedAt: true, title: true },
    });

    if (found === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }
    return found;
  }

  /** Everybody on the build, with what they have taken on and what they have actually delivered. */
  async roster(projectId: string, callerId: string): Promise<readonly RosterEntry[]> {
    await this.#project(projectId, callerId);

    const [members, assignments, delivered, current] = await Promise.all([
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
      // Who has declared THIS build their current one. One small read for the whole roster,
      // rather than a per-member lookup — the same N+1 reasoning as the delivered totals above.
      this.db.currentBuild.findMany({
        where: { projectId },
        select: { userId: true },
      }),
    ]);

    const byUser = new Map(delivered.map((d) => [d.user_id, Number(d.tonnes)]));
    const onIt = new Set(current.map((c) => c.userId));

    return members.map((m) => ({
      userId: m.user_id,
      name: m.name,
      joinedAt: m.joined_at,
      you: m.user_id === callerId,
      current: onIt.has(m.user_id),
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

    const added = await this.db.colonyMember.createMany({
      data: [{ projectId, userId }],
      skipDuplicates: true,
    });

    /*
     * ★ THE POSTER HEARS ABOUT A NEW CREW MEMBER — AND NOBODY ELSE ★
     *
     * `added.count` gates it: pressing Join twice is one intention, and must be one notice. The
     * joiner hears nothing (they did it), and a poster joining their own build is likewise not
     * news to themselves. The joiner is NAMED, because volunteering is good news with a face —
     * unlike leaving, below.
     */
    if (added.count > 0 && userId !== project.postedById) {
      const joiner = await this.db.user
        .findUnique({ where: { id: userId }, select: { displayName: true, handle: true } })
        .catch(() => null);
      const name = joiner?.displayName ?? joiner?.handle ?? 'A member';

      await notifyMembers(
        this.db,
        [project.postedById],
        {
          kind: 'colony.crew',
          title: `${name} joined ${project.title}`,
          body: 'They are now on the build’s crew roster.',
          link: `/colonisation/${projectId}`,
        },
        this.nudge,
      );
    }
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
    const project = await this.#project(projectId, userId);

    const [, removed] = await this.db.$transaction([
      this.db.colonyAssignment.deleteMany({ where: { projectId, userId } }),
      this.db.colonyMember.deleteMany({ where: { projectId, userId } }),
    ]);

    /*
     * The poster hears the roster changed — and the notice deliberately does NOT name who left.
     * Leaving is allowed, ordinary, and nobody's to answer for; a notification that names the
     * leaver reads as a report on them. The roster page has the current list for anybody who
     * needs it. Gated on `removed.count` so leaving a build you were never on says nothing.
     */
    if (removed.count > 0 && userId !== project.postedById) {
      await notifyMembers(
        this.db,
        [project.postedById],
        {
          kind: 'colony.crew',
          title: `The crew on ${project.title} changed`,
          body: 'A member has left the build’s crew roster.',
          link: `/colonisation/${projectId}`,
        },
        this.nudge,
      );
    }
  }

  /**
   * Declares this build the caller's current one.
   *
   * ★ AT MOST ONE PER MEMBER, ENFORCED BY THE KEY ★
   *
   * `current_builds` is keyed on the USER, so declaring a second build silently replaces the
   * first rather than accumulating a list — "current" that can be plural is not current. The
   * upsert is what makes pressing the button on a new build one gesture instead of clear-then-set.
   *
   * Visibility goes through the same `#project` read join and leave use: a project the caller
   * cannot see answers "not available", never "exists but is not yours".
   */
  async setCurrent(projectId: string, userId: string): Promise<void> {
    const project = await this.#project(projectId, userId);

    // The same refusal as join, for the same reason: a finished build is simply over, and
    // declaring yourself currently on it would put a truth nobody can act on in the overlay.
    if (project.completedAt !== null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That build is already finished.');
    }

    await this.db.currentBuild.upsert({
      where: { userId },
      create: { userId, projectId },
      // `setAt` refreshed on the move: it answers "since when has this been current", and
      // carrying the old build's timestamp onto the new one would be a wrong answer.
      update: { projectId, setAt: new Date() },
    });
  }

  /**
   * Clears the caller's current build, if it is this one.
   *
   * ★ NO VISIBILITY CHECK, DELIBERATELY — UNLIKE EVERY METHOD ABOVE ★
   *
   * Clearing is scoped to the caller's OWN row and discloses nothing about any project: the
   * delete matches on (user, project) and succeeds identically whether the id is real, invisible
   * or invented. Requiring `#project` here would trap a member whose current build was made
   * private after they declared it — still pinned to something they can no longer even name, with
   * the one route out refusing them. Pointing at a DIFFERENT build is not an error either;
   * the state the caller asked for ("not current on :id") already holds.
   */
  async clearCurrent(projectId: string, userId: string): Promise<void> {
    await this.db.currentBuild.deleteMany({ where: { userId, projectId } });
  }

  /**
   * The build this member is currently on, or null.
   *
   * The project itself is NOT resolved here — the caller re-reads it through their own
   * visibility (ColonyService.byId), so a pointer at a build somebody has since hidden answers
   * "no current build" rather than leaking its title through a side door.
   */
  async currentFor(userId: string): Promise<{ projectId: string; setAt: Date } | null> {
    const row = await this.db.currentBuild.findUnique({
      where: { userId },
      select: { projectId: true, setAt: true },
    });
    return row ?? null;
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
