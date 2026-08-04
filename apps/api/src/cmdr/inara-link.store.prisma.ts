import { AppError, ErrorCode } from '@grims/shared';
import { notifyMembers, notifySquadron, type LiveNudge, type PrismaClient } from '@grims/db';
import type { TokenCipher } from '@grims/shared/server';
import type { InaraLinkStore, LinkRecord } from './inara-link.service.js';

/**
 * Inara key persistence.
 *
 * The key is encrypted with the shared keyring and the AAD bound to
 * (purpose, subject), so a row lifted from this table cannot be decrypted as
 * another member's (INV-012). The service never sees ciphertext; the database
 * never sees plaintext.
 */
export class PrismaInaraLinkStore implements InaraLinkStore {
  readonly #db: PrismaClient;
  readonly #cipher: TokenCipher;
  readonly #nudge: LiveNudge | undefined;

  constructor(db: PrismaClient, cipher: TokenCipher, nudge?: LiveNudge) {
    this.#db = db;
    this.#cipher = cipher;
    // How the confirmation notices below nudge live bell badges. Optional: rows land without it.
    this.#nudge = nudge;
  }

  #context(userId: string): string {
    return `inara-key:${userId}`;
  }

  async get(userId: string): Promise<LinkRecord | null> {
    const row = await this.#db.inaraLink.findUnique({ where: { userId } });
    if (row === null) return null;
    return {
      userId: row.userId,
      // Buffer.from(...), not .toString('utf8') on the raw value: Prisma 6 maps
      // Bytes to Uint8Array, whose toString takes NO encoding argument and
      // would silently yield a comma-separated list of byte values.
      apiKey: this.#cipher.decrypt(Buffer.from(row.apiKeyEnc).toString('utf8'), this.#context(userId)),
      cmdrName: row.cmdrName,
      verifiedAt: row.verifiedAt,
      lastCheckedAt: row.lastCheckedAt,
      lastError: row.lastError,
      source: row.source,
    };
  }

  async saveKey(userId: string, apiKey: string, source: string): Promise<void> {
    const enc = Buffer.from(this.#cipher.encrypt(apiKey, this.#context(userId)), 'utf8');
    await this.#db.inaraLink.upsert({
      where: { userId },
      create: { userId, apiKeyEnc: enc, source },
      // A replacement key clears the previous error and verification stamp: the
      // new key has not been checked yet, and showing yesterday's failure beside
      // a key entered thirty seconds ago is confusing.
      update: { apiKeyEnc: enc, source, lastError: null, verifiedAt: null },
    });
  }

  async recordSuccess(userId: string, cmdrName: string, at: Date): Promise<void> {
    await this.#db.inaraLink.update({
      where: { userId },
      data: { cmdrName, verifiedAt: at, lastCheckedAt: at, lastError: null },
    });
  }

  async recordFailure(userId: string, error: string, at: Date): Promise<void> {
    // verifiedAt is deliberately untouched. A failed check is not evidence the
    // member is lying, and revoking on somebody else's outage would demote
    // people who did nothing wrong.
    await this.#db.inaraLink.update({
      where: { userId },
      data: { lastCheckedAt: at, lastError: error },
    });
  }

  async remove(userId: string): Promise<void> {
    await this.#db.inaraLink.deleteMany({ where: { userId } });
  }

  async verifiedHolderOf(cmdrName: string): Promise<string | null> {
    // citext column — the database compares case-insensitively, exactly as the
    // partial unique index does. Passing mode: 'insensitive' here would build a
    // DIFFERENT comparison from the one being enforced.
    const v = await this.#db.cmdrVerification.findFirst({
      where: { cmdrName, isVerified: true, revokedAt: null },
      select: { userId: true },
    });
    return v?.userId ?? null;
  }

  /**
   * Records the verification itself.
   *
   * Revokes the member's previous verified claim first: one active verified
   * claim per member, or an old name keeps holding a lock nobody is using
   * (INV-005).
   */
  /**
   * Records what Inara said about their squadron.
   *
   * ★ CONFIRMATION IS SET, AND ALSO CLEARED ★
   *
   * `squadronVerifiedAt` is stamped when Inara agrees and set back to null when
   * it does not. A member who leaves the squadron on Inara must stop being
   * shown as confirmed — a one-way flag would keep somebody who left last month
   * looking like a member forever, and nobody would ever notice.
   *
   * `updateMany` on the member's ACTIVE verification: there is at most one, and
   * a row that has since been revoked is not an error worth failing over.
   */
  async recordSquadron(
    userId: string,
    reported: string | null,
    matched: boolean,
    at: Date,
  ): Promise<void> {
    /*
     * ★ THE TRANSITION IS READ BEFORE THE WRITE, BECAUSE THE WRITE ERASES IT ★
     *
     * "Became fully verified" is `matched` landing on a row whose squadronVerifiedAt was still
     * null — and every re-check after that stamps the column again, so only the state BEFORE
     * this update can tell a confirmation from a routine re-confirmation. This is the API-side
     * confirm path (link, refresh, and the claim's immediate re-check all come through here);
     * the worker's sweep detects the same transition through its own awaiting list.
     */
    const before = matched
      ? await this.#db.cmdrVerification.findFirst({
          where: { userId, isVerified: true, revokedAt: null },
          select: { squadronVerifiedAt: true },
        })
      : null;

    await this.#db.cmdrVerification.updateMany({
      where: { userId, isVerified: true, revokedAt: null },
      data: {
        inaraSquadron: reported,
        squadronVerifiedAt: matched ? at : null,
        squadronCheckedAt: at,
      },
    });

    if (matched && before !== null && before.squadronVerifiedAt === null) {
      await announceVerification(this.#db, userId, this.#nudge);
    }
  }

  /**
   * Records that the member says they have applied to join.
   *
   * Their claim, never proof — it only decides whether the sweep spends a
   * request asking Inara about them. Inara is what confirms it.
   */
  async claimSquadron(userId: string, at: Date): Promise<void> {
    await this.#db.cmdrVerification.updateMany({
      where: { userId, isVerified: true, revokedAt: null },
      data: { squadronClaimedAt: at },
    });
  }

  /** The squadron half of a member's verification, for the settings page. */
  async squadronState(userId: string) {
    return this.#db.cmdrVerification.findFirst({
      where: { userId, isVerified: true, revokedAt: null },
      select: {
        cmdrName: true,
        isVerified: true,
        inaraSquadron: true,
        squadronVerifiedAt: true,
        squadronClaimedAt: true,
        squadronCheckedAt: true,
      },
      orderBy: { verifiedAt: 'desc' },
    });
  }

  async upsertVerification(userId: string, cmdrName: string, trustTier: number): Promise<void> {
    const now = new Date();
    await this.#db.$transaction(async (tx) => {
      const existing = await tx.cmdrVerification.findFirst({
        where: { userId, isVerified: true, revokedAt: null },
        select: { id: true, cmdrName: true },
      });

      // Same name already verified — nothing to do, and re-inserting would
      // violate the partial unique index.
      if (existing !== null && existing.cmdrName.toLowerCase() === cmdrName.toLowerCase()) return;
      if (existing !== null) {
        await tx.cmdrVerification.update({ where: { id: existing.id }, data: { revokedAt: now } });
      }

      /*
       * @DATA-ADV FINDING, 2026-07-27 — this could raise a raw constraint error.
       *
       * The partial unique index on (cmdr_name) WHERE is_verified AND NOT
       * revoked is the real enforcement, and it fires when two members link
       * keys for the SAME commander — which sounds impossible until you
       * remember that two people can share one Inara account, and that the
       * application-level check runs before the write rather than inside it.
       *
       * Unhandled, that surfaced as a 500 with a Postgres constraint name in
       * it. Caught here it becomes the same clean CMDR_ALREADY_CLAIMED the
       * pre-check produces, so the member is told something they can act on
       * rather than being shown a database error.
       */
      try {
        await tx.cmdrVerification.create({
          data: {
            userId,
            cmdrName,
            method: 'inara_nonce',
            trustTier,
            isVerified: true,
            verifiedAt: now,
          },
        });
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        // P2002 is Prisma's unique-constraint violation. Anything else is a
        // genuine fault and must keep propagating.
        if (code !== 'P2002') throw cause;
        throw new AppError(
          ErrorCode.CMDR_ALREADY_CLAIMED,
          `CMDR ${cmdrName} was verified by another member a moment ago. Speak to an officer if that is wrong.`,
        );
      }
    });
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    await this.#db.auditLog.create({
      data: {
        actorId: entry['actorId'] as string | null,
        actorType: entry['actorId'] === null ? 'system' : 'user',
        action: String(entry['action']),
        targetType: String(entry['targetType']),
        targetId: String(entry['targetId']),
        before: entry['before'] as never,
        after: entry['after'] as never,
      },
    });
  }
}

