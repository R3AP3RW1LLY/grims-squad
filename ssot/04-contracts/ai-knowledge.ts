/**
 * What GMSD AI knows about Elite Dangerous.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "we also need to train our agent on everything Elite Dangerous."
 *
 * ★ RETRIEVAL, NOT TRAINING — AND THAT IS NOT A COMPROMISE ★
 *
 * Nothing here is fine-tuned into the model. Facts are stored, looked up, and handed to the model at
 * question time.
 *
 * That is not the cheap version of training, it is the correct one for this data:
 *
 *   The galaxy CHANGES. Stations are built, factions win wars, markets move hourly. Weights frozen
 *   at training time would confidently state last month's prices forever, and be wrong in a way that
 *   sounds exactly as certain as being right.
 *
 *   Facts must be EXACT. "Which stations in Deciat have a large pad" is a query with one correct
 *   answer, and a model recalling it from weights approximates. A lookup does not.
 *
 *   Corrections must be INSTANT. A wrong row is deleted in a second; a wrong weight needs a
 *   retraining run.
 *
 * So the model supplies language and reasoning, and this supplies the facts. Where those two are
 * separated the assistant can say "I do not know" instead of inventing, which is the single most
 * important property a squadron tool can have.
 */

/**
 * Where a piece of knowledge came from.
 *
 * Kept per row because provenance decides two things nothing else can: which source wins when two
 * disagree, and what a member is told when they ask where an answer came from.
 */
export const KNOWLEDGE_SOURCES = [
  /** Our members' own journals. The most trusted: we saw it happen. */
  'journal',
  /** EDCD/Coriolis — ships, modules, engineering. Reference data, changes only when the game does. */
  'coriolis',
  /** Spansh/EDSM galaxy dumps — systems, stations, services. */
  'galaxy',
  /** EDDN live feed — markets and system states, minutes old. */
  'eddn',
  /** Inara — our own squadron's roster and standing. */
  'inara',
  /** Wiki, guides, journal spec. Prose, and the only kind that is embedded. */
  'reference',
  /** Our own forum: accepted answers and highly-rated posts. */
  'forum',
] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

/**
 * How each source is stored, and how often its vectors are refreshed.
 *
 * ★ EVERYTHING IS EMBEDDED NOW — SQUADRON OWNER, 2026-08-01 ★
 *
 * "i also think we should be embedding all info collected from ingested sources should we not?"
 *
 * Yes. The previous answer was no, and it rested on a number that turned out to be wrong.
 *
 * ★ THE CORRECTION ★
 *
 * This file used to say embedding the galaxy would take "roughly three weeks on this hardware".
 * Measured on the actual card rather than assumed:
 *
 *     concurrency  1:  22/s  ->  448,676 rows in 5.8h
 *     concurrency  4:  61/s  ->  2.0h
 *     concurrency  8: 104/s  ->  1.2h
 *     concurrency 16: 112/s  ->  1.1h
 *
 * Just over an hour, once, and then only what changed. Three weeks would have been a real reason
 * not to; an hour is not a reason for anything. The estimate was inherited and never checked, and
 * it shaped the whole design.
 *
 * ★ WHAT HAS NOT CHANGED ★
 *
 * Embedding is ADDED, never substituted. "Which stations in Deciat have a large pad" is still
 * answered by an exact lookup on an index, because a similarity search returns Deciak and Decius —
 * systems that sit near Deciat in embedding space and have nothing to do with the question.
 *
 * What vectors add is the question lookup cannot take at all: "somewhere quiet with good mining and
 * a large pad". No column holds that. So `both` means indexed AND embedded, and the retrieval layer
 * picks by the shape of the question — see KnowledgeService.
 */
export const STORAGE_KIND: Record<KnowledgeSource, 'lookup' | 'vector' | 'both'> = {
  journal: 'both',
  coriolis: 'both',
  galaxy: 'both',
  eddn: 'both',
  inara: 'both',
  /** Prose. There is nothing to look these up BY except their meaning. */
  reference: 'vector',
  forum: 'vector',
};

/** Every source whose text should carry a vector. Derived, so it can never drift from the table. */
export const EMBEDDED_SOURCES: KnowledgeSource[] = (
  Object.keys(STORAGE_KIND) as KnowledgeSource[]
).filter((s) => STORAGE_KIND[s] !== 'lookup');

