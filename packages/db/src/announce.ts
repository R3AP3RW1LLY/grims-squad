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
  readonly kind: 'deploy' | 'promotion' | 'member-verified' | 'colony-project' | 'app-release';
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


/* ─────────────────────────────────── squadron colonisation projects ── */

/**
 * What the colony announcement needs to know about a project.
 *
 * Deliberately not the Prisma row: the template is a pure function so the wording can be tested
 * without a database, and the caller does the one lookup.
 */
export interface ColonyProjectAnnouncement {
  readonly id: string;
  readonly title: string;
  /** Whose build it is. A member's own is announced too, in different words. */
  readonly owner: 'squadron' | 'personal';
  readonly systemName: string;
  /** The catalogue row the requirement fingerprints to. Null until somebody has docked there. */
  readonly identifiedAs: string | null;
  /** Total tonnes the build asks for. Null for the same reason. */
  readonly totalTonnes: number | null;
  /** Whoever posted it — they found the site, and that credit does not move when it is adopted. */
  readonly startedBy: AnnouncementPerson;
  /** The officer who adopted it, when this announcement is about an adoption. */
  readonly adoptedBy?: AnnouncementPerson;
}

/**
 * The middle line: where it is, what it is, and how big.
 *
 * ★ SQUADRON OWNER, 2026-08-05: POST IMMEDIATELY ★
 *
 * A build type and a tonnage are only known once somebody has DOCKED at the site, which usually
 * happens after the project is posted. Holding the announcement until then would deliver it after
 * the early hauling — and the whole point is to rally haulers before that. So an unidentified site
 * says so plainly rather than showing a blank where a number belongs.
 */
function whereAndWhat(project: ColonyProjectAnnouncement): string {
  const parts = [project.systemName];
  if (project.identifiedAs === null) {
    parts.push('build type not identified yet');
  } else {
    parts.push(project.identifiedAs);
    if (project.totalTonnes !== null && project.totalTonnes > 0) {
      parts.push(`${project.totalTonnes.toLocaleString('en-GB')} t`);
    }
  }
  return parts.join(' · ');
}

/**
 * The squadron colonisation announcement — the owner's approved wording.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "when a new squadron colonization project is created, can we send a notification to this discord
 * channel please ... with a link to the project on the website ... include the name of the
 * commander who started the squadron project"
 *
 * ★ TWO EVENTS, ONE TEMPLATE ★
 *
 * Officers can adopt a member's personal project into a squadron one, which is also a new squadron
 * project as far as this channel is concerned — the owner approved announcing both. Adoption names
 * BOTH people, because the credit for finding the site and the decision to commit the squadron to
 * it are different acts by different members, and collapsing them would quietly transfer the first.
 *
 * The link is the point of the message: `PUBLIC_URL` is passed in rather than read here, because
 * this package is imported by three processes and only they know their own base URL.
 */
export function colonyProjectContent(
  project: ColonyProjectAnnouncement,
  siteUrl: string,
): string {
  /*
   * Narrowed into a local rather than asserted. `adoptedBy` decides both the heading and the
   * credit line, and a non-null assertion here would be the one place this file promised the
   * compiler something it had not checked.
   */
  const adoptedBy = project.adoptedBy;
  const link = `${siteUrl.replace(/\/+$/, '')}/colonisation/${project.id}`;

  return [
    adoptedBy !== undefined
      ? '🏗️ **Adopted as a squadron project**'
      : project.owner === 'squadron'
        ? '🏗️ **A new squadron colonisation project**'
        : /*
           * ★ A MEMBER'S OWN BUILD — SQUADRON OWNER, 2026-08-05 ★
           *
           * "can we also announce player owned colonization projects in the same channel the same
           * way we do the squadron owned colonization projects?"
           *
           * Same channel, different words. A member posting a build is exactly when they would
           * like some help with it, and the channel is where haulers look — but the squadron's own
           * efforts must not be diluted into a list of everybody's side projects, so the heading
           * says plainly whose this is.
           */
          '🏗️ **A member has started a colonisation project**',
    '',
    `**${project.title}**`,
    whereAndWhat(project),
    '',
    adoptedBy === undefined
      ? `Started by ${mentionOf(project.startedBy)}`
      : `Found by ${mentionOf(project.startedBy)}, adopted by ${mentionOf(adoptedBy)}`,
    '',
    link,
  ].join('\n');
}

