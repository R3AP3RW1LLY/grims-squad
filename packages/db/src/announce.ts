import type { PrismaClient } from './index.js';

/**
 * Writing announcements — the one door every producer uses.
 *
 * ★ THE APPROVED PIPELINE, IN ONE SENTENCE ★
 *
 * Producers write a durable `announcements` row here; the bot polls the table and posts the
 * content to the Discord channel the row's kind maps to; the API polls the same table and
 * carbon-copies rows that carry a forum half into the forum's Announcements category, authored
 * by the owner's account, then rings every member's bell. Neither poller composes copy — the
 * content leaves this module FINAL, mentions already interpolated, because only the producer
 * knows who an announcement is about.
 *
 * ★ IN packages/db, NOT IN ANY ONE APP — THE SAME REASONING AS notify.ts ★
 *
 * Producers live in three processes: the API (promotions on demand, the verification confirm
 * path), the worker (the monthly run, the Inara sweeps) and the deploy script (which speaks SQL
 * directly). The two TypeScript processes share exactly one package, and a second copy of the
 * promotion-orders wording in the worker would be the drift the notify module's design already
 * exists to avoid. So the templates live beside the door that writes them.
 *
 * ★ RAW SQL, DELIBERATELY ★
 *
 * `announcements` is addressed with `$executeRaw` / `$queryRaw` rather than the generated
 * delegate, exactly as the bot's ops_alerts poller reads its table. `prisma generate` is an
 * operator step gated on the API process being stopped (the engine DLL is locked while it
 * runs), so the generated client on a given machine may predate this table — raw SQL keeps
 * every producer compilable and correct on both sides of that step.
 *
 * ★ FAILURE NEVER PROPAGATES ★
 *
 * An announcement is decoration on a deed that already happened. No promotion, verification or
 * deploy may fail because a row about it could not be written; the return value says whether it
 * landed, and the caller may log it, but nothing here throws.
 */

export interface AnnouncementForum {
  readonly title: string;
  /** The thread's opening post — the same markdown the forum's composer accepts. */
  readonly body: string;
}

export interface AnnouncementInput {
  /** Decides which channel env the bot posts to (see apps/bot/src/announcements.ts). */
  readonly kind: 'deploy' | 'promotion' | 'member-verified';
  /** Final Discord markdown. Mentions already interpolated as `<@id>` tokens. */
  readonly content: string;
  /** Present = a forum carbon-copy is wanted. Verifications deliberately omit it. */
  readonly forum?: AnnouncementForum;
}

/** One announcement row. Returns whether it landed. */
export async function announce(db: PrismaClient, input: AnnouncementInput): Promise<boolean> {
  try {
    await db.$executeRaw`
      INSERT INTO announcements (kind, content, forum_title, forum_body)
      VALUES (${input.kind}, ${input.content}, ${input.forum?.title ?? null}, ${input.forum?.body ?? null})`;
    return true;
  } catch {
    // See the header: the deed already happened; the announcement must not un-happen it.
    return false;
  }
}

/* ─────────────────────────────── the approved templates, as pure functions ── */

/** Somebody an announcement names: their site name, and their Discord id when they linked one. */
export interface AnnouncementPerson {
  readonly displayName: string;
  readonly discordId: string | null;
}

/**
 * `**<@id>**` for a member with a linked Discord identity, `**Name**` for one without.
 *
 * The un-tagged fallback is deliberate: a mention token for an id Discord does not know renders
 * as literal `<@…>` noise, and a member who has not linked Discord still deserves their name in
 * the orders rather than a broken tag.
 */
export function mentionOf(person: AnnouncementPerson): string {
  return person.discordId === null || person.discordId === ''
    ? `**${person.displayName}**`
    : `**<@${person.discordId}>**`;
}

/**
 * One line of the promotion orders — the owner's approved wording, verbatim.
 *
 * `plain` renders the forum copy: display names un-tagged, because forum readers are not
 * Discord and a raw `<@1234…>` token means nothing on the site.
 */
