import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { AiClient } from './ai.client.js';
import { AiLog } from './ai-log.port.js';
import { KnowledgeService, type Fact } from './knowledge.service.js';
import { planFor } from './question.js';
import { ShipBuildService } from './ship-build.service.js';
import type { MiningService } from '../mining/mining.service.js';
import type { BgsService } from '../bgs/bgs.service.js';
import type { OpsService } from '../ops/ops.service.js';
import type { ScoutService } from '../colonisation/scout.service.js';

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
  '7. A FACT of kind "fit" is a COMPLETE build our fitting engine computed for that question, with',
  '   real modules and real figures. Give the ship name and the total cost first, then the figures',
  '   that matter for the job. Never substitute a different ship, never adjust the numbers, and',
  '   never add modules it does not mention — if it names compromises, repeat them.',
  '8. A FACT of kind "ring" is a MEASUREMENT from squadron members\' own prospector limpets, not',
  '   lore. Give the ring, what share of rocks were worth shooting, and how recently anybody was',
  '   there. Never name a ring or a hotspot that is not in the FACTS, however well known it is —',
  '   Frontier has reshuffled hotspots more than once and what you remember is likely wrong.',
].join('\n');

@Injectable()
export class AssistantService {
  #commodities: string[] = [];
  #commoditiesAt = 0;

  #ships: Array<{ id: string; name: string }> = [];
  #shipsAt = 0;

  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    private readonly ai: AiClient,
    private readonly knowledge: KnowledgeService,
    private readonly log: AiLog,
    /**
     * The fitting engine.
     *
     * ★ SQUADRON OWNER ★
     *
     * "we want this to be promptable and answered in the Ask GDSM AI."
     *
     * The SAME service the Shipyard's stepper calls. Two answers to "what should I fly for mining
     * with fifty million" — one from a page and one from the assistant — would eventually be two
     * different answers, and the member would have no way to tell which was right.
     */
    private readonly builds: ShipBuildService,
    /**
     * The ring survey.
     *
     * ★ SQUADRON OWNER, 2026-08-06: "if we can add our AI into this some way that would be epic!" ★
     *
     * The SAME service the /mining page reads, for the same reason the fitter is shared: two
     * answers to "where should I mine Painite" — one from a page and one from the assistant — would
     * eventually be two different answers, and the member would have no way to tell which was
     * right.
     *
     * Optional so the assistant keeps working wherever it is absent, which is every existing test
     * that constructs this class with five arguments.
     */
    private readonly mining?: MiningService,
    /**
     * The standing orders.
     *
     * ★ SQUADRON OWNER, 2026-08-06: "incorporate AI where we can too" ★
     *
     * The SAME service the admin console writes and the companion overlay reads. A member asking
     * "who are we pushing" and an officer reading the console must not be told different things —
     * and unlike every other leg, being wrong here means a member spends their evening working
     * against the squadron.
     *
     * Optional for the same reason the ring survey is: every existing test constructs this class
     * without it.
     */
    private readonly bgs?: BgsService,
    /**
     * The operations board.
     *
     * The SAME service the /ops page and the officer console read. "What is on tonight" is the most
     * asked question in any squadron and it has never had an answer here — `operations` is touched
     * by no other leg, so without this the assistant answers from forum prose about an op that ran
     * in March.
     */
    private readonly ops?: OpsService,
    /**
     * The colonisation scout.
     *
     * "Where should we colonise next" is answered from live galaxy data and our own station table —
     * which systems can be claimed, from which station, extending whose power. Without it the
     * assistant answers from forum posts about a system somebody claimed months ago.
     */
    private readonly scout?: ScoutService,
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