/**
 * Announces a squadron colonisation project.
 *
 * ★ SQUADRON PROJECTS ONLY ★
 *
 * A personal build is one member's, and posting it to a squadron channel would read as a call to
 * arms nobody issued. The caller decides — this is reached from the create path only when the
 * owner is `squadron`, and from the adopt path when it becomes one.
 *
 * ★ NO FORUM CARBON-COPY ★
 *
 * Same reasoning as verifications: the colonisation board already carries the project, and a
 * thread per project would be the same fact in a third place.
 *
 * Never throws. The project exists whatever this manages — see the module header.
 */
export async function announceColonyProject(
  db: PrismaClient,
  projectId: string,
  siteUrl: string,
  adoptedByUserId?: string,
): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        title: string;
        owner: string;
        visibility: string;
        system_name: string;
        identified_as: string | null;
        total_tonnes: number | null;
        poster_name: string;
        poster_discord: string | null;
      }>
    >`
      SELECT p.id,
             p.title,
             p.owner::text AS owner,
             p.visibility::text AS visibility,
             p.system_name,
             bt.display_name AS identified_as,
             bt.total_tonnes AS total_tonnes,
             COALESCE(u.display_name, u.handle) AS poster_name,
             di.discord_id AS poster_discord
        FROM colony_projects p
        JOIN users u ON u.id = p.posted_by_id
        LEFT JOIN discord_identities di ON di.user_id = u.id
        LEFT JOIN colony_build_types bt ON bt.id = p.build_type_id
       WHERE p.id = ${projectId}::uuid`;

    const row = rows[0];
    if (row === undefined) return false;

    /*
     * ★ PRIVATE MEANS PRIVATE ★
     *
     * A member who set their build to private has already said who may see it. Posting it to a
     * channel every member reads would hand it to everybody — announcing the very thing the
     * visibility setting exists to prevent. Squadron and public builds are both fair game.
     */
    if (row.visibility === 'private') return false;

    let adoptedBy: AnnouncementPerson | undefined;
    if (adoptedByUserId !== undefined) {
      const officers = await db.$queryRaw<
        Array<{ name: string; discord_id: string | null }>
      >`
        SELECT COALESCE(u.display_name, u.handle) AS name, di.discord_id
          FROM users u
          LEFT JOIN discord_identities di ON di.user_id = u.id
         WHERE u.id = ${adoptedByUserId}::uuid`;
      const officer = officers[0];
      if (officer !== undefined) {
        adoptedBy = { displayName: officer.name, discordId: officer.discord_id };
      }
    }

    return await announce(db, {
      kind: 'colony-project',
      content: colonyProjectContent(
        {
          id: row.id,
          title: row.title,
          owner: row.owner === 'squadron' ? 'squadron' : 'personal',
          systemName: row.system_name,
          identifiedAs: row.identified_as,
          totalTonnes: row.total_tonnes === null ? null : Number(row.total_tonnes),
          startedBy: { displayName: row.poster_name, discordId: row.poster_discord },
          ...(adoptedBy === undefined ? {} : { adoptedBy }),
        },
        siteUrl,
      ),
    });
  } catch {
    // The project exists. The announcement must not un-create it.
    return false;
  }
}


/* ────────────────────────────────────── companion app releases ── */

/**
 * Where the last announced companion version is remembered.
 *
 * A `site_config` row rather than a column, for the same reason the bounty anchor count is one: it
 * describes the SQUADRON's state, not any single record, and it has to survive a container that is
 * replaced on every deploy.
 */