export function promotionLine(
  person: AnnouncementPerson,
  rank: string,
  opts: { readonly plain?: boolean } = {},
): string {
  const who = opts.plain === true ? `**${person.displayName}**` : mentionOf(person);
  return `${who} — promoted to **${rank}**.`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `August 2026`, in UTC — the same clock the activity rollups are keyed on. */
export function monthYearLabel(at: Date): string {
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/**
 * The whole promotion-orders announcement: one per RUN, never one per member.
 *
 * The owner's approved copy, with one member line per promotion. The Discord content mentions;
 * the forum body carries the same words with display names instead of mention tokens.
 */
export function promotionOrders(
  monthLabel: string,
  promoted: ReadonlyArray<{ readonly person: AnnouncementPerson; readonly rank: string }>,
): { content: string; forum: AnnouncementForum } {
  const body = (plain: boolean) =>
    [
      `🎖️ **PROMOTION ORDERS — ${monthLabel}**`,
      '',
      'The squadron recognises its own. Step forward:',
      '',
      ...promoted.map((p) => promotionLine(p.person, p.rank, { plain })),
      '',
      'Congratulations, commanders. The rank was never given — it was earned. o7',
    ].join('\n');

  return {
    content: body(false),
    forum: { title: `Promotion orders — ${monthLabel}`, body: body(true) },
  };
}

/**
 * Writes the promotion-orders row for a live run.
 *
 * ★ ONE IMPLEMENTATION, TWO CALLERS — THE colony-sync DOCTRINE ★
 *
 * The admin console's promotions service and the worker's monthly run both promote people, and
 * both must announce it in identical words. The mention interpolation needs the database (it
 * reads `discord_identities` and `users`), so the lookup lives here with the template rather
 * than being restated per process.
 *
 * Order is preserved: the orders list members in the order the engine promoted them.
 */
export async function announcePromotionOrders(
  db: PrismaClient,
  promoted: ReadonlyArray<{ readonly userId: string; readonly to: string }>,
  monthLabel: string,
): Promise<boolean> {
  if (promoted.length === 0) return false;

  try {
    const userIds = promoted.map((p) => p.userId);
    const [users, identities] = await Promise.all([
      db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, handle: true },
      }),
      db.discordIdentity.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, discordId: true },
      }),
    ]);
    const nameOf = new Map(users.map((u) => [u.id, u.displayName ?? u.handle]));
    const discordOf = new Map(identities.map((i) => [i.userId, i.discordId]));

    const orders = promotionOrders(
      monthLabel,
      promoted.map((p) => ({
        person: {
          displayName: nameOf.get(p.userId) ?? 'A commander',
          discordId: discordOf.get(p.userId) ?? null,
        },
        rank: p.to,
      })),
    );

    return await announce(db, { kind: 'promotion', ...orders });
  } catch {
    // The ranks are granted by the time this runs; the orders must not un-grant them.
    return false;
  }
}

/**
 * The member-verified announcement — the owner's approved wording, verbatim.
 *
 * Exported on its own so the wording is testable without a database.
 */
export function memberVerifiedContent(person: AnnouncementPerson): string {
  return [
    '🫡 **A new commander joins the squadron**',
    '',
    `${mentionOf(person)} just completed verification — Inara confirms them as one of ours.`,
    '',
    'Welcome aboard, CMDR. Wing up, check the boards, and fly dangerous. o7',
  ].join('\n');
}

/**
 * Announces a completed verification to the channel.
 *
 * ★ CHANNEL ONLY, NO FORUM CARBON-COPY ★
 *
 * The squadron feed already carries `member.verified` on-site (the notice beside every call
 * site), so a forum thread per verification would be the same fact a third time.
 *
 * ★ ONE IMPLEMENTATION FOR THE THREE CONFIRM PATHS ★
 *
 * The transition is detected in three places (the API link store, the worker's squadron sweep,
 * the nightly audit) whose NOTICE copy is mirrored by hand because those processes share no
 * home for it. The announcement does have a shared home — this module writes the row — so the
 * three sites call this rather than growing a third mirrored copy.
 */
export async function announceMemberVerified(db: PrismaClient, userId: string): Promise<boolean> {
  try {
    const [user, identity] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { displayName: true, handle: true } }),
      db.discordIdentity.findUnique({ where: { userId }, select: { discordId: true } }),
    ]);

    return await announce(db, {
      kind: 'member-verified',
      content: memberVerifiedContent({
        displayName: user?.displayName ?? user?.handle ?? 'A new commander',
        discordId: identity?.discordId ?? null,
      }),
    });
  } catch {
    // The member IS verified, whatever the announcement manages.
    return false;
  }
}