    const facts = await this.#gather(q, userId);

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
          'and modules, our guides, and the squadron roster — and I can work out what to fly for ' +
          'mining, combat, exploration or trading, to a budget if you give me one. Try one of those.',
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
  async #gather(
    question: string,
    /*
     * The caller, threaded through only because the operations leg needs it: a member asking what
     * is on tonight who is ALREADY signed up should be told so. Null for a signed-out visitor,
     * which the board handles.
     */
    userId: string | null,
  ): Promise<Fact[]> {
    const plan = planFor(question, await this.#commodityNames(), await this.#shipNames());

    const legs: Array<Promise<Fact[]>> = [this.knowledge.semantic(question)];

    if (plan.fit !== null) legs.push(this.#fitLeg(plan.fit));

    for (const name of plan.names) legs.push(this.knowledge.byName(name, 4));

    if (plan.near !== null) {
      legs.push(this.knowledge.near(plan.near.system, plan.near.radiusLy, 6));
    }

    if (plan.market !== null) {
      const { commodity, side } = plan.market;
      legs.push(this.knowledge.market(commodity, side));
    }

    if (plan.rings !== null && this.mining !== undefined) {
      legs.push(this.#ringLeg(plan.rings.material));
    }

    if (plan.orders !== null && this.bgs !== undefined) {
      legs.push(this.#ordersLeg(plan.orders.system));
    }

    if (plan.ops !== null && this.ops !== undefined) {
      legs.push(this.#opsLeg(userId));
    }

    if (plan.colonise !== null && this.scout !== undefined) {
      legs.push(this.#coloniseLeg(plan.colonise.anchor));
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
   * Rings the squadron has actually been working, rendered as facts.
   *
   * ★ MEASURED, NOT REMEMBERED ★
   *
   * Without this leg, "where should I mine Painite" falls to the semantic search, which finds
   * whatever mining prose the corpus holds — a wiki page about hotspots from two years ago, handed
   * to the model with exactly the same confidence as a measurement taken last Tuesday. Frontier has
   * reshuffled hotspots more than once since; the prose is not merely stale, it is wrong.
   *
   * What goes in the prompt is the squadron's own limpets: how many rocks, what share of them were
   * worth shooting, and when anybody was last there.
   */
  async #ringLeg(material: string | null): Promise<Fact[]> {
    // Undefined only in tests that construct this class without the mining service; the caller
    // has already checked, and this keeps the narrowing local rather than at the call site.
    if (this.mining === undefined) return [];

    const rings = await this.mining.rings(material, 21, 5);

    /*
     * Nothing measured is a real answer and must not become silence. Returning no fact would drop
     * the question back to the semantic leg — the exact stale-prose failure this leg exists to
     * prevent — so the absence is stated instead, and the model has something true to say.
     */
    if (rings.length === 0) {
      return [
        {
          source: 'mining',
          kind: 'rings',
          name: material === null ? 'ring survey' : `${material} rings`,
          text:
            material === null
              ? 'No squadron member has prospected enough rocks in the last three weeks to measure any ring. The survey is built entirely from members’ own prospector limpets, so it fills as people fly with mining telemetry switched on in the companion app.'
              : `No squadron member has prospected a ring running ${material} in the last three weeks. The survey is built from members’ own prospector limpets and holds nothing about this mineral yet.`,
          url: '/mining',
        },
      ];
    }

    return rings.map((r) => ({
      source: 'mining',
      kind: 'ring',
      name: `${r.body}, ${r.system}`,
      text:
        `${r.body} in ${r.system}: ${r.rocks} rocks prospected by squadron members in the last three weeks, ` +
        `${r.hitRate.toFixed(0)}% of them worth shooting. Mostly running ${r.topMaterial}; ` +
        `richest rock seen was ${r.bestPercent.toFixed(1)}%. Last prospected ${r.lastSeen.toISOString().slice(0, 10)}.`,
      url: '/mining',
    }));
  }

  /**
   * Where the squadron could colonise, rendered as facts.
   *
   * ★ IT REFUSES TO GUESS AN ANCHOR ★
   *
   * A claim reaches fifteen light years from the station selling it, so "where should we colonise"
   * is unanswerable without knowing where FROM. Picking a system on the member's behalf would
   * produce a confident list about the wrong part of the galaxy, so the leg says what it needs
   * instead — which is a useful answer, and an honest one.
   */
  async #coloniseLeg(anchor: string | null): Promise<Fact[]> {
    if (this.scout === undefined) return [];

    if (anchor === null) {
      return [
        {
          source: 'colonisation',
          kind: 'scout',
          name: 'colonisation scout',
          text: 'A colonisation claim only reaches about 15 light years from the station that sells it, so the answer depends entirely on where you are claiming FROM. Name a system — usually a station you already buy colonisation ships at, or a colony the squadron already holds — and the scout lists what can be claimed near it, where each permit is bought, and which power that purchase extends.',
          url: '/colonisation/scout',
        },
      ];
    }

    const out = await this.scout.scout({ anchor });

    if (out.unknownAnchor !== null) {
      return [
        {
          source: 'colonisation',
          kind: 'scout',
          name: 'unknown system',
          text: `We hold no coordinates for “${out.unknownAnchor}”, so nothing can be measured from it. The name has to match the game exactly.`,
          url: '/colonisation/scout',
        },
      ];
    }

    if (out.candidates.length === 0) {
      return [
        {
          source: 'colonisation',
          kind: 'scout',
          name: `nothing claimable near ${out.anchor?.system ?? anchor}`,
          text: `Nothing inside claim range of ${out.anchor?.system ?? anchor} can be claimed — everything nearby is already colonised, inhabited or permit-locked.`,
          url: '/colonisation/scout',
        },
      ];
    }

    /*
     * The top few only. A model handed thirty candidates writes about thirty candidates; the
     * ranking already put the best first, and the page is there for the full list.
     */
    return out.candidates.slice(0, 5).map((c) => ({
      source: 'colonisation',
      kind: 'candidate',
      name: c.system,
      text:
        `${c.system} — claimable, ${c.bodyCount > 0 ? `${c.bodyCount} bodies` : 'body count unknown'}. ` +
        (c.permit === null
          ? 'No station within claim range, so it cannot actually be claimed from anywhere nearby.'
          : `Buy the claim at ${c.permit.system}, ${c.permitLy?.toFixed(1) ?? '?'} ly away` +
            `${c.permit.allegiance === null ? '' : ` — ${c.permit.allegiance}, so claiming it extends that power`}.`) +
        (c.surveyed
          ? ` Nearest landable body ${c.nearestLandableLs === null ? 'none' : `${Math.round(c.nearestLandableLs).toLocaleString()} Ls`} from the arrival star.`
          : ' Not surveyed yet — nothing is known about its bodies.'),
      url: '/colonisation/scout',
    }));
  }

  /**
   * What is actually on the board, rendered as facts.
   *
   * ★ THE MEMBER'S OWN COMMITMENT RIDES WITH IT ★
   *
   * `board` takes the caller's id and returns whether THEY are signed up. A member asking "what is
   * on tonight" who is already committed should be told so — answering as though they had not
   * replied is the fastest way to make an assistant feel like it does not know them.
   */
  async #opsLeg(userId: string | null): Promise<Fact[]> {
    if (this.ops === undefined) return [];

    const board = await this.ops.board(userId);
    const live = board.filter((o) => o.status !== 'cancelled' && o.status !== 'complete');

    /*
     * An empty board is a real answer and must not become silence — falling back to the semantic
     * leg is what produces a confident description of an operation that finished months ago.
     */
    if (live.length === 0) {
      return [
        {
          source: 'ops',
          kind: 'operations',
          name: 'operations board',
          text: 'Nothing is on the operations board right now. Wing leads post ops from the admin area and they appear for everybody the moment they do.',
          url: '/ops',
        },
      ];
    }

    return live.map((o) => {
      const full = o.capacity !== null && o.going >= o.capacity;
      const seats =
        o.capacity === null
          ? `${o.going} going, no limit on numbers`
          : `${o.going} of ${o.capacity} seats taken${o.standby > 0 ? `, ${o.standby} on standby` : ''}${full ? ' — committing now joins the standby queue' : ''}`;

      return {
        source: 'ops',
        kind: 'operation',
        name: o.title,
        text:
          `${o.title} — a ${o.opType} op starting ${o.startsAt.toISOString()}, posted by ${o.createdBy}. ${seats}. ` +
          (o.mine === null
            ? 'You have not said whether you are coming.'
            : o.mine === 'standby'
              ? 'You are on the standby queue for this one.'
              : `You have said "${o.mine}" to this one.`),
        url: '/ops',
      };
    });
  }

  /**
   * What the officers have actually ordered, rendered as facts.
   *
   * ★ THE ONE LEG WHERE BEING VAGUE IS WORSE THAN SILENCE ★
   *
   * Every other leg answers a question about the galaxy; this one answers a question about the
   * squadron's own intent, and a member who acts on a wrong answer spends an evening pushing a
   * faction the officers wanted held back. So it states the stance as a word, names the system, and
   * says plainly when there is nothing rather than producing something plausible.
   */
  async #ordersLeg(system: string | null): Promise<Fact[]> {
    if (this.bgs === undefined) return [];

    const watchlist = await this.bgs.watchlist();

    const want = system?.trim().toLowerCase() ?? null;
    const orders = watchlist.flatMap((f) =>
      f.orders
        .filter((o) => o.activeUntil === null || o.activeUntil.getTime() > Date.now())
        .filter(
          (o) =>
            want === null ||
            (o.systemName !== null && o.systemName.trim().toLowerCase() === want),
        )
        .map((o) => ({ faction: f.name, isOurs: f.isOurs, ...o })),
    );

    /*
     * Nothing ordered is a real answer and must not become silence — dropping back to the semantic
     * leg is exactly the stale-prose failure this leg exists to prevent. It would find a wiki page
     * explaining what influence is and present it as though it were tonight's instructions.
     */
    if (orders.length === 0) {
      return [
        {
          source: 'bgs',
          kind: 'orders',
          name: system === null ? 'standing orders' : `standing orders in ${system}`,
          text:
            system === null
              ? 'The officers have no standing BGS orders in force. Nothing is being pushed, held or suppressed right now, so no mission hand-in scores on the Faction Hands board until an order is set.'
              : `The officers have no standing BGS orders for ${system}. Work done there counts for nothing on the Faction Hands board until one is set.`,
          url: '/bgs',
        },
      ];
    }

    // Most important first, which is also the order an officer set them in.
    orders.sort((a, b) => a.priority - b.priority);

    return orders.map((o) => ({
      source: 'bgs',
      kind: 'order',
      name: `${o.stance} ${o.faction}`,
      text:
        `Standing order: ${o.stance.toUpperCase()} ${o.faction}` +
        `${o.isOurs ? ' (the squadron’s own faction)' : ''}` +
        `${o.systemName === null ? '' : ` in ${o.systemName}`}, priority ${o.priority}. ` +
        (o.stance === 'suppress'
          ? 'Work that WEAKENS this faction scores; helping them costs points.'
          : o.stance === 'hold'
            ? 'Keep influence steady — pushing it higher can trigger an expansion nobody wants. Scores at half rate.'
            : o.stance === 'ignore'
              ? 'Not a target. Nothing done for or against them scores.'
              : 'Missions handed in for this faction score on the Faction Hands board.') +
        (o.guidance === null ? '' : ` Officer's note: ${o.guidance}`),
      url: '/bgs',
    }));
  }

  /**
   * A build, computed and rendered as a fact.
   *
   * ★ THE ANSWER IS COMPUTED BEFORE THE MODEL SEES ANYTHING ★
   *
   * Every module comes from Frontier's data and every figure from the stats calculator. What
   * reaches the prompt is a finished loadout with its price; the model's job is to put sentences
   * around it, which is the same job it has for a market price.
   *
   * This is why the fitter is a retrieval leg rather than a tool the model invokes. A model asked
   * to fit a ship produces modules that do not exist and jump ranges it invented, in the same
   * confident prose as a correct answer — and somebody would go and spend two hundred million
   * credits on it.
   */
  async #fitLeg(want: NonNullable<ReturnType<typeof planFor>['fit']>): Promise<Fact[]> {
    const result = await this.builds.fit({
      role: want.role,
      ...(want.budget === null ? {} : { budget: want.budget }),
      ...(want.shipId === null ? {} : { shipId: want.shipId }),
    });

    /*
     * Nothing affordable is a real answer and must not become silence. Returning no fact would drop
     * the question back to the semantic leg, which would find prose about mining and let the model
     * answer around the budget entirely — the failure being avoided is a recommendation somebody
     * cannot afford, and "nothing at this price" prevents it where a vague answer does not.
     */
    if (result === null) {
      return [
        {
          source: 'shipyard',
          kind: 'fit',
          name: `${want.role} build`,
          text:
            want.budget === null
              ? `No ship could be fitted for ${want.role}.`
              : `Nothing can be fitted for ${want.role} within ${Math.round(want.budget / 1_000_000)} million credits. That budget is below the cheapest hull that can do the job with the modules it needs.`,
          url: '/shipyard?tab=assisted',
        },
      ];
    }

    const s = result.stats;
    const figures = [
      s?.jumpRange == null ? null : `jump ${s.jumpRange} ly`,
      s?.ladenJumpRange == null ? null : `laden jump ${s.ladenJumpRange} ly`,
      s === null ? null : `cargo ${s.cargoCapacity} t`,
      s?.shields == null ? null : `shields ${s.shields} MJ`,
      s === null ? null : `armour ${s.armour}`,
      s?.dps == null ? null : `DPS ${s.dps}`,
      s === null ? null : `power ${s.powerDrawn}/${s.powerGenerated} MW`,
    ].filter((v): v is string => v !== null);

    const lines = [
      `${result.build.shipName}, fitted for ${want.role}.`,
      `Total cost ${result.totalCost.toLocaleString('en-GB')} credits, hull and modules together.`,
      figures.join(', ') + '.',
      result.whyThisShip,
      // Compromises go in verbatim. A fit that could not afford something is still the best answer
      // available, and presenting it without saying so presents a compromise as a recommendation.
      ...result.compromises,
    ];

    return [
      {
        source: 'shipyard',
        kind: 'fit',
        name: `${result.build.shipName} — ${want.role}`,
        text: lines.join(' '),
        /*
         * Points at the outfitter with the hull already chosen, so the member can change anything
         * they disagree with rather than taking the recommendation whole.
         */
        url: `/shipyard?ship=${encodeURIComponent(result.build.shipId)}`,
      },
    ];
  }

  /**
   * Hull names the router matches "fit my Python" against.
   *
   * Cached like the commodity list and for the same reason, though far cheaper: the ship table is
   * forty-odd rows behind a catalogue build, and doing it per question would rebuild the catalogue
   * for every message in a conversation.
   */
  async #shipNames(): Promise<Array<{ id: string; name: string }>> {
    if (this.#ships.length > 0 && Date.now() - this.#shipsAt < COMMODITIES_TTL_MS) {
      return this.#ships;
    }

    try {
      const catalogue = await this.builds.catalogue();
      this.#ships = catalogue.ships().map((ship) => ({ id: ship.id, name: ship.name }));
      this.#shipsAt = Date.now();
    } catch {
      // The coriolis ingest not having run is not a reason to fail every question. The fit leg then
      // matches on the role alone, which still answers "what should I buy for mining".
      this.#ships = [];
    }

    return this.#ships;
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
