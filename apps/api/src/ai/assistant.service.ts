import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { AiClient } from './ai.client.js';
import { AiLog } from './ai-log.port.js';
import { KnowledgeService, type Fact } from './knowledge.service.js';
import { planFor } from './question.js';

/**
 * The assistant — the surface everything else has been building towards.
 *
 * ★ WHAT THIS IS AND IS NOT ★
 *
 * It is not a chatbot with a game encyclopedia baked into its weights. It is a retrieval system
 * with a language model attached to the end of it, and that ordering is the entire design. The
 * model supplies sentences; `KnowledgeService` supplies facts; and because those two are separate
 * the assistant can say "I do not know" instead of inventing.
 *
 * That property is worth more here than fluency. A confidently wrong answer about where to sell
 * Painite costs a member an hour of flying, and they will not come back to check whether the tool
 * was right — they will conclude it does not work.
 *
 * ★ EVERY ANSWER CARRIES ITS SOURCES ★
 *
 * The facts that went in come back out alongside the answer. Not decoration: it is the only way a
 * member can tell a retrieved fact from a generated sentence, and the only way an officer reviewing
 * a bad answer can tell whether the data was wrong or the model was.
 */

/** How many turns of history to carry. Enough for a follow-up, not enough to drift. */
const HISTORY_TURNS = 6;

/** Questions per member per hour. Generous for use, mean enough to stop a script. */
const HOURLY_LIMIT = 60;

/** How long the commodity list is trusted before it is read again. */
const COMMODITIES_TTL_MS = 60 * 60 * 1000;

/** Bounded, because a whole forum post pasted in is not a question. */
const MAX_QUESTION = 500;

export interface AssistantTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AssistantAnswer {
  readonly answer: string;
  /** What the answer was built from. Empty means it had nothing and should have said so. */
  readonly sources: readonly Fact[];
  /** Set when the request never reached the model. */
  readonly refusedReason: string | null;
}

/**
 * The rules the model answers under.
 *
 * ★ WRITTEN AS PROHIBITIONS, BECAUSE THAT IS WHAT FAILS ★
 *
 * A prompt that says "be helpful and accurate" produces a model that is helpful. The failure worth
 * engineering against is the specific and predictable one: handed eight facts and a question they
 * do not cover, a model will bridge the gap with something that sounds right.
 */
const SYSTEM_PROMPT = [
  "You are the assistant for Grim's Squad, an Elite Dangerous squadron.",
  '',
  'You answer ONLY from the FACTS provided below. They come from the squadron\'s own data:',
  'the galaxy dump, live market prices, ship and module data, our forum guides, and our roster.',
  '',
  'Rules, in order of importance:',
  '1. If the FACTS do not answer the question, say so plainly and stop. Do not fill the gap from',
  '   general knowledge about Elite Dangerous, however confident you are. "I do not have that"',
  '   is a good answer; a plausible invention is the worst thing you can produce.',
  '2. Never invent a station name, system name, price, or distance. Every one of those must appear',
  '   in the FACTS verbatim.',
  '3. If a FACT carries a price, the price IS the answer to a trading question — always include it,',
  '   with the age given alongside it. A list of stations with no prices is not an answer.',
  '4. Be brief. Two or three sentences unless a list is genuinely clearer.',
  '5. Write in plain British English. No headings, no bullet symbols unless listing stations.',
  '6. You are talking to a commander who plays the game. Do not explain what Elite Dangerous is.',
].join('\n');

