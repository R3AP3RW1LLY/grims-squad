import { PrismaClient } from '@grims/db';
import { effectiveGrantAt, GO_LIVE_AT } from '@grims/shared';

/**
 * The one-time correction that makes promotions retroactive to the July go-live.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "we need to start the promotions today! and needs to be retroactive to july when the website
 * went live! based on the actual promotion criteria!"
 * "to qualify for a promotion the commander must have a linked inara account on our profile
 * this is non-negotiable."
 *
 *   usage: node apps/worker/dist/retro-correct.js          # DRY RUN, writes nothing
 *          node apps/worker/dist/retro-correct.js --live   # applies it
 *
 * ★ IT FIXES THE RECORD, IT DOES NOT PROMOTE ANYBODY ★
 *
 * Nothing here grants a rank. It corrects two things the data got wrong, and then the ordinary
 * promotion engine — same gates, same floor, same audit, same announcement — decides who that makes
 * eligible. A script that both decided and applied would be a second promotion engine, and the
 * first one nobody could review.
 *
 * ★ CORRECTION 1: THE GRANT DATES ARE THE WEBSITE'S LAUNCH, NOT THE MEMBER'S HISTORY ★
 *
 * Every ladder rank is stamped between 2026-07-29 and 2026-08-08 — the ten days the roster was
 * first built. Qualifying months are counted `month >= grantedAt`, and the month row is keyed to
 * the 1st, so for the eleven members granted in August even the August row falls before their own
 * grant. They read "0 of 1 qualifying months" on hundreds of messages. See promotion-backdate.ts.
 *
 * ★ CORRECTION 2: THE GAME CHECK NEVER RAN ★
 *
 * `game_activity` is 'unknown' for 44 of 56 July rows and 19 of 31 August rows. 'unknown' is the
 * column DEFAULT and means "not checked yet this month" — not "they did not play".
 *
 * The only thing that has ever set it is the companion app's journal ingest, so 'observed' means
 * "runs the companion app". The Inara-based check the SSOT names as the SOURCE
 * (gameActivity.source: inara_edsm) was never built, and the sweep that would carry it was never
 * installed on the server. That is our failing, not the member's, and the SSOT is unambiguous about
 * what to do:
 *
 *     upstreamUnavailable: FAIL OPEN — treat the month as qualifying. Our outage must not cost a
 *     member their promotion. Recorded as `assumed` ... so the audit row and the admin dashboard
 *     both show WHY it counted — a promotion granted on an assumption must never be
 *     indistinguishable from one earned on evidence.
 *
 * So those months become 'assumed' — the state that exists for precisely this, and which every
 * surface already renders differently from 'observed'. NEVER 'observed': we did not observe it.
 *
 * ★ AND ONLY FOR A LINKED COMMANDER ★
 *
 * Fail-open plus no link would promote exactly the people nobody can ever check, which is the
 * owner's non-negotiable rule inverted. A member with no linked Inara account keeps 'unknown' and
 * is refused by the engine's own gate as well. Two barriers, deliberately.
 */

const MONTHS = ['2026-07-01', '2026-08-01'] as const;

interface Row {
  readonly userId: string;
  readonly handle: string;
  readonly rank: string;
  readonly grantedAt: Date;
  readonly joinedAt: Date | null;
  readonly linked: boolean;
}

