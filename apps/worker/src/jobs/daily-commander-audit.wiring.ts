import type { PrismaClient } from '@grims/db';
import {
  announceMemberVerified,
  notifyMembers,
  notifySquadron,
  upsertCmdrVerification,
  TIER_INARA,
} from '@grims/db';
import { notificationNudge } from '../lib/live-notify.js';
import type { DiscordAdapter, InaraAdapter } from '@grims/ed-clients';
import type { TokenCipher } from '@grims/shared/server';
import { rankForDisplay, LEADERSHIP_CEILING } from '@grims/shared';
import type {
  AuditStore,
  AuditSource,
  AuditableCommander,
  NameOutcome,
  NicknameSetter,
} from './daily-commander-audit.js';

export class PrismaAuditStore implements AuditStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly cipher: TokenCipher,
  ) {}

  /**
   * Every verified commander, with everything the sweep needs in one read.
   *
   * Four queries rather than one join, because the join would be a five-table
   * fan-out to produce a hundred rows — and the role mapping and guild member
   * cache are small enough to resolve in memory.
   */
  async listCommanders(): Promise<AuditableCommander[]> {
    const verifications = await this.db.cmdrVerification.findMany({
      where: { isVerified: true, revokedAt: null },
      select: { userId: true, cmdrName: true },
      // One row per member. Verifications are a HISTORY, and asking Inara twice
      // about the same person spends a limited budget to learn one thing.
      distinct: ['userId'],
      orderBy: [{ userId: 'asc' }, { verifiedAt: 'desc' }],
    });

    const userIds = verifications.map((v) => v.userId);

    const [identities, links, mappings] = await Promise.all([
      this.db.discordIdentity.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, discordId: true, guildNick: true },
      }),
      this.db.inaraLink.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, apiKeyEnc: true },
      }),
      this.db.roleMapping.findMany({
        where: { role: { isHierarchical: true } },
        select: { discordRoleId: true, role: { select: { name: true, rankOrder: true } } },
      }),
    ]);

    const identityByUser = new Map(identities.map((i) => [i.userId, i]));
    const rankByRoleId = new Map(mappings.map((m) => [m.discordRoleId, m.role]));

    /*
     * The roles a member WEARS, from the guild cache — not their granted
     * internal roles. Grants only appear after reconciliation for an account
     * that exists, and most of the squadron has neither, so reading grants
     * would leave almost everybody with no rank prefix at all.
     */
    const members = await this.db.discordGuildMember.findMany({
      where: { discordId: { in: identities.map((i) => i.discordId) } },
      select: { discordId: true, roles: true, nick: true },
    });
    const memberByDiscordId = new Map(members.map((m) => [m.discordId, m]));

    /*
     * Who has chosen their own nickname.
     *
     * Read for everybody in one query rather than per member: the sweep already makes one Inara
     * request per commander and is the slowest job on the platform — adding a round trip per person
     * to read one nullable column would be the cheapest possible way to make it slower.
     */
    const overrides = new Map(
      (
        await this.db.user.findMany({
          where: { id: { in: userIds }, nicknameOverride: { not: null } },
          select: { id: true, nicknameOverride: true },
        })
      ).map((u) => [u.id, u.nicknameOverride]),
    );

    const keyByUser = new Map(
      links.flatMap((l) => {
        try {
          // Buffer.from(...), not .toString('utf8') on the raw value: Prisma 6
          // maps Bytes to Uint8Array, whose toString takes NO encoding argument
          // and would yield a comma-separated list of byte values.
          const plain = this.cipher.decrypt(
            Buffer.from(l.apiKeyEnc).toString('utf8'),
            `inara-key:${l.userId}`,
          );
          return [[l.userId, plain] as const];
        } catch {
          // A key that will not decrypt is one we cannot use. Skipped rather
          // than thrown: one damaged row must not stop the sweep, and the
          // member falls back to the public lookup.
          return [];
        }
      }),
    );

    return verifications.map((v) => {
      const identity = identityByUser.get(v.userId);
      const member =
        identity === undefined ? undefined : memberByDiscordId.get(identity.discordId);

      const held = (member?.roles ?? []).flatMap((id) => {
        const r = rankByRoleId.get(id);
        return r === undefined ? [] : [r];
      });

      return {
        userId: v.userId,
        cmdrName: v.cmdrName,
        discordId: identity?.discordId ?? null,
        apiKey: keyByUser.get(v.userId) ?? null,
        // The guild cache is fresher than our identity row — the bot updates it
        // on every GuildMemberUpdate — so it wins where both have a value.
        currentNick: member?.nick ?? identity?.guildNick ?? null,
        rank: rankForDisplay(held, LEADERSHIP_CEILING),
        // Null for almost everybody. Set means the sweep leaves their nickname entirely alone.
        nicknameOverride: overrides.get(v.userId) ?? null,
      };
    });
  }

  /**
   * Stores the commander name Inara now reports, and tells the member.
   *
   * ★ THE SAME TWO WRITES A MEMBER'S OWN RE-CHECK MAKES ★
   *
   * `InaraLinkService.refresh()` — the path a member takes when they press the button on their
   * settings page — does exactly this: `recordSuccess` onto their link row, then the verification
   * upsert. This is that pair, for the member who never presses anything. The verification half is
   * literally the same function (`@grims/db`), so the two cannot drift on the part that matters.
   *
   * The link row's `cmdrName` is what the roster reads and what `verifiedNameFor` hands the
   * nickname service. Writing only the verification would leave the member's own settings page
   * showing the old name, which is the version of this bug that is hardest to believe.
   */
  async recordName(userId: string, cmdrName: string, at: Date): Promise<NameOutcome> {
    try {
      /*
       * The verification FIRST, because it is the write that can be refused. If the new name
       * belongs to another member the partial unique index says so here, and the link row is left
       * holding the old name — which is the state we want when a rename cannot be completed.
       */
      await upsertCmdrVerification(this.db, userId, cmdrName, TIER_INARA);

      /*
       * `updateMany`, not `update`. A member can be verified without ever holding a key — an
       * officer vouched for them — and this method is only ever called for somebody who HAS one,
       * but a row that vanished between the sweep's read and this write is not worth throwing over.
       *
       * `verifiedAt` moves because Inara verified this name just now, and `lastError` clears for
       * the same reason: the key plainly works.
       */
      await this.db.inaraLink.updateMany({
        where: { userId },
        data: { cmdrName, verifiedAt: at, lastCheckedAt: at, lastError: null },
      });
    } catch (cause) {
      /*
       * Almost always CMDR_ALREADY_CLAIMED: two members cannot both be one commander (INV-005).
       *
       * The message is not interpolated from `cause`. This runs unattended and its output is read
       * by an officer, and an upstream string is not something to put in front of them verbatim —
       * the reason is stated in our own words, at the level they can act on.
       */
      const code = (cause as { code?: string }).code;
      return {
        applied: false,
        reason:
          code === 'CMDR_ALREADY_CLAIMED'
            ? `Another member is already verified as CMDR ${cmdrName}. An officer needs to look at this.`
            : 'The new name could not be stored. Their previous name still stands.',
      };
    }

    /*
     * ★ THE MEMBER IS TOLD, ONCE ★
     *
     * Not a new notification kind for the sake of one: `verification.confirmed` already exists for
     * "something about your commander changed and here is where to look", and this is the same
     * family and the same destination. A separate kind would need its own icon, its own place in
     * the panel, and would say the same thing.
     *
     * Nothing here may throw. The rename is DONE by this point — it is in two tables — and a bell
     * that failed to ring must not report the rename as unapplied and have it attempted again
     * tomorrow.
     */
    try {
      await notifyMembers(
        this.db,
        [userId],
        {
          kind: 'verification.confirmed',
          title: `Your commander name is now ${cmdrName}`,
          body: 'Inara reports you renamed your commander, so the roster and your Discord nickname have been brought into line.',
          link: '/settings/commander',
        },
        notificationNudge,
      );
    } catch {
      // See above: the name is stored whether or not the bell rang.
    }

    return { applied: true, reason: null };
  }

  async recordSquadron(
    userId: string,
    reported: string | null,
    matched: boolean,
    at: Date,
  ): Promise<void> {
    /*
     * ★ THE NIGHTLY AUDIT'S HALF OF THE CONFIRM PATH — READ BEFORE WRITE ★
     *
     * Squadron owner, 2026-08-04: nothing in the catalogue left unwired. The audit re-checks
     * EVERYONE nightly, so unlike the twenty-minute sweep its input is not a transition list —
     * the transition has to be observed here, by reading whether the squadron half was
     * unconfirmed before this write confirms it. Without the guard, every verified member would
     * be re-congratulated at 00:15, nightly, forever.
     */
    const wasUnconfirmed = matched
      ? (await this.db.cmdrVerification.findFirst({
          where: { userId, isVerified: true, revokedAt: null, squadronVerifiedAt: null },
          select: { userId: true },
        })) !== null
      : false;

    await this.db.cmdrVerification.updateMany({
      where: { userId, isVerified: true, revokedAt: null },
      data: {
        inaraSquadron: reported,
        // Set AND cleared. A member who leaves must stop showing as confirmed;
        // a one-way flag would leave last month's departure looking current.
        squadronVerifiedAt: matched ? at : null,
        squadronCheckedAt: at,
      },
    });

    if (wasUnconfirmed && matched) {
      /*
       * ★ MIRRORED IN apps/api/src/cmdr/inara-link.store.prisma.ts AND inara-sync.ts —
       * KEEP THE COPY IDENTICAL ★ Failure swallowed: the member IS verified either way.
       */
      try {
        await notifyMembers(
          this.db,
          [userId],
          {
            kind: 'verification.confirmed',
            title: 'Your commander is fully verified',
            body: 'Inara confirms your commander and your squadron membership. Every member area is open to you.',
            link: '/settings/commander',
          },
          notificationNudge,
        );

        const member = await this.db.user.findUnique({
          where: { id: userId },
          select: { displayName: true, handle: true },
        });
        const name = member?.displayName ?? member?.handle ?? 'A new member';

        await notifySquadron(
          this.db,
          {
            kind: 'member.verified',
            title: `${name} is verified — welcome them aboard`,
            body: 'Their commander and squadron membership are confirmed.',
            actorUserId: userId,
          },
          notificationNudge,
        );

        /*
         * And the Discord channel — through the shared announce door in @grims/db, so all three
         * confirm paths post identical words without a fourth mirrored copy. Channel only, no
         * forum carbon-copy: the squadron feed above already carries it on-site.
         */
        await announceMemberVerified(this.db, userId);
      } catch {
        // See above: the verification stands whether or not the bell rang.
      }
    }
  }

  async rememberNickname(discordId: string, nickname: string): Promise<void> {
    // Both caches, or the next sweep reads the OLD value, sees a mismatch it
    // just fixed, and renames again — every night, forever.
    await Promise.all([
      this.db.discordIdentity.updateMany({ where: { discordId }, data: { guildNick: nickname } }),
      this.db.discordGuildMember.updateMany({ where: { discordId }, data: { nick: nickname } }),
    ]);
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    /*
     * `before` and `after` are built conditionally rather than passed as
     * `?? undefined`. Under exactOptionalPropertyTypes an explicit `undefined`
     * is not the same as an absent key, and Prisma's generated input type
     * refuses it — correctly, since "this column is absent from the write" and
     * "write undefined to this column" are different instructions.
     */
    const before = entry['before'];
    const after = entry['after'];

    await this.db.auditLog.create({
      data: {
        actorId: null,
        actorType: 'system',
        action: String(entry['action']),
        targetType: (entry['targetType'] as string | undefined) ?? null,
        targetId: (entry['targetId'] as string | undefined) ?? null,
        ...(before === undefined || before === null ? {} : { before: before as object }),
        ...(after === undefined || after === null ? {} : { after: after as object }),
      },
    });
  }
}

