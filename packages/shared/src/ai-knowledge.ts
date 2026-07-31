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
 * How each source is stored, and it is not the same for all of them.
 *
 * ★ THE DECISION THAT SAVES THREE WEEKS OF GPU ★
 *
 * Embedding every system in the galaxy would take roughly three weeks on this hardware and produce
 * a WORSE result: asked about "Deciat" it would retrieve systems whose names sound similar — Deciat,
 * Decius, Deciak — rather than facts about Deciat.
 *
 * Structured data is looked up. Prose is embedded. The rule is simply which question the data can
 * answer:
 *
 *   'lookup'  exact match, spatial search, attribute filter. SQL and pgvector's cube extension.
 *   'vector'  "what does this MEAN" — guides, lore, explanations, forum answers.
 */
export const STORAGE_KIND = {
  journal: 'lookup',
  coriolis: 'lookup',
  galaxy: 'lookup',
  eddn: 'lookup',
  inara: 'lookup',
  reference: 'vector',
  forum: 'vector',
} as const satisfies Record<KnowledgeSource, 'lookup' | 'vector'>;

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
  /** Changes only when Frontier ships a game update. Weekly is generous. */
  coriolis: 168,
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
