/**
 * The nightly sweep over every verified commander.
 *
 * ★ WHAT DRIFTS, AND WHY NOTHING ELSE CATCHES IT ★
 *
 * Two facts go stale between logins, and a member has no reason to notice
 * either:
 *
 *   SQUADRON   somebody leaves Grim's Squad on Inara, or is removed from it.
 *              Nothing on our side is told. They keep a green "verified" badge
 *              and a place on the roster indefinitely.
 *
 *   NICKNAME   somebody renames themselves in Discord, or is promoted, or an
 *              officer edits their nickname by hand. The rank prefix is then
 *              wrong until the next time they happen to touch their Inara key,
 *              which for most members is never.
 *
 * The twenty-minute sweep only looks at people waiting on a squadron
 * application. This looks at everybody, once a day.
 *
 * ★ WHY DAILY AND NOT MORE OFTEN ★
 *
 * Inara allows two requests a minute globally (INV-033). A member's OWN key
 * cannot be batched — `getOwnIdentity` answers for one key — so a hundred
 * members with keys is a hundred requests, which is roughly fifty minutes. That
 * is fine once a night and impossible every twenty.
 *
 * Members WITHOUT a key are read from public profiles instead, thirty to a
 * request, which costs almost nothing.
 */

export interface AuditableCommander {
  readonly userId: string;
  readonly cmdrName: string;
  readonly discordId: string | null;
  /** Their own Inara key, decrypted. Null when they have none on file. */
  readonly apiKey: string | null;
  /** The nickname they wear right now, as we last saw it. */
  readonly currentNick: string | null;
  /** Their rank, for the `RANK - COMMANDER` prefix. Null when they hold none. */
  readonly rank: string | null;
  /**
   * A nickname they chose instead of the convention, or null.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "if an officer overrides their name, then this is the name that stays as their discord nickname
   * it should not change from that unless they change it."
   *
   * Set means this sweep leaves them entirely alone. Not "sets it to the override" — leaves alone:
   * the override is already their nickname, because setting it is what wrote it to the guild, and
   * re-asserting it nightly would be a Discord write and an audit row per officer per day for a
   * value nothing can change but them.
   */
  readonly nicknameOverride: string | null;
}

