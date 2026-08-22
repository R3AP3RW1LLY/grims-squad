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
  /*
   * ★ SYSTEMS A MEMBER ACTUALLY FLEW TO ★
   *
   * Written by `live-systems.ts` from a paired companion's journal, and MISSING FROM THIS LIST until
   * 2026-08-22 — so it was absent from `EMBEDDED_SOURCES`, no sweep ever selected those rows, and
   * 5,917 of them sat with text and a NULL embedding from the day the feature shipped.
   *
   * The exhaustive Records below are meant to make exactly that a compile error. They could not:
   * those rows are inserted with `$executeRawUnsafe` and the source as a SQL string literal, which
   * the compiler never sees. `knowledge-source-declared.spec.ts` reads the SQL instead.
   */
  'companion',
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
  /*
   * ★ LOOKUP ONLY, AND THE REASON IS MEASURED ★
   *
   * This was `both` before the collector existed, on the assumption that everything worth holding is
   * worth embedding. Building it showed why prices are the exception.
   *
   * A vector of "Platinum, 51,204 credits, Jameson Memorial" answers no question a similarity search
   * is good at. Every question about a price is a COMPARISON — cheapest, nearest, most demand — and
   * those are ORDER BY on an index, which `market_entries` already serves.
   *
   * And the cost is not neutral. EDDN delivers roughly one market snapshot a second; embedding them
   * would rewrite station vectors continuously, and this project has already watched what that does:
   * on 2026-08-01 re-embedding churn degraded the HNSW graph until "become a member" returned ship
   * descriptions. The vectors were correct; the graph was not. A REINDEX fixed it, and nothing that
   * needs an hourly REINDEX belongs in the index.
   */
  eddn: 'lookup',
  inara: 'both',
  /** Prose. There is nothing to look these up BY except their meaning. */
  reference: 'vector',
  forum: 'vector',
  /*
   * `both`, like the galaxy rows they sit beside. A member asks for these by NAME ("have we been to
   * Colonia") which is a lookup, and by DESCRIPTION ("somewhere we have been with a water world")
   * which is not.
   *
   * Safe to embed despite being live data: `live-systems.ts` never rewrites `text` and nothing in
   * the codebase clears `embedding`, so each vector is written once. This is not the continuous
   * rewriting that market snapshots would have caused.
   */
  companion: 'both',
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
  /*
   * Unused: `eddn` is `lookup`, so `EMBEDDED_SOURCES` excludes it and no sweep is scheduled. The key
   * stays because the Record is exhaustive over KNOWLEDGE_SOURCES — which is what makes adding a
   * source a compile error rather than a silently unembedded one. See STORAGE_KIND for why.
   */
  eddn: 5,
  /** The roster changes when somebody joins or is promoted. Daily is plainly enough. */
  inara: 1_440,
  /*
   * Daily, and deliberately not hourly. A sweep of 200 rows or more ends in a REINDEX of the vector
   * index; at its full size that is a nightly operation, not an hourly one. Members do not fly
   * somewhere new and then immediately ask the assistant about it.
   */
  companion: 1_440,
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
/**
 * ★ RESET BY THE SQUADRON OWNER, 2026-08-01 ★
 *
 * "these need to run automatically every 30 minutes ... these need to run every hour automatically
 * ... this stays as it currently is [live markets] ... this is a non-negotiable! these are clearly
 * not triggering as we have overdue on them!"
 *
 * They were not triggering, and the cadences were not the reason — see the note in `daemon.ts`.
 * Nothing scheduled them at all. These are the intervals asked for, and the worker now enforces
 * them itself rather than depending on a crontab that has to be installed by hand.
 */