@Injectable()
export class AssistantService {
  #commodities: string[] = [];
  #commoditiesAt = 0;

  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    private readonly ai: AiClient,
    private readonly knowledge: KnowledgeService,
    private readonly log: AiLog,
  ) {}

  async ask(
    userId: string | null,
    question: string,
    history: readonly AssistantTurn[],
    surface: string,
    threadId: string | null,
  ): Promise<AssistantAnswer> {
    const startedAt = Date.now();
    const q = question.trim().slice(0, MAX_QUESTION);

    if (q === '') {
      return { answer: '', sources: [], refusedReason: 'empty question' };
    }

    if (userId !== null && (await this.#overLimit(userId))) {
      const refusedReason = `over the hourly limit of ${HOURLY_LIMIT} questions`;
      await this.#record(userId, surface, q, null, threadId, refusedReason, startedAt);
      return {
        answer: 'You have asked a lot of questions in the last hour. Try again shortly.',
        sources: [],
        refusedReason,
      };
    }

    const facts = await this.#gather(q);

    /*
     * ★ NOTHING RETRIEVED MEANS NO CALL AT ALL ★
     *
     * Sending a question with an empty FACTS block asks the model to answer from its weights, which
     * is exactly the behaviour the whole design exists to prevent — and it would do it well enough
     * to be believed. Saying so directly is both more honest and faster.
     */
    if (facts.length === 0) {
      const refusedReason = 'nothing retrieved';
      await this.#record(userId, surface, q, null, threadId, refusedReason, startedAt);
      return {
        answer:
          'I do not have anything on that. I know about systems and stations, market prices, ships ' +
          'and modules, our guides, and the squadron roster — try asking about one of those.',
        sources: [],
        refusedReason,
      };
    }

    const answer = await this.ai.ask(SYSTEM_PROMPT, [
      // Trimmed to the recent past. Older turns cost tokens and pull answers towards whatever was
      // being discussed twenty minutes ago.
      ...history.slice(-HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content })),
      { role: 'user' as const, content: `FACTS:\n${renderFacts(facts)}\n\nQUESTION: ${q}` },
    ]);

    await this.#record(userId, surface, q, answer, threadId, null, startedAt);

    if (answer === null) {
      return {
        answer: 'The assistant is not reachable at the moment. The facts below are what I found.',
        sources: facts,
        refusedReason: null,
      };
    }

    return { answer, sources: facts, refusedReason: null };
  }

  /**
   * Recent conversations, newest first, for officer review.
   *
   * ★ ONE ROW PER CONVERSATION, NOT PER TURN ★
   *
   * A flat list of turns is unreadable at review time: a busy evening is two hundred rows in which
   * consecutive lines belong to different people asking about different things. Collapsing to the
   * thread — who, when, how many turns, and what they opened with — is what makes the screen
   * something an officer can scan.
   */
  async recentThreads(): Promise<
    Array<{
      threadId: string;
      userId: string | null;
      displayName: string | null;
      turns: number;
      startedAt: Date;
      lastAt: Date;
      opener: string;
      refusals: number;
    }>
  > {
    return this.db.$queryRawUnsafe(
      `SELECT c.thread_id                              AS "threadId",
              c.user_id                                AS "userId",
              u.display_name                           AS "displayName",
              c.turns::int                             AS turns,
              c.started_at                             AS "startedAt",
              c.last_at                                AS "lastAt",
              c.opener,
              c.refusals::int                          AS refusals
         FROM (
           SELECT thread_id,
                  MIN(user_id::text)::uuid AS user_id,
                  COUNT(*)                 AS turns,
                  MIN(created_at)          AS started_at,
                  MAX(created_at)          AS last_at,
                  -- The first question asked, which is what the conversation is ABOUT. Bounded, so
                  -- one long paste cannot stretch every row in the table.
                  LEFT((ARRAY_AGG(prompt ORDER BY created_at))[1], 160) AS opener,
                  COUNT(*) FILTER (WHERE refused_reason IS NOT NULL)    AS refusals
             FROM ai_calls
            WHERE kind = 'assistant' AND thread_id IS NOT NULL
            GROUP BY thread_id
         ) c
         LEFT JOIN users u ON u.id = c.user_id
        ORDER BY c.last_at DESC
        LIMIT 100`,
    );
  }

  /** One conversation, in order. */
  async thread(
    threadId: string,
  ): Promise<Array<{ prompt: string; response: string | null; refusedReason: string | null; tookMs: number | null; createdAt: Date }>> {
    return this.db.$queryRawUnsafe(
      `SELECT prompt,
              response,
              refused_reason AS "refusedReason",
              took_ms        AS "tookMs",
              created_at     AS "createdAt"
         FROM ai_calls
        WHERE thread_id = $1::uuid AND kind = 'assistant'
        ORDER BY created_at ASC
        LIMIT 200`,
      threadId,
    );
  }

  /**
   * Runs the retrieval plan.
   *
   * ★ IN PARALLEL, AND DEDUPLICATED ★
   *
   * The legs are independent, so running them in sequence would add their latencies for no reason.
   * They also overlap — a question about Deciat matches by name AND spatially — and the same fact
   * twice in the context is a fact the model weights twice.
   */
  async #gather(question: string): Promise<Fact[]> {
    const plan = planFor(question, await this.#commodityNames());

    const legs: Array<Promise<Fact[]>> = [this.knowledge.semantic(question)];

    for (const name of plan.names) legs.push(this.knowledge.byName(name, 4));

    if (plan.near !== null) {
      legs.push(this.knowledge.near(plan.near.system, plan.near.radiusLy, 6));
    }

    if (plan.market !== null) {
      const { commodity, side } = plan.market;
      legs.push(this.knowledge.market(commodity, side));
    }

    const settled = await Promise.allSettled(legs);

    const seen = new Set<string>();
    const facts: Fact[] = [];
    for (const leg of settled) {
      // One failed retrieval must not lose the others: an unreachable embedding model should cost
      // the semantic leg, not the whole answer.
      if (leg.status !== 'fulfilled') continue;
      for (const f of leg.value) {
        const key = `${f.source}|${f.kind}|${f.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push(f);
      }
    }

    // Bounded. Past a dozen the context stops helping and starts burying the relevant rows.
    return facts.slice(0, 12);
  }

  /**
   * The commodity names the router matches against.
   *
   * ★ CACHED, BECAUSE THE QUERY IS A SCAN ★
   *
   * `SELECT DISTINCT commodity FROM market_entries` reads eighteen million rows and takes about ten
   * seconds. Running it per question would make every question take ten seconds, and running it
   * while the nightly market rebuild holds the table would make it take considerably longer than
   * that — the exact failure the EDDN collector was rewritten to avoid.
   *
   * The list changes when Frontier ships an update. An hour stale is not a problem.
   */
  async #commodityNames(): Promise<string[]> {
    if (this.#commodities.length > 0 && Date.now() - this.#commoditiesAt < COMMODITIES_TTL_MS) {
      return this.#commodities;
    }

    try {
      const rows = await this.db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '30s'`);
          return tx.$queryRawUnsafe<Array<{ commodity: string }>>(
            `SELECT DISTINCT commodity FROM market_entries`,
          );
        },
        { timeout: 45_000 },
      );
      if (rows.length > 0) {
        this.#commodities = rows.map((r) => r.commodity);
        this.#commoditiesAt = Date.now();
      }
    } catch {
      // Keep whatever we had. Market routing degrades; every other leg is unaffected.
    }

    return this.#commodities;
  }

  async #overLimit(userId: string): Promise<boolean> {
    const since = new Date(Date.now() - 3_600_000);
    const n = await this.db.aiCall.count({
      where: { userId, kind: 'assistant', createdAt: { gte: since } },
    });
    return n >= HOURLY_LIMIT;
  }

  /** Best-effort, always. A log write must never fail the answer it is describing. */
  async #record(
    userId: string | null,
    surface: string,
    prompt: string,
    response: string | null,
    threadId: string | null,
    refusedReason: string | null,
    startedAt: number,
  ): Promise<void> {
    await this.log
      .record({
        userId,
        kind: 'assistant',
        surface,
        prompt,
        response,
        threadId,
        ...(refusedReason === null ? {} : { refusedReason }),
        tookMs: Date.now() - startedAt,
      })
      .catch(() => undefined);
  }
}

/**
 * Turns facts into the block the model reads.
 *
 * Numbered, because the model is asked to ground its answer in them and a numbered list is
 * something it can point at. The source is named on every line so "our forum guide says" and "the
 * galaxy dump says" stay distinguishable — they carry very different authority.
 */
function renderFacts(facts: readonly Fact[]): string {
  return facts.map((f, i) => `[${i + 1}] (${f.source}/${f.kind}) ${f.name}: ${f.text}`).join('\n');
}