export interface AuditStore {
  /** Every verified, unrevoked commander. */
  listCommanders(): Promise<AuditableCommander[]>;
  recordSquadron(userId: string, reported: string | null, matched: boolean, at: Date): Promise<void>;
  rememberNickname(discordId: string, nickname: string): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

export interface AuditSource {
  /** Reads a commander's squadron using THEIR key. Cannot be batched. */
  ownSquadron(apiKey: string): Promise<{ squadronName: string | null } | null>;
  /** Reads many PUBLIC profiles at once, for members with no key of their own. */
  publicSquadrons(
    names: readonly string[],
  ): Promise<Map<string, { squadronName: string | null } | null>>;
}

export interface NicknameSetter {
  set(discordId: string, nickname: string): Promise<{ ok: boolean; reason: string | null }>;
}

export interface AuditReport {
  readonly checked: number;
  /** Still in our squadron. */
  readonly confirmed: number;
  /** Inara answered, and they are NOT in our squadron. Worth an officer's eye. */
  readonly departed: number;
  /** Inara did not answer. Their stored state is untouched. */
  readonly unreachable: number;
  readonly nicknamesFixed: number;
  readonly nicknamesRefused: number;
  /** Members left alone because they hold a nickname override. */
  readonly nicknamesOverridden: number;
}

/**
 * Runs one nightly pass.
 *
 * `matches` is injected rather than imported so the squadron comparison lives
 * in exactly one place and this job cannot grow a second, subtly different one
 * — which is how a member ends up rejected over a typographic apostrophe.
 */
export async function auditCommanders(
  store: AuditStore,
  source: AuditSource,
  nicknames: NicknameSetter,
  matches: (reported: string | null) => boolean,
  compose: (rank: string | null, cmdrName: string) => string,
  now: Date = new Date(),
): Promise<AuditReport> {
  const commanders = await store.listCommanders();

  let confirmed = 0;
  let departed = 0;
  let unreachable = 0;
  let nicknamesFixed = 0;
  let nicknamesRefused = 0;
  let nicknamesOverridden = 0;

  /*
   * Members with no key of their own, batched. Fetched ONCE up front rather
   * than per member, because the batch endpoint takes thirty names per request
   * and asking inside the loop would defeat the point entirely.
   */
  const keyless = commanders.filter((c) => c.apiKey === null).map((c) => c.cmdrName);
  const publicProfiles =
    keyless.length === 0
      ? new Map<string, { squadronName: string | null } | null>()
      : await source.publicSquadrons(keyless).catch(() => new Map());

  for (const c of commanders) {
    // ---------------------------------------------------------- squadron
    let answered = false;
    let reported: string | null = null;

    if (c.apiKey !== null) {
      try {
        const profile = await source.ownSquadron(c.apiKey);
        if (profile !== null) {
          answered = true;
          reported = profile.squadronName;
        }
      } catch {
        // A failed call says nothing about anybody's membership.
      }
    } else if (publicProfiles.has(c.cmdrName.toLowerCase())) {
      const profile = publicProfiles.get(c.cmdrName.toLowerCase()) ?? null;
      if (profile !== null) {
        answered = true;
        reported = profile.squadronName;
      } else {
        /*
         * Inara answered and has no such commander. That is an ANSWER, and it
         * means they are not in our squadron as far as Inara can tell — but it
         * is recorded as "no squadron" rather than silently skipped, because a
         * member who deleted their Inara account should stop showing as
         * confirmed.
         */
        answered = true;
        reported = null;
      }
    }

    if (!answered) {
      unreachable += 1;
    } else {
      const matched = matches(reported);
      await store.recordSquadron(c.userId, reported, matched, now).catch(() => undefined);

      if (matched) {
        confirmed += 1;
      } else {
        departed += 1;
        /*
         * Audited, not acted on. Somebody leaving the squadron on Inara is a
         * fact an officer should see; it is NOT grounds for this job to strip
         * anybody's access at 00:15 with nobody watching. Inara membership is
         * self-managed and a member who simply removed themselves from a
         * third-party site has not left the squadron.
         */
        await store
          .writeAudit({
            actorId: null,
            action: 'cmdr.squadron.departed',
            targetType: 'user',
            targetId: c.userId,
            before: { squadron: 'confirmed' },
            after: { squadron: reported, cmdrName: c.cmdrName },
          })
          .catch(() => undefined);
      }
    }

    // ---------------------------------------------------------- nickname
    if (c.discordId === null) continue;

    /*
     * ★ AN OVERRIDE IS THE END OF THE MATTER ★
     *
     * Counted rather than silently skipped. A sweep that reports "0 nicknames fixed" every night
     * looks identical whether nobody had drifted or everybody had opted out, and the second is
     * something an officer would want to know about.
     */
    /*
     * `!= null`, catching undefined as well as null. A store that omits the field — an older
     * implementation, a hand-built fixture, a projection somebody trimmed — would otherwise throw
     * inside the nightly sweep, and this job runs unattended at 4am against every commander.
     */
    if (c.nicknameOverride != null && c.nicknameOverride.trim() !== '') {
      nicknamesOverridden += 1;
      continue;
    }

    const want = compose(c.rank, c.cmdrName);
    /*
     * Case-insensitive, because Elite is. Rewriting "Grim" to "GRIM" nightly
     * would be a Discord write and an audit row per member per day, and a guild
     * audit log full of no-op renames is one nobody reads.
     */
    if (c.currentNick !== null && c.currentNick.trim().toLowerCase() === want.toLowerCase()) {
      continue;
    }

    const result = await nicknames
      .set(c.discordId, want)
      .catch(() => ({ ok: false, reason: 'Discord call failed.' }));

    if (!result.ok) {
      // The guild owner cannot be renamed by a bot, and neither can anybody
      // whose highest role sits above the bot's. Both are ordinary facts about
      // a guild, not errors.
      nicknamesRefused += 1;
      continue;
    }

    await store.rememberNickname(c.discordId, want).catch(() => undefined);
    await store
      .writeAudit({
        actorId: null,
        action: 'discord.nickname.sync',
        targetType: 'user',
        targetId: c.userId,
        before: { nickname: c.currentNick },
        after: { nickname: want, source: 'daily_audit' },
      })
      .catch(() => undefined);
    nicknamesFixed += 1;
  }

  return {
    checked: commanders.length,
    confirmed,
    departed,
    unreachable,
    nicknamesFixed,
    nicknamesRefused,
    nicknamesOverridden,
  };
}