/**
 * How often each source's NEW rows are swept up for embedding, in minutes.
 *
 * ★ SET BY THE SQUADRON OWNER, 2026-08-01 ★
 *
 * "forum embedding should happen every 5 minutes ... inara is a daily embed, and journal should
 * embed every 2-3 minutes or in real time should it not?"
 *
 * These follow how fast each source produces text somebody might immediately ask about — not how
 * expensive it is. A sweep with nothing to do is one indexed query that returns no rows.
 */
export const EMBED_EVERY_MINUTES: Record<KnowledgeSource, number> = {
  /*
   * Somebody answers a question and walks away. The next member to ask should get that answer, not
   * be told nobody has covered it — five minutes is the difference between the forum feeling like
   * part of the assistant and feeling like an archive.
   */
  forum: 5,
  /*
   * Where the squadron has just been. Three minutes: a member asking "has anyone been to X" while
   * a wing is actually there should hear yes.
   */
  journal: 3,
  /** Prices move constantly, and a stale vector describes a market that no longer exists. */
  eddn: 5,
  /** The roster changes when somebody joins or is promoted. Daily is plainly enough. */
  inara: 1_440,
  /** Both follow their ingest — there is nothing new between runs, so a sweep would find nothing. */
  galaxy: 1_440,
  coriolis: 180,
  /** Guides change when somebody writes one. */
  reference: 60,
};

/**
 * How many embeddings to have in flight at once.
 *
 * ★ EIGHT, NOT SIXTEEN, AND THE MEASUREMENT SAYS WHY ★
 *
 * 8 gives 104/s and 16 gives 112/s — seven per cent more for twice the queue depth. The card is
 * also serving post screening, and a member waiting to post is a person while this is a background
 * sweep. Eight takes nearly all the throughput and leaves the model responsive.
 */
export const EMBED_CONCURRENCY = 8;

/**
 * How often each source is worth refreshing, in hours.
 *
 * ★ SHOWN TO OFFICERS AS "NEXT INGESTION IN N HOURS" ★
 *
 * Squadron owner asked the training page to show when the next cycle runs. These are those numbers,
 * and each follows from how fast the underlying thing actually changes:
 */
export const REFRESH_HOURS: Record<KnowledgeSource, number> = {
  /** Continuous — it arrives as members fly. The number is nominal. */
  journal: 1,
  /*
   * ★ THREE HOURS — squadron owner, 2026-08-01 ★
   *
   * "why is this so long ... can we not do this on like a 2-3 hour schedule?"
   *
   * It was weekly, on the reasoning that coriolis-data changes only when Frontier ships a game
   * update. That reasoning was about the DATA and the schedule is about when we LOOK, and those
   * are different questions: looking weekly means a game update can be six days old before the
   * assistant knows a module exists.
   *
   * Affordable because the job asks GitHub for one commit id and stops when it matches — a single
   * small request, eight times a day. It downloads only when upstream actually moved.
   */
  coriolis: 3,
  /** Spansh rebuilds nightly; systems do not move. */
  galaxy: 24,
  /** Markets move hourly, and a stale price is worse than no price. */
  eddn: 1,
  /** Our own roster. Daily, batched — see the Inara job. */
  inara: 24,
  /** Wiki edits are slow and rarely urgent. */
  reference: 168,
  /** Our forum. Daily is plenty; an accepted answer is not time-critical. */
  forum: 24,
};

/** What the training page shows for one source. */
export interface SourceStatus {
  readonly source: KnowledgeSource;
  /** Rows currently held. Zero means never ingested. */
  readonly rows: number;
  /** When it last completed, or null if never. */
  readonly lastIngestedAt: Date | null;
  /** Running right now. */
  readonly ingesting: boolean;
  /**
   * Hours until the next run, or null when it has never run.
   *
   * Negative means overdue — shown as such rather than clamped to zero, because "3 hours overdue"
   * and "due now" need different reactions and a clamp hides the first.
   */
  readonly nextInHours: number | null;
  /** Set when the last attempt failed. A source that is quietly broken looks identical to a fresh one. */
  readonly lastError: string | null;