export class AdapterAuditSource implements AuditSource {
  constructor(private readonly inara: InaraAdapter) {}

  /**
   * One request, both facts.
   *
   * ★ 'queue', AND IT IS THE WHOLE JOB ★
   *
   * `getOwnIdentity` defaults to the REQUEST-PATH wait — eight seconds, then give up — because its
   * first caller was a member's settings page. The limiter spaces calls thirty seconds apart
   * (INV-033), so this sweep, which asks about members one after another, was refused a slot for
   * every member after the first and swallowed each refusal as "Inara did not answer". A hundred
   * commanders, one of them actually checked, and a report that looked healthy.
   *
   * Nothing here waits on a person, so it waits for the slot. That is also the whole of this job's
   * rate-limit handling and deliberately so: there is ONE limiter in the process, every Inara call
   * goes through it, and a second notion of pacing living here would be a second thing to get
   * wrong.
   *
   * ★ AND IT IS RESUMABLE BECAUSE IT WRITES AS IT GOES ★
   *
   * Each member's name, squadron and nickname are written before the next member is asked about.
   * A run that dies at member sixty has genuinely finished sixty; the next run re-reads the stored
   * names and finds nothing to do for them. There is no batch to lose.
   */
  async ownIdentity(
    apiKey: string,
  ): Promise<{ cmdrName: string; squadronName: string | null } | null> {
    const identity = await this.inara.getOwnIdentity(apiKey, 'queue');
    return identity === null
      ? null
      : { cmdrName: identity.cmdrName, squadronName: identity.squadronName };
  }

  /**
   * Public profiles, thirty to a request.
   *
   * Members without a key of their own are the cheap case: they batch, so a
   * hundred of them cost four requests rather than a hundred.
   */
  async publicSquadrons(names: readonly string[]) {
    const profiles = await this.inara.getCommanderProfiles(names);
    return new Map(
      [...profiles].map(([name, p]) => [
        name,
        p === null ? null : { squadronName: p.squadronName },
      ]),
    );
  }
}

export class AdapterNicknameSetter implements NicknameSetter {
  constructor(
    private readonly discord: DiscordAdapter,
    private readonly guildId: string,
  ) {}

  async set(discordId: string, nickname: string) {
    return this.discord.setMemberNickname(this.guildId, discordId, nickname);
  }
}
