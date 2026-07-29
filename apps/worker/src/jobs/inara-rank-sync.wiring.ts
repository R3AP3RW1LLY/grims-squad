import type { PrismaClient } from '@grims/db';
import type { InaraAdapter } from '@grims/ed-clients';
import { describeInaraRanks } from '@grims/shared';
import type {
  InaraProfileRow,
  InaraProfileSource,
  InaraRankStore,
  SyncableCommander,
} from './inara-rank-sync.js';

/**
 * Wraps the adapter so the job depends on one method, not on Inara.
 *
 * ★ AND THIS IS WHERE INARA'S WORDS BECOME OURS ★
 *
 * The adapter reports `[{rankName:"exploration",rankValue:5}]` — Inara's
 * vocabulary, faithfully. Translating that onto our own ladders is a decision
 * about our domain, so it happens on our side of the boundary rather than
 * inside a package whose whole purpose is to know about external APIs and
 * nothing else (ADR-013).
 *
 * Doing it HERE rather than in the job also means what gets stored is already
 * resolved, so the roster renders it without knowing Inara exists.
 */
export class AdapterInaraSource implements InaraProfileSource {
  constructor(private readonly inara: InaraAdapter) {}

  async getCommanderProfiles(names: readonly string[]) {
    const profiles = await this.inara.getCommanderProfiles(names);

    return new Map(
      [...profiles].map(([name, p]) => [
        name,
        p === null
          ? null
          : {
              squadronName: p.squadronName,
              squadronRank: p.squadronRank,
              ranks: describeInaraRanks(p.pilotRanks),
            },
      ]),
    );
  }
}

export class PrismaInaraRankStore implements InaraRankStore {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Who to ask Inara about.
   *
   * ★ VERIFIED COMMANDERS ONLY ★
   *
   * An unverified name is one somebody typed, and typed names are wrong often
   * enough to matter. Asking Inara about them spends the global rate budget on
   * misspellings and, worse, could bind a real Inara profile to a member who
   * merely claimed that name. Verification is what makes the name a fact
   * (INV-005), and only facts are worth asking about.
   */
  async listCommanders(): Promise<SyncableCommander[]> {
    return this.db.cmdrVerification.findMany({
      /*
       * `revokedAt: null` is not optional here. A revoked claim is a name the
       * member no longer holds — often because it turned out to be someone
       * else's — and continuing to sync it would keep a stranger's Inara ranks
       * attached to their card indefinitely.
       */
      /*
       * ★ ONLY MEMBERS WHOSE INARA KEY WE HAVE VALIDATED ★
       *
       * Squadron owner's instruction, 2026-07-29. A verified commander NAME can
       * come from an officer's say-so; a validated KEY is Inara itself telling
       * us the account is theirs. Asking Inara about anybody else spends a
       * budget of two requests a minute on people who never asked us to.
       *
       * `verifiedAt` on the link — not merely the row's existence — because a
       * key that has never successfully answered is a key we cannot trust to
       * name the right commander.
       */
      where: {
        isVerified: true,
        revokedAt: null,
        user: { inaraLink: { verifiedAt: { not: null } } },
      },
      select: { userId: true, cmdrName: true },
      /*
       * One row per member. Verifications are a HISTORY, not a current-state
       * table, so a member who reverified is several rows — which would ask
       * Inara about them twice, spending a limited budget to write the same
       * primary key twice in one transaction, with the loser decided by
       * ordering nobody chose. Newest wins, explicitly.
       */
      orderBy: [{ userId: 'asc' }, { verifiedAt: 'desc' }],
      distinct: ['userId'],
    });
  }

  /**
   * Writes the sweep's results.
   *
   * One transaction: a sweep that half-applied would leave the roster showing
   * some members refreshed and some not, with nothing to say which — and the
   * next sweep twenty minutes later would paper over it. All or nothing is both
   * simpler to reason about and cheap at a hundred rows.
   */
  async save(rows: readonly InaraProfileRow[]): Promise<void> {
    await this.db.$transaction(
      rows.map((r) =>
        this.db.inaraCommanderProfile.upsert({
          where: { userId: r.userId },
          create: {
            userId: r.userId,
            searchName: r.searchName,
            ranks: r.ranks as object[],
            squadronName: r.squadronName,
            squadronRank: r.squadronRank,
            isFound: r.isFound,
            fetchedAt: r.fetchedAt,
          },
          update: {
            searchName: r.searchName,
            ranks: r.ranks as object[],
            squadronName: r.squadronName,
            squadronRank: r.squadronRank,
            isFound: r.isFound,
            fetchedAt: r.fetchedAt,
          },
        }),
      ),
    );
  }
}
