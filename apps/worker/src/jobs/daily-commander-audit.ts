/**
 * The nightly sweep over every verified commander.
 *
 * ★ WHAT DRIFTS, AND WHY NOTHING ELSE CATCHES IT ★
 *
 * Three facts go stale between logins, and a member has no reason to notice any
 * of them:
 *
 *   COMMANDER  somebody renames their commander on Inara. Nothing on our side
 *   NAME       is told, and the name is what the roster shows and what their
 *              Discord nickname is built from — so the squadron keeps calling
 *              them by a name they no longer use.
 *
 *   SQUADRON   somebody leaves Grim's Squad on Inara, or is removed from it.
 *              Nothing on our side is told. They keep a green "verified" badge
 *              and a place on the roster indefinitely.
 *
 *   NICKNAME   somebody renames themselves in Discord, or an officer edits
 *              their nickname by hand. It is then wrong until the next time
 *              they happen to touch their Inara key, which for most members is
 *              never.
 *
 * The twenty-minute sweep only looks at people waiting on a squadron
 * application. This looks at everybody, once a day.
 *
 * ★ SQUADRON OWNER, 2026-08-05 — WHY THE FIRST OF THOSE IS HERE AT ALL ★
 *
 * "we have users that have updated their inara usernames, we clicked the check inara button on the
 * /app/members page of the website if they have been changed they need to be updated in the
 * website, and in discord".
 *
 * That button runs this job. It used to load each member's STORED name, ask Inara only about their
 * squadron, and compose their nickname from the stored name again — so a rename was invisible to
 * every step of it. The name now comes back FROM INARA, which is the same property that made the
 * original verification a verification rather than a claim.
 *
 * ★ WHY DAILY AND NOT MORE OFTEN ★
 *
 * Inara allows two requests a minute globally (INV-033). A member's OWN key
 * cannot be batched — `getOwnIdentity` answers for one key — so a hundred
 * members with keys is a hundred requests, which is roughly fifty minutes. That
 * is fine once a night and impossible every twenty.
 *
 * Members WITHOUT a key are read from public profiles instead, thirty to a
 * request, which costs almost nothing — but see `namesUncheckable`: that cheap
 * lookup is BY the stored name, so it is exactly the lookup a rename defeats.
 */

