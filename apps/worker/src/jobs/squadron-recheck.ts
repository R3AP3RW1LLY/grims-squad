/**
 * Re-checking squadron membership for members who said they had applied.
 *
 * ★ WHY THERE IS A JOB AT ALL ★
 *
 * A member joins Grim's Squad on Inara and ticks "I have applied". The website
 * asks Inara there and then — but Inara's own record can lag behind a squadron
 * application by minutes or longer, so the immediate answer is often "not yet".
 *
 * Without this, that member sits partially verified until they think to come
 * back and click something again. They have done everything asked of them; the
 * waiting should be ours.
 *
 * ★ WHY ONLY THE ONES WHO CLAIMED ★
 *
 * Inara is capped at two requests a minute globally (INV-033). Polling every
 * partially-verified member forever would spend that budget on people who have
 * not applied and are not going to, and starve the ones who just did.
 *
 * The claim is not evidence — Inara decides — but it is the difference between
 * a member waiting on us and a name sitting in a table.
 */

export interface AwaitingMember {
  readonly userId: string;
  readonly cmdrName: string;
  /** Their own Inara key, decrypted. Null when they have none on file. */
  readonly apiKey: string | null;
}

export interface SquadronRecheckStore {
  /** Verified members who claimed a squadron and are not yet confirmed. */
  listAwaiting(): Promise<AwaitingMember[]>;
  record(userId: string, reported: string | null, matched: boolean, at: Date): Promise<void>;
}

export interface SquadronSource {
  /** Reads a commander's squadron using THEIR key. */
  ownSquadron(apiKey: string): Promise<{ squadronName: string | null } | null>;
  /** Reads a commander's PUBLIC squadron, for members with no key of their own. */
  publicSquadron(cmdrName: string): Promise<{ squadronName: string | null } | null>;
}

export interface RecheckReport {
  readonly checked: number;
  readonly confirmed: number;
  /** Inara answered, and they are not in our squadron yet. */
  readonly stillWaiting: number;
  /** Inara did not answer. Their stored state is untouched. */
  readonly unreachable: number;
  /**
   * WHO was confirmed on this pass.
   *
   * ★ NOT A STATISTIC — THE POINT OF THE JOB ★
   *
   * The page tells a waiting member they can close it and will be verified
   * automatically. Keeping that promise on the SCREEN, and not only in the
   * database, means telling their browser — and a count of eleven cannot be
   * turned back into eleven people to tell.
   */
  readonly confirmedUserIds: readonly string[];
}

/**
 * Runs one pass.
 *
 * `matches` is injected rather than imported so the comparison rule lives in
 * exactly one place (the API's squadron service) and this job cannot quietly
 * grow a second, subtly different one — which is precisely how a member ends up
 * rejected over a typographic apostrophe.
 */
export async function recheckSquadrons(
  store: SquadronRecheckStore,
  source: SquadronSource,
  matches: (reported: string | null) => boolean,
  now: Date = new Date(),
): Promise<RecheckReport> {
  const awaiting = await store.listAwaiting();

  const confirmedUserIds: string[] = [];
  let stillWaiting = 0;
  let unreachable = 0;

  for (const member of awaiting) {
    let reported: string | null;

    try {
      /*
       * Their OWN key first. It is the stronger read — Inara answers for the
       * account the key belongs to rather than for a name we typed — and it
       * does not depend on the squadron-level key being configured at all.
       */
      const profile =
        member.apiKey !== null
          ? await source.ownSquadron(member.apiKey)
          : await source.publicSquadron(member.cmdrName);

      // Inara had no profile. Different from "not in the squadron", and not
      // recorded as a rejection.
      if (profile === null) {
        unreachable += 1;
        continue;
      }

      reported = profile.squadronName;
    } catch {
      // A failed call is not evidence about anybody's membership. Left
      // untouched so the next pass tries again.
      unreachable += 1;
      continue;
    }

    const matched = matches(reported);
    await store.record(member.userId, reported, matched, now).catch(() => undefined);

    if (matched) confirmedUserIds.push(member.userId);
    else stillWaiting += 1;
  }

  return {
    checked: awaiting.length,
    confirmed: confirmedUserIds.length,
    stillWaiting,
    unreachable,
    confirmedUserIds,
  };
}