export const REFRESH_HOURS: Record<KnowledgeSource, number> = {
  /** Hourly. Members fly constantly and their logs are the most trusted thing we hold. */
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
  coriolis: 1,
  /**
   * Hourly, by instruction.
   *
   * Spansh itself rebuilds nightly, so most runs find nothing new — but the job is incremental and
   * a run with nothing to do is cheap, while the alternative is a window in which a newly visited
   * system is unknown to the assistant for most of a day.
   */
  galaxy: 1,
  /*
   * ★ NOT A SCHEDULE — A DEADLINE ★
   *
   * The collector never stops; it is a subscriber, not a cron job. Nothing "runs" every hour.
   *
   * What it does is close a reporting window every fifteen minutes (EDDN_WINDOW_MINUTES), so the
   * training page always has a recent completion to show. Setting this to 1 turns that into an
   * alarm: four windows are expected inside the hour, so "overdue" can only mean the collector has
   * actually stopped — which is the one thing about a resident process nobody would otherwise
   * notice, because a dead subscriber looks exactly like a quiet one.
   */
  eddn: 1,
  /** Every half hour. Ranks change and the roster is what the promotion cycle reads. */
  inara: 0.5,
  /** Every half hour. Our own guides are edited by officers who expect to see the effect. */
  reference: 0.5,
  /** Every half hour. An accepted answer should be usable by the assistant the same session. */
  forum: 0.5,
  /*
   * ★ NOT A SCHEDULE — A DEADLINE, exactly like `eddn` above ★
   *
   * Nothing pulls this. Paired companions PUSH systems as members fly, so there is no "companion
   * ingest" to start; `RESIDENT` in the worker's scheduler is what keeps it from being started.
   *
   * The number is therefore a staleness alarm: 24 hours without a single member reporting a system
   * means the pairing path has stopped, which is worth knowing and is otherwise invisible.
   *
   * It was `0` first, which broke three scheduler tests and deserved to. Zero does not read as
   * "never pulls" — it reads as "due right now, and again next tick, for ever", and it collapsed
   * the shortest-cadence check that keeps TICK_MS honest.
   */
  companion: 24,
};

/** What the training page shows for one source. */
export interface SourceStatus {
  readonly source: KnowledgeSource;
  /**
   * Rows held that have text but no embedding yet.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * New stations and commodities "need to be included in all future training and embedding" — and,
   * asked how eagerly: the next scheduled embed run, "and tell me how many are waiting".
   *
   * This is that number. It is not an error: an ingest that has just written five thousand rows is
   * SUPPOSED to leave them waiting for the embedder, and the count going up after a run is the
   * system working. What it answers is "has the backlog stopped moving", which nothing on the page
   * could say before.
   *
   * Zero for sources that are never embedded — the market feed is queried by price, not by meaning.
   */
  readonly awaitingEmbedding: number;
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
   * Started and then stopped reporting — as opposed to having failed with a message of its own.
   *
   * ★ A FLAG, BECAUSE THE PAGE USED TO GUESS FROM THE WORDING ★
   *
   * The stall was only ever expressed as `lastError` prose, and the page told it apart from a real
   * failure with `lastError.startsWith('Started')`. When the service's wording changed to "No
   * progress for N minutes" that test silently became unreachable, so every stalled source rendered
   * as "Last run failed" — while the count above it still called them stalled. The tile and the row
   * disagreed and neither was obviously wrong.
   *
   * Two states that need different reactions must not be distinguished by a string that either side
   * can reword without the other noticing.
   */
  readonly stalled: boolean;

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
  companion: 'Systems our members have flown to',
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
  companion: 'Systems the squadron has actually visited, as their companions reported them',
};

/**
 * Rows that describe a PLACE rather than an idea.
 *
 * ★ THE INVARIANT THAT QUIETLY STOPPED BEING TRUE — 2026-08-22 ★
 *
 * `KnowledgeService.semantic` carried this comment for months, and it was correct when written:
 *
 *     "Restricted to embedded sources by construction: the query returns rows whose embedding is
 *      not null, and only prose sources are ever embedded (see STORAGE_KIND)."
 *
 * Then the squadron owner asked for full EDDN coverage and 687,000 systems and stations were
 * embedded. The comment stayed. The code stayed. The invariant it depended on was gone.
 *
 * The result, measured in production: "how do I become a member of the squadron" returned five
 * system names. Not because retrieval was wrong — because 302 prose rows were being asked to
 * compete with 687,000 places inside one approximate index, and approximate search lost them.
 *
 * ★ SO THE SEPARATION IS ENFORCED, NOT ASSUMED ★
 *
 * A prose question searches prose. A place question searches places. Neither can drown the other,
 * however many systems the galaxy import adds — and it will add millions. This list is what makes
 * that structural rather than a tuning parameter somebody has to keep ahead of.
 */
export const PLACE_KINDS = ['system', 'station', 'visited-system', 'visited-station'] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

/** True for a row describing somewhere you can fly to. */
export function isPlaceKind(kind: string): boolean {
  return (PLACE_KINDS as readonly string[]).includes(kind);
}
