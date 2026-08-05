import { Inject, Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { notifyMembers, notifySquadron, PrismaClient } from '@grims/db';
import { AclDbService } from '../authz/acl-db.service.js';
import { PermissionService } from '../authz/permission.service.js';
import { ThreadService } from '../forum/thread.service.js';
import { LIVE_SERVICE } from '../live/live.tokens.js';
import { liveNudgeOf } from '../live/live-nudge.js';
import type { LiveService } from '../live/live.service.js';

/**
 * Carbon-copying announcements into the forum, and ringing every member's bell.
 *
 * ★ THE OTHER HALF OF THE ANNOUNCEMENTS PIPELINE ★
 *
 * Producers write durable `announcements` rows; the bot posts the Discord half. This poller
 * takes the rows that carry a forum half (`forum_title` + `forum_body`) and creates a real
 * forum thread from them in the Announcements category, authored by the owner's account —
 * then notifies the whole squadron: one squadron-feed entry, and one personal bell row per
 * member, because the owner asked for exactly that ("announcement posts should notify all
 * members via the notification system").
 *
 * ★ WHY THE API AND NOT THE BOT ★
 *
 * The thread must be indistinguishable from one the owner typed: same sanitiser, same
 * screening, same ACL. All of that lives in `ThreadService.create`, and only this process has
 * it. The bot's job is Discord; this one's is the site.
 *
 * ★ A POLLER, LIKE THE BOT'S — AND AN INTERVAL LIKE THE MODEL WARMER'S ★
 *
 * Same durability argument as ops-alerts: the deploy announcement is written while this
 * process is being restarted, so only a table survives the window. The in-process shape
 * copies `ModelWarmer` (ai.module.ts): onModuleInit starts an unref'd interval, nothing here
 * can fail a boot, and onModuleDestroy stops it.
 *
 * ★ THE AUTHOR AND THE CATEGORY ARE CONFIGURATION, NOT CODE ★
 *
 * `ANNOUNCE_FORUM_AUTHOR_HANDLE` names whose account authors the copies (INV-008's doctrine
 * applied to an identity: no handle in code). Unset, or naming nobody, means rows WAIT and the
 * gap is logged once — default silent, the same shape as the DM allowlist. The category is
 * found by slug or name matching 'announcements' case-insensitively; if no such category
 * exists the rows wait too, because inventing one here would put a board on everyone's forum
 * that nobody chose to create.
 *
 * ★ ONE FEED ENTRY PER ANNOUNCEMENT — THIS SERVICE'S ENTRY WINS ★
 *
 * The `forum.thread` squadron-feed fan-out lives in ForumController.createThread, the HTTP
 * path — NOT in ThreadService.create. This poller calls the service directly, so no
 * `forum.thread` entry is written for a carbon-copy and the single `announcement` entry
 * below is the only one members see. If that fan-out ever moves into the service, this is
 * the note that says the duplicate must be suppressed on the controller side, not here.
 */

const POLL_MS = 60_000;

/** How many carbon-copies one tick will make. Announcements are rare; a backlog is a restart. */
const BATCH = 5;

interface PendingForumCc {
  readonly id: bigint;
  readonly kind: string;
  readonly forum_title: string;
  readonly forum_body: string;
}

@Injectable()
export class ForumCcService implements OnModuleInit, OnModuleDestroy {
  #timer: NodeJS.Timeout | null = null;
  /** Guards against overlapping ticks — two of them could carbon-copy the same row twice. */
  #running = false;
  /** Standing configuration gaps already said out loud. One line each, not one a minute. */
  readonly #complained = new Set<string>();

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(AclDbService) private readonly acl: AclDbService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ThreadService) private readonly threads: ThreadService,
    @Optional() @Inject(LIVE_SERVICE) private readonly live: LiveService | null = null,
  ) {}

  onModuleInit(): void {
    void this.#tick();
    this.#timer = setInterval(() => {
      void this.#tick();
    }, POLL_MS);
    // Never the reason a container will not exit — the same rule as the model warmer.
    this.#timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
  }

  async #tick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      await this.deliverPending();
    } catch (err) {
      // The poller must outlive any single failure; the rows are still there next minute.
      console.error('announcement forum carbon-copy failed', err);
    } finally {
      this.#running = false;
    }
  }

  /** One pass over the queue. Public so a test can drive it without waiting a minute. */
  async deliverPending(): Promise<number> {
    const pending = await this.prisma.$queryRawUnsafe<PendingForumCc[]>(
      `SELECT id, kind, forum_title, forum_body FROM announcements
        WHERE forum_posted_at IS NULL
          AND forum_title IS NOT NULL
          AND forum_body IS NOT NULL
        ORDER BY created_at
        LIMIT ${BATCH}`,
    );
    if (pending.length === 0) return 0;

    const handle = (process.env['ANNOUNCE_FORUM_AUTHOR_HANDLE'] ?? '').trim();
    if (handle === '') {
      this.#sayOnce('no-author-env', 'ANNOUNCE_FORUM_AUTHOR_HANDLE is not set — forum carbon-copies wait until it is');
      return 0;
    }

    /*
     * The owner's account, by handle. `handle` is citext, so equality here is the same
     * case-insensitive comparison the login path uses — no mode juggling required.
     */
    const author = await this.prisma.user.findFirst({
      where: { handle },
      select: { id: true },
    });
    if (author === null) {
      this.#sayOnce(
        `no-author:${handle}`,
        `ANNOUNCE_FORUM_AUTHOR_HANDLE names '${handle}', which is no member's handle — forum carbon-copies wait`,
      );
      return 0;
    }

    /*
     * Everything below acts AS the author, through their own bound client and mask — which is
     * what makes the carbon-copy indistinguishable from a thread they typed, and what makes
     * "the author cannot post there" surface as the same refusal a browser would get.
     */
    const db = await this.acl.forCaller(author.id);
    const mask = await this.permissions.effectiveMask(author.id);

    const category = await db.forumCategory.findFirst({
      where: {
        OR: [
          { slug: { equals: 'announcements', mode: 'insensitive' } },
          { name: { equals: 'announcements', mode: 'insensitive' } },
        ],
      },
      select: { id: true, slug: true },
    });
    if (category === null) {
      // Never invent a category. A board appearing on every member's forum is an owner decision.
      this.#sayOnce(
        'no-category',
        "no forum category named 'announcements' is visible to the announce author — carbon-copies wait",
      );
      return 0;
    }

    let delivered = 0;
    for (const row of pending) {
      try {
        /*
         * The publish door, not the composer's. The announcements board demands
         * FORUM_POST_OFFICER and the webmaster preset excludes every squadron-standing permission,
         * so the configured author cannot satisfy it — in production this retried once a minute,
         * for ever, while the Discord half had already gone out. A carbon-copy of something that
         * has already happened is the platform recording it under a name members recognise, not
         * that person asking to post; the sanitiser and the screener still apply.
         */
        const thread = await this.threads.createAsSystem(
          db,
          { categoryId: category.id, title: row.forum_title, body: row.forum_body },
          author.id,
          mask,
        );

        /*
         * Stamped BEFORE the bell, so a failed fan-out can never cause a second thread. The
         * reverse order would retry the whole row next minute, thread included.
         */
        await this.prisma.$executeRawUnsafe(
          `UPDATE announcements SET forum_posted_at = now(), forum_thread_id = $2::uuid
            WHERE id = $1::bigint`,
          String(row.id),
          thread.id,
        );
        delivered += 1;

        if (thread.held) {
          /*
           * The AI screener held the owner's own announcement. The thread exists with an
           * invisible opening post, so ringing every bell would send the squadron to an empty
           * page — same reasoning as the controller's held branch. Said loudly instead: the
           * review queue has it, and releasing it there is one click.
           */
          console.error(
            `announcement ${String(row.id)} carbon-copied but its opening post was HELD by screening — release it in the review queue`,
          );
          continue;
        }

        const link = `/forum/${category.slug}/${thread.slug}`;
        const nudge = liveNudgeOf(this.live);

        // Once for the shared feed…
        await notifySquadron(
          this.prisma,
          {
            kind: 'announcement',
            title: row.forum_title,
            link,
            /*
             * No actor. The row was produced by a deploy or a job; pinning it on the author
             * account would put the owner's face on machinery.
             */
          },
          nudge,
        );

        // …and once PER MEMBER on the personal bell — the owner's explicit ask.
        const members = await this.prisma.user.findMany({
          where: { status: 'active' },
          select: { id: true },
        });
        await notifyMembers(
          this.prisma,
          members.map((m) => m.id),
          { kind: 'announcement', title: row.forum_title, link },
          nudge,
        );
      } catch (err) {
        // Left unstamped: the next pass retries. One bad row must not block the ones behind it.
        console.error(`announcement ${String(row.id)} forum carbon-copy failed — will retry`, err);
      }
    }

    return delivered;
  }

  #sayOnce(key: string, message: string): void {
    if (this.#complained.has(key)) return;
    this.#complained.add(key);
    console.warn(`announcements: ${message}`);
  }
}
