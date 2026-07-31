import type { PrismaClient } from '@grims/db';
import type { WritableRow } from './knowledge-writer.js';

/**
 * The squadron's own roster, as knowledge GMSD AI can answer from.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "this api key must be used for machine learning updates once a day and it must be a batched
 * call" — then, clarifying: "i was refering to the ingestion for ML from inara, that one must be
 * batched and run on its own."
 *
 * So this is its OWN job on its OWN daily schedule, separate from the twenty-minute rank sweep
 * that keeps the roster page current. Mixing them would mean the knowledge base could only ever
 * refresh as often as the roster, or the roster as rarely as the knowledge base.
 *
 * ★ IT MAKES NO INARA REQUESTS, AND THAT IS THE POINT OF THE BATCHING ★
 *
 * `inara-rank-sync` already fetches every commander's profile — thirty per request, against a
 * global budget of two requests a minute — and caches the result in `inara_commander_profiles`.
 * This reads that cache.
 *
 * A second sweep would double our usage of that budget to fetch bytes we already hold, and would
 * make the two copies disagree for the twenty minutes between them. "Batched, once a day" is
 * satisfied more completely by asking zero times than by asking again politely: the API calls are
 * batched where they happen, and this job adds none.
 *
 * The cost is that a member who joined in the last twenty minutes is not yet in the knowledge
 * base. Against a source that refreshes daily, that is not a cost at all.
 */

/** One row per member, plus one for the squadron as a whole. */
export interface InaraKnowledge {
  readonly rows: WritableRow[];
  readonly members: number;
}

interface ProfileRow {
  search_name: string;
  ranks: unknown;
  squadron_name: string | null;
  squadron_rank: string | null;
  is_found: boolean;
  fetched_at: Date;
  /** Their handle on the hub, which is not their commander name. */
  handle: string | null;
}

/**
 * Builds the knowledge rows.
 *
 * Reads, shapes, returns — it writes nothing. The same split as every other ingest here: the
 * SHAPE is what breaks when something upstream changes, and it should be testable without a
 * database standing by.
 */
export async function readInaraKnowledge(db: PrismaClient): Promise<InaraKnowledge> {
  const profiles = await db.$queryRawUnsafe<ProfileRow[]>(
    `SELECT p.search_name, p.ranks, p.squadron_name, p.squadron_rank,
            p.is_found, p.fetched_at,
            u.handle
       FROM inara_commander_profiles p
       LEFT JOIN users u ON u.id = p.user_id
      -- Only commanders Inara actually knows. A row for somebody it has never heard of would
      -- teach the assistant that a member has no ranks, which is a different claim from "we
      -- could not look them up" and the one it would repeat confidently.
      WHERE p.is_found = true`,
  );

  const rows: WritableRow[] = [];

  for (const p of profiles) {
    const ranks = Array.isArray(p.ranks) ? (p.ranks as Array<Record<string, unknown>>) : [];

    rows.push({
      source: 'inara',
      kind: 'commander',
      // Keyed on the commander name, lower-cased. It is what a member types when they ask about
      // somebody, and `search_name` is already citext so the case carries no information.
      extKey: p.search_name.toLowerCase(),
      name: p.search_name,
      data: {
        cmdrName: p.search_name,
        handle: p.handle,
        squadronName: p.squadron_name,
        squadronRank: p.squadron_rank,
        /*
         * ★ `label` IS THE LADDER, `name` IS THE RANK — AND I HAD THEM THE WRONG WAY ROUND ★
         *
         * The stored shape is { key: 'Explore', label: 'Exploration', name: 'Surveyor', index: 3 }.
         * Reading `label ?? name` produced "Ranks: Combat, Trade, Exploration" — the list of
         * ladders every commander in the game has, identical for all 107 members, and carrying no
         * information whatsoever. It looked plausible enough to ship and would have taught the
         * assistant nothing.
         *
         * Both are kept, because the answer needs both halves: the ladder to know what is being
         * measured, the rank to know where they are on it.
         */
        ranks: ranks.map((r) => ({
          ladder: r['label'] ?? r['key'],
          rank: r['name'],
          value: r['index'],
        })),
        /*
         * When Inara was last asked, NOT when we ingested. A profile nobody has refreshed in a
         * week should be treated differently from one checked an hour ago, and only this can tell
         * them apart.
         */
        profileFetchedAt: p.fetched_at,
      },
      /*
       * ★ TEXT, SO THE ANSWER READS LIKE A SENTENCE ★
       *
       * The assistant is handed rows at question time. A bare JSON object makes it paraphrase a
       * data structure; a sentence makes it quote a fact. Written here rather than at query time
       * so every consumer gets the same phrasing.
       */
      text: describe(p, ranks),
    });
  }

  /*
   * One row for the squadron itself.
   *
   * "How many of us are there" and "who is in the squadron" are questions about the GROUP, and
   * answering them from a hundred and seven individual rows means retrieving all of them and
   * hoping the model counts correctly. It will not always. This is the count, stated once.
   */
  const inSquadron = profiles.filter((p) => p.squadron_name !== null);
  if (inSquadron.length > 0) {
    const squadronName = inSquadron[0]?.squadron_name ?? 'the squadron';
    rows.push({
      source: 'inara',
      kind: 'squadron',
      extKey: 'roster',
      name: squadronName,
      data: {
        name: squadronName,
        memberCount: inSquadron.length,
        members: inSquadron.map((p) => ({ cmdrName: p.search_name, rank: p.squadron_rank })),
      },
      text:
        `${squadronName} has ${inSquadron.length} commanders whose Inara profiles confirm membership. ` +
        `They are: ${inSquadron.map((p) => p.search_name).join(', ')}.`,
    });
  }

  return { rows, members: profiles.length };
}

/** One commander, as a sentence. */
function describe(p: ProfileRow, ranks: Array<Record<string, unknown>>): string {
  const parts: string[] = [`CMDR ${p.search_name}`];

  if (p.handle !== null && p.handle !== '') parts.push(`(${p.handle} on the hub)`);

  if (p.squadron_name !== null) {
    parts.push(
      p.squadron_rank === null
        ? `is a member of ${p.squadron_name}`
        : `is ${p.squadron_rank} in ${p.squadron_name}`,
    );
  }

  /*
   * "Combat: Deadly", not "Combat" and not "Deadly". The ladder alone is the same for everybody
   * and says nothing; the rank alone is ambiguous, because Elite in Trade and Elite in Combat are
   * different achievements and a bare "Elite" cannot say which.
   */
  const named = ranks
    .map((r) => {
      const ladder = r['label'] ?? r['key'];
      const rank = r['name'];
      return typeof ladder === 'string' && typeof rank === 'string' ? `${ladder}: ${rank}` : null;
    })
    .filter((s): s is string => s !== null);

  if (named.length > 0) parts.push(`Ranks — ${named.join(', ')}.`);

  /*
   * ★ SAID OUT LOUD, IN THE TEXT ITSELF ★
   *
   * Inara profiles are SELF-REPORTED — a member types their squadron and ranks into a website.
   * The assistant will quote this text, and without the caveat inside it, the caveat is lost the
   * moment the row is retrieved. Our own journal telemetry is the authority; this is enrichment.
   */
  parts.push('(Self-reported on Inara, not read from the game.)');

  return parts.join(' ');
}
