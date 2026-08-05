import type { PrismaClient } from '@grims/db';
import type { InaraAdapter } from '@grims/ed-clients';
import type { TokenCipher } from '@grims/shared/server';
import type { AwaitingMember, SquadronRecheckStore, SquadronSource } from './squadron-recheck.js';

export class PrismaSquadronRecheckStore implements SquadronRecheckStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly cipher: TokenCipher,
  ) {}

  /**
   * Verified members who claimed a squadron and are not yet confirmed.
   *
   * Exactly the set the partial index covers. Anyone who has not claimed is
   * absent by design — Inara's budget is two requests a minute, and polling
   * people who never applied would starve the ones who just did.
   */
  async listAwaiting(): Promise<AwaitingMember[]> {
    const rows = await this.db.cmdrVerification.findMany({
      where: {
        isVerified: true,
        revokedAt: null,
        squadronVerifiedAt: null,
        squadronClaimedAt: { not: null },
      },
      select: { userId: true, cmdrName: true },
      // One row per member. Verifications are a history, and asking Inara twice
      // about the same person spends a limited budget to learn one thing.
      distinct: ['userId'],
      orderBy: [{ userId: 'asc' }, { verifiedAt: 'desc' }],
    });

    const links = await this.db.inaraLink.findMany({
      where: { userId: { in: rows.map((r) => r.userId) } },
      select: { userId: true, apiKeyEnc: true },
    });

    const keyByUser = new Map(
      links.flatMap((l) => {
        try {
          /*
           * Buffer.from(...), not .toString('utf8') on the raw value: Prisma 6
           * maps Bytes to Uint8Array, whose toString takes NO encoding argument
           * and would silently yield a comma-separated list of byte values.
           */
          const plain = this.cipher.decrypt(
            Buffer.from(l.apiKeyEnc).toString('utf8'),
            `inara-key:${l.userId}`,
          );
          return [[l.userId, plain] as const];
        } catch {
          // A key that will not decrypt is a key we cannot use. Skipped rather
          // than thrown: one damaged row must not stop the whole sweep, and the
          // member falls back to the public lookup.
          return [];
        }
      }),
    );

    return rows.map((r) => ({
      userId: r.userId,
      cmdrName: r.cmdrName,
      apiKey: keyByUser.get(r.userId) ?? null,
    }));
  }

  /**
   * Records the outcome.
   *
   * Confirmation is SET and also CLEARED. A member who leaves the squadron on
   * Inara must stop being shown as confirmed; a one-way flag would keep
   * somebody who left last month looking like a member indefinitely.
   */
  async record(userId: string, reported: string | null, matched: boolean, at: Date): Promise<void> {
    await this.db.cmdrVerification.updateMany({
      where: { userId, isVerified: true, revokedAt: null },
      data: {
        inaraSquadron: reported,
        squadronVerifiedAt: matched ? at : null,
        squadronCheckedAt: at,
      },
    });
  }
}

/**
 * Reads squadron membership from Inara.
 *
 * Two paths on purpose. A member's OWN key is the stronger read — Inara answers
 * for the account the key belongs to rather than for a name we typed — and it
 * works even when the squadron-level key is not configured at all. The public
 * lookup is the fallback for members who never linked one.
 */
export class AdapterSquadronSource implements SquadronSource {
  constructor(private readonly inara: InaraAdapter) {}

  async ownSquadron(apiKey: string): Promise<{ squadronName: string | null } | null> {
    const identity = await this.inara.getOwnIdentity(apiKey);
    return identity === null ? null : { squadronName: identity.squadronName };
  }

  async publicSquadron(cmdrName: string): Promise<{ squadronName: string | null } | null> {
    const profile = await this.inara.getCommanderProfile(cmdrName);
    return profile === null ? null : { squadronName: profile.squadronName };
  }
}