async function main(): Promise<number> {
  const live = process.argv.includes('--live');
  const prisma = new PrismaClient();

  try {
    const ladder = await prisma.role.findMany({
      where: { name: { in: LADDER_RANKS as unknown as string[] } },
      select: { id: true, name: true },
    });
    const ladderIds = new Set(ladder.map((r) => r.id));
    const rankOf = new Map(ladder.map((r) => [r.id, r.name]));

    const grants = await prisma.userRole.findMany({
      where: { roleId: { in: [...ladderIds] } },
      select: { userId: true, roleId: true, grantedAt: true, user: { select: { handle: true } } },
    });

    const userIds = grants.map((g) => g.userId);

    const [identities, guildRows, inara, cmdr] = await Promise.all([
      prisma.discordIdentity.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, discordId: true },
      }),
      prisma.discordGuildMember.findMany({ select: { discordId: true, joinedAt: true } }),
      prisma.inaraLink.findMany({
        where: { userId: { in: userIds }, cmdrName: { not: null } },
        select: { userId: true },
      }),
      prisma.cmdrVerification.findMany({
        where: { userId: { in: userIds }, revokedAt: null },
        select: { userId: true },
      }),
    ]);

    const joinedByDiscord = new Map(guildRows.map((g) => [g.discordId, g.joinedAt]));
    const discordOf = new Map(identities.map((i) => [i.userId, i.discordId]));
    const linked = new Set([...inara.map((r) => r.userId), ...cmdr.map((r) => r.userId)]);

    const rows: Row[] = grants.map((g) => {
      const discordId = discordOf.get(g.userId);
      return {
        userId: g.userId,
        handle: g.user.handle,
        rank: rankOf.get(g.roleId) ?? '?',
        grantedAt: g.grantedAt,
        joinedAt: discordId === undefined ? null : joinedByDiscord.get(discordId) ?? null,
        linked: linked.has(g.userId),
      };
    });

    console.log(
      `**Retroactive correction${live ? '' : ' — DRY RUN'}** — go-live ${GO_LIVE_AT.toISOString().slice(0, 10)}.\n`,
    );

    // ---------------------------------------------------------------- grants
    console.log('GRANT DATES (the website launch, corrected to what was true):');
    let grantChanges = 0;

    for (const r of rows.sort((a, b) => a.handle.localeCompare(b.handle))) {
      const corrected = effectiveGrantAt(r.grantedAt, r.joinedAt);
      if (corrected === null) {
        console.log(
          `  · ${r.handle.padEnd(20)} ${r.rank.padEnd(21)} ${iso(r.grantedAt)} — unchanged${
            r.joinedAt === null ? ' (no Discord join date on record)' : ''
          }`,
        );
        continue;
      }

      grantChanges += 1;
      console.log(
        `  ✎ ${r.handle.padEnd(20)} ${r.rank.padEnd(21)} ${iso(r.grantedAt)} → ${iso(corrected)}`,
      );

      if (live) {
        const roleId = [...ladderIds].find((id) => rankOf.get(id) === r.rank);
        if (roleId === undefined) continue;

        await prisma.userRole.update({
          where: { userId_roleId: { userId: r.userId, roleId } },
          data: { grantedAt: corrected },
        });

        /*
         * The old value is recorded, which is what makes this reversible. A correction to somebody's
         * standing that cannot be undone is one nobody should be willing to run.
         */
        await prisma.auditLog.create({
          data: {
            actorId: null,
            actorType: 'system',
            action: 'rank.grant_date_corrected',
            targetType: 'user',
            targetId: r.userId,
            before: { grantedAt: r.grantedAt.toISOString(), rank: r.rank } as never,
            after: {
              grantedAt: corrected.toISOString(),
              rank: r.rank,
              reason:
                'Roster-building artefact from the website go-live; corrected to the go-live date ' +
                'or the member’s Discord join date, whichever is later.',
            } as never,
          },
        });
      }
    }

    // -------------------------------------------------------- game activity
    console.log('\nGAME ACTIVITY (never checked — fail open per D26, linked commanders only):');
    let monthChanges = 0;

    for (const month of MONTHS) {
      const unchecked = await prisma.memberActivityMonth.findMany({
        where: { month: new Date(month), gameActivity: 'unknown', userId: { in: [...linked] } },
        select: { discordId: true, userId: true, messageCount: true },
      });

      for (const row of unchecked) {
        monthChanges += 1;
        // `userId` is nullable on the activity row — a guild member with no website account. The
        // query already restricts to linked users, so this is belt-and-braces rather than expected.
        const who = rows.find((r) => r.userId === row.userId)?.handle ?? row.userId ?? row.discordId;
        console.log(
          `  ✎ ${who.padEnd(20)} ${month.slice(0, 7)}  unknown → assumed  (${row.messageCount} messages)`,
        );

        if (live) {
          await prisma.memberActivityMonth.update({
            where: { discordId_month: { discordId: row.discordId, month: new Date(month) } },
            data: { gameActivity: 'assumed', gameCheckedAt: new Date() },
          });
        }
      }
    }

    const stillUnknown = rows.filter((r) => !r.linked);
    if (stillUnknown.length > 0) {
      console.log(
        `\n  NOT given the benefit of the doubt — no linked Inara account (${stillUnknown.length}):`,
      );
      for (const r of stillUnknown) {
        console.log(`    ✖ ${r.handle} — must link an Inara account before any promotion.`);
      }
    }

    console.log(
      `\n${grantChanges} grant date(s), ${monthChanges} month(s).${
        live ? ' Written.' : ' NOTHING WAS WRITTEN — pass --live to apply.'
      }`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

const LADDER_RANKS = [
  'Cadet',
  'Sergeant',
  'Master Sergeant',
  '2nd Lieutenant',
  '1st Lieutenant',
  'Commander',
  'Master Commander',
  'General',
  'Lord General',
  'Grand Master General',
];

const iso = (d: Date): string => d.toISOString().slice(0, 10);

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