export const COMPANION_ANNOUNCED_KEY = 'companion.announced_version';

/**
 * The companion release announcement — the owner's approved wording.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "we need to make an announcement too everytime the companion app is updated please! same channel
 * as the web announcements, provide a link to manually download and update the app if they want
 * too please!"
 *
 * ★ WHY IT SAYS THEY DO NOT HAVE TO DO ANYTHING ★
 *
 * The app updates itself — hourly check, silent download, and since 0.5.1 it installs on its own
 * after a sixty-second warning rather than waiting for the game to close. An announcement that
 * opened with a download link would read as an instruction, and members would start doing by hand
 * something that has already happened. So the automatic path is stated first and the link is
 * offered second, for the cases that genuinely need it: a machine that has been off for a while,
 * an install that was never paired, or somebody who would simply rather do it themselves.
 */
export function appReleaseContent(version: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  return [
    `🛰️ **The companion app updated — v${version}**`,
    '',
    'Your app installs this on its own, usually within the hour. You do not need to do anything.',
    '',
    `If you would rather do it now, or your app has been closed for a while: ${base}/companion`,
    '',
    `What changed: ${base}/changelog`,
  ].join('\n');
}

/**
 * Announces a companion release, exactly once per version.
 *
 * ★ TRIGGERED BY THE APP'S OWN POLL, NOT BY A SCHEDULER ★
 *
 * Every paired app asks the hub for its settings every five minutes, and that call already computes
 * the newest published version from the release bucket. So the moment a release lands, the next
 * poll notices — no cron entry to install, no CI secret to keep, and no second place that has to
 * agree about which build is current.
 *
 * ★ EXACTLY ONCE, ACROSS EVERY CALLER ★
 *
 * Dozens of apps poll, and they all see the new version at the same time. The guard is the INSERT
 * itself: `site_config` is written with `WHERE` the stored value still differs, so the first writer
 * wins and every other caller updates nothing and announces nothing. A read-then-write would race
 * and post the same release a dozen times.
 *
 * ★ to_jsonb, BECAUSE THE COLUMN IS jsonb — AND I SHIPPED IT WITHOUT ★
 *
 * `site_config.value` is `jsonb`, not `text`. The first version of this passed a bare string,
 * Postgres refused the cast, and the `catch` below swallowed it — so the release announced nothing
 * and the failure was invisible. Exactly the shape of bug this file's own header warns about, and
 * it survived a green test run because the tests never touched a database.
 *
 * The Prisma delegate would convert it for us (that is how the EDSY refresh writes the same table)
 * but the delegate cannot express the conditional claim below, which is what stops a dozen polling
 * apps announcing one release a dozen times. So the SQL stays and the cast is explicit.
 *
 * Never throws. The release is published whatever this manages — see the module header.
 */
export async function announceCompanionRelease(
  db: PrismaClient,
  version: string | null,
  siteUrl: string,
): Promise<boolean> {
  if (version === null || version.trim() === '' || siteUrl.trim() === '') return false;

  try {
    /*
     * Claim the version first. `ON CONFLICT ... WHERE` makes this the whole mutual exclusion: it
     * updates only when the stored value differs, and reports how many rows it touched. Zero means
     * somebody else already claimed this version — including the very first run, where the row is
     * inserted and the announcement follows.
     */
    const claimed = await db.$executeRaw`
      INSERT INTO site_config (key, value)
      VALUES (${COMPANION_ANNOUNCED_KEY}, to_jsonb(${version}::text))
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
       WHERE site_config.value IS DISTINCT FROM EXCLUDED.value`;

    if (claimed === 0) return false;

    return await announce(db, {
      kind: 'app-release',
      content: appReleaseContent(version, siteUrl),
    });
  } catch {
    // The release is out. Failing to say so must not be worse than that.
    return false;
  }
}