  /**
   * When the run currently in progress began. Null when nothing is running.
   *
   * Sent as the START rather than as an elapsed number, so the page can tick a clock locally
   * between refreshes instead of showing a duration that freezes for thirty seconds at a time.
   */
  readonly startedAt: Date | null;
  /** Rows written so far by the run in progress. See `progressIngest`. */
  readonly rowsSoFar: number | null;
  /**
   * What this source held after its last SUCCESSFUL run, and therefore roughly what to expect.
   *
   * ★ THE ONLY HONEST BASIS FOR AN ESTIMATE ★
   *
   * There is no way to know how many rows an import will produce before it produces them — the
   * galaxy dump is a 4GB stream and its length is not in a header. Last time's total is the best
   * available guess, it is usually within a per cent, and on a FIRST run it is null — which is why
   * `etaSeconds` returns null rather than inventing a number nobody could stand behind.
   */
  readonly expectedRows: number | null;
}

/**
 * How much longer a running ingest has, in seconds.
 *
 * ★ IT ADJUSTS, BECAUSE IT IS RECOMPUTED FROM THE OBSERVED RATE ★
 *
 * Squadron owner: "an estimate that adjusts as it goes so its always showing an accurate time."
 *
 * Rate is measured over the whole run rather than the last interval. A window would react faster to
 * a slowdown and would also swing wildly — the galaxy import writes at very different speeds
 * through the dump, and a countdown that jumps between four minutes and forty is worse than one
 * that drifts.
 *
 * Null when it cannot be known: nothing running, no previous total to compare against, or too
 * little progress to divide by. A missing estimate is honest; a made-up one gets believed.
 */
export function etaSeconds(input: {
  startedAt: Date | null;
  rowsSoFar: number | null;
  expectedRows: number | null;
  now: Date;
}): number | null {
  const { startedAt, rowsSoFar, expectedRows, now } = input;
  if (startedAt === null || rowsSoFar === null || expectedRows === null) return null;
  if (rowsSoFar <= 0 || expectedRows <= rowsSoFar) return null;

  const elapsedMs = now.getTime() - startedAt.getTime();
  // Under a second there is no rate worth dividing by, and the first estimate would read as hours.
  if (elapsedMs < 1_000) return null;

  const rowsPerMs = rowsSoFar / elapsedMs;
  return Math.round((expectedRows - rowsSoFar) / rowsPerMs / 1000);
}

/** 0-1 through a running ingest, or null when there is nothing to measure against. */
export function ingestFraction(rowsSoFar: number | null, expectedRows: number | null): number | null {
  if (rowsSoFar === null || expectedRows === null || expectedRows <= 0) return null;
  // Clamped: last time's total is a guess, and a bar that runs past its end looks broken.
  return Math.min(1, rowsSoFar / expectedRows);
}

/** Hours until a source is next due. Null when it has never run. */
export function nextInHours(source: KnowledgeSource, lastAt: Date | null, now: Date): number | null {
  if (lastAt === null) return null;
  const dueAt = lastAt.getTime() + REFRESH_HOURS[source] * 3_600_000;
  return Math.round(((dueAt - now.getTime()) / 3_600_000) * 10) / 10;
}

/**
 * Human labels for the training page. The source ids are for us, not for officers.
 */
export const SOURCE_LABELS: Record<KnowledgeSource, string> = {
  journal: 'Squadron flight logs',
  coriolis: 'Ships, modules and engineering',
  galaxy: 'Systems and stations',
  eddn: 'Live markets',
  inara: 'Squadron roster',
  reference: 'Guides and reference',
  forum: 'Answered forum questions',
};

/**
 * What each source lets the assistant answer. Shown on the training page.
 *
 * ★ SO A SOURCE THAT IS DOWN MEANS SOMETHING TO A HUMAN ★
 *
 * "galaxy: last ingested 4 days ago" tells an officer nothing they can act on. "Members cannot ask
 * about stations" tells them what is broken and whether it matters today.
 */
export const SOURCE_ANSWERS: Record<KnowledgeSource, string> = {
  journal: 'Where the squadron has actually been, and what they fly',
  coriolis: 'Ship builds, module stats, engineering blueprints',
  galaxy: 'What is in a system, station services, pad sizes',
  eddn: 'Current commodity prices and where to sell',
  inara: 'Who is in the squadron and what rank they hold',
  reference: 'How the game works — mechanics, lore, our own guides',
  forum: 'Questions this squadron has already answered',
};