/**
 * The two notices a completed verification produces, from the one transition.
 *
 * ★ MIRRORED IN apps/worker/src/inara-sync.ts — KEEP THE COPY IDENTICAL ★
 *
 * The worker's squadron sweep confirms members this process never sees (they closed the tab, as
 * the page told them they could), and the worker cannot import from the API. Two small copies
 * with matching wording were chosen over a shared home, because the only shared package these
 * processes both reach is @grims/db and this is not database code. If you change a word here,
 * change it there.
 *
 * Never throws: the member IS verified by the time this runs, whatever the bell manages.
 */
export async function announceVerification(
  db: PrismaClient,
  userId: string,
  nudge?: LiveNudge,
): Promise<void> {
  try {
    await notifyMembers(
      db,
      [userId],
      {
        kind: 'verification.confirmed',
        title: 'Your commander is fully verified',
        body: 'Inara confirms your commander and your squadron membership. Every member area is open to you.',
        link: '/settings/commander',
      },
      nudge,
    );

    const member = await db.user.findUnique({
      where: { id: userId },
      select: { displayName: true, handle: true },
    });
    const name = member?.displayName ?? member?.handle ?? 'A new member';

    await notifySquadron(
      db,
      {
        kind: 'member.verified',
        title: `${name} is verified — welcome them aboard`,
        body: 'Their commander and squadron membership are confirmed.',
        link: '/roster',
        actorUserId: userId,
      },
      nudge,
    );
  } catch {
    // See the header: the verification stands whatever the bell manages.
  }
}