export interface AuditableCommander {
  readonly userId: string;
  /**
   * The name we STORE for them — what we believed at the start of this pass.
   *
   * For a member with a key it is a starting point, not an answer: Inara is asked what they are
   * called now, and this is what the reply is compared against.
   */
  readonly cmdrName: string;
  readonly discordId: string | null;
  /** Their own Inara key, decrypted. Null when they have none on file. */
  readonly apiKey: string | null;
  /** The nickname they wear right now, as we last saw it. */
  readonly currentNick: string | null;
  /**
   * Their rank. Null when they hold none.
   *
   * Passed to `composeNickname`, which ACCEPTS AND IGNORES it — the `RANK - COMMANDER` prefix was
   * removed on 2026-07-31 at the squadron owner's request, because the rank is already visible in
   * Discord as a coloured role and spending most of a 32-character nickname repeating it hid the
   * thing people actually want to see. Still resolved because the roster and the settings preview
   * show it. Do not put it back in the nickname.
   */
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

/** What became of an attempt to store a member's new commander name. */
export interface NameOutcome {
  readonly applied: boolean;
  /**
   * Why it was not applied, in a sentence an officer can act on. Null when it was.
   *
   * There is exactly one way this fails in practice — the new name is already somebody else's
   * verified commander — and that is a human problem, not a retryable one.
   */
  readonly reason: string | null;
}

export interface AuditStore {
  /** Every verified, unrevoked commander. */
  listCommanders(): Promise<AuditableCommander[]>;
  /**
   * Stores the name Inara now reports for this member, replacing the one we hold.
   *
   * Writes the SAME two places a member's own re-check writes — their Inara link row and their
   * verification — so the roster, the settings page and the nickname all move together.
   */
  recordName(userId: string, cmdrName: string, at: Date): Promise<NameOutcome>;
  recordSquadron(userId: string, reported: string | null, matched: boolean, at: Date): Promise<void>;
  rememberNickname(discordId: string, nickname: string): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

export interface AuditSource {
  /**
   * Reads a commander's CURRENT identity using THEIR key. Cannot be batched.
   *
   * ★ THE NAME IS WHY THIS IS NOT `ownSquadron` ANY MORE ★
   *
   * It returned the squadron alone until 2026-08-05, and the name was taken from our own database
   * — which is how a member could rename on Inara and be checked against the old name nightly,
   * forever, without a single step noticing. Inara sends both in ONE request, so asking for the
   * squadron and throwing the name away cost nothing and hid the bug.
   */
  ownIdentity(
    apiKey: string,
  ): Promise<{ cmdrName: string; squadronName: string | null } | null>;
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
  /** Inara reported a different commander name, and it is now the one we hold. */
  readonly renamed: number;
  /**
   * Inara reported a different name that we REFUSED to store, because another member is already
   * verified as it.
   *
   * Counted and audited rather than forced. Two members cannot both be one commander (INV-005), and
   * the sweep is not the place to decide which of them is wrong — an officer is.
   */
  readonly renameConflicts: number;
  /**
   * Members whose name COULD NOT BE CHECKED, because they have no Inara key of their own.
   *
   * ★ THIS COUNTER IS AN ADMISSION, AND IT IS SUPPOSED TO BE ★
   *
   * The keyless path asks Inara for public profiles BY NAME — and the only name we have for them is
   * the stored one, which is precisely the thing a rename invalidates. Searching Inara for a name
   * that no longer exists returns "no such commander"; it does not return whatever they are called
   * now. Inara has no reverse lookup that would follow a rename for somebody who has not given us a
   * key, so there is no clever version of this.
   *
   * Reporting zero renames for these members would be true and misleading in the same breath. So
   * they are counted separately: their squadron IS still checked, their name is not, and the number
   * says how many people that is. The way to check a member's name is for them to link their key.
   */
  readonly namesUncheckable: number;
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
 *
 * `isRename` is injected for exactly the same reason, and the stakes are the same shape. The rule
 * for "is this a different commander name" is the rule the verification transaction enforces
 * (`@grims/db`), and a second copy here that disagreed by so much as a case fold would either
 * rewrite every member every night or never notice a rename at all.
 */
export async function auditCommanders(
  store: AuditStore,
  source: AuditSource,
  nicknames: NicknameSetter,
  matches: (reported: string | null) => boolean,
  compose: (rank: string | null, cmdrName: string) => string,
  isRename: (stored: string, reported: string) => boolean,
  now: Date = new Date(),
): Promise<AuditReport> {
  const commanders = await store.listCommanders();

  let confirmed = 0;
  let departed = 0;
  let unreachable = 0;
  let renamed = 0;
  let renameConflicts = 0;
  let namesUncheckable = 0;
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

    /*
     * The name this member is called by the time this iteration ends.
     *
     * Starts as the stored one and is replaced only by a rename we actually WROTE. Every later step
     * — the departure audit row, the nickname — reads this rather than `c.cmdrName`, so a rename
     * reaches Discord in the same pass that discovered it rather than tomorrow's.
     */
    let name = c.cmdrName;

    if (c.apiKey !== null) {
      try {
        const identity = await source.ownIdentity(c.apiKey);
        if (identity !== null) {
          answered = true;
          reported = identity.squadronName;

          // ------------------------------------------------------ the name
          if (isRename(c.cmdrName, identity.cmdrName)) {
            const fresh = identity.cmdrName.trim();
            /*
             * Never throws out of the sweep. A rename that cannot be stored is one member's
             * problem; letting it escape would end the run for everybody after them in the list.
             */
            const outcome = await store
              .recordName(c.userId, fresh, now)
              .catch(() => ({ applied: false, reason: 'Could not store the new name this time.' }));

            if (outcome.applied) {
              renamed += 1;
              name = fresh;
              await store
                .writeAudit({
                  actorId: null,
                  action: 'cmdr.name.changed',
                  targetType: 'user',
                  targetId: c.userId,
                  before: { cmdrName: c.cmdrName },
                  after: { cmdrName: fresh, source: 'daily_audit' },
                })
                .catch(() => undefined);
            } else {
              /*
               * Recorded, and the member is LEFT AS THEY WERE. Half a rename — a new name on the
               * roster and the old one in Discord, or a verification row revoked with nothing to
               * replace it — is worse than the stale name we started with.
               */
              renameConflicts += 1;
              await store
                .writeAudit({
                  actorId: null,
                  action: 'cmdr.name.conflict',
                  targetType: 'user',
                  targetId: c.userId,
                  before: { cmdrName: c.cmdrName },
                  after: { cmdrName: fresh, applied: false, reason: outcome.reason },
                })
                .catch(() => undefined);
            }
          }
        }
      } catch {
        // A failed call says nothing about anybody's membership.
      }
    } else {
      /*
       * ★ NO KEY: THE SQUADRON IS CHECKED AND THE NAME CANNOT BE ★
       *
       * The public lookup is BY the stored name, so it can only ever confirm the name we already
       * hold. Somebody who renamed on Inara is not "found under the new name" here — they are
       * simply not found, which is indistinguishable from having deleted their account. Inara
       * offers no lookup that goes the other way for a member who has not given us a key.
       *
       * Counted before the lookup is even consulted, because it is a fact about the member and not
       * about how their chunk went. Counted at all because reporting "0 renamed" for these people
       * would be true and misleading in the same breath.
       */
      namesUncheckable += 1;

      if (publicProfiles.has(c.cmdrName.toLowerCase())) {
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
            // The name they go by NOW, so an officer reading this row can find them on Inara.
            after: { squadron: reported, cmdrName: name },
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

    /*
     * `name`, NOT `c.cmdrName` — this is how a rename reaches Discord.
     *
     * A member whose Inara name changed a moment ago gets their new name composed here, compared
     * against the nickname they are wearing, and set. No second job and no second Inara call: the
     * request that discovered the rename is the one that fixes the guild.
     */
    const want = compose(c.rank, name);
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

      /*
       * ★ A REFUSAL THAT FOLLOWS A RENAME IS WRITTEN DOWN ★
       *
       * Ordinarily a refusal is only counted: the guild owner can never be renamed by a bot, so an
       * audit row for it would arrive every night forever and mean nothing by the second week.
       *
       * But when we have JUST changed this member's commander name, the refusal is the moment the
       * site and the guild started disagreeing about who somebody is — the exact complaint that
       * brought us here. That needs a name an officer can search for, once, at the moment it
       * happens. It cannot repeat nightly, because the rename that caused it does not.
       */
      if (name !== c.cmdrName) {
        await store
          .writeAudit({
            actorId: null,
            action: 'discord.nickname.refused',
            targetType: 'user',
            targetId: c.userId,
            before: { nickname: c.currentNick },
            after: { nickname: want, applied: false, reason: result.reason, source: 'daily_audit' },
          })
          .catch(() => undefined);
      }
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
    renamed,
    renameConflicts,
    namesUncheckable,
    nicknamesFixed,
    nicknamesRefused,
    nicknamesOverridden,
  };
}
