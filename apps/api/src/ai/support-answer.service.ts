import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { AI_NAME } from '@grims/shared';
import { AiClient } from './ai.client.js';
import { AiLog } from './ai-log.port.js';
import { EmbedClient } from './embed.client.js';

/**
 * The support chat's answer leg — GMSD AI reading the help pages, and nothing else.
 *
 * ★ THE OWNER'S RULING: AI ANSWERS FIRST, HUMAN ON DEMAND ★
 *
 * "AI supported... ensure our AI is 100% trained and accurate on the website processes" — and the
 * approved design answers that with retrieval, not with training: the assistant answers from the
 * 57-article help corpus that DESCRIBES every surface of this site, so its accuracy is the
 * corpus's accuracy, and a wrong answer is corrected by editing an article rather than by
 * retraining anything.
 *
 * ★ HELP-TAGGED ONLY, AND THAT IS THE WHOLE DESIGN ★
 *
 * Retrieval here is narrowed to `source='reference' AND kind='help'` — the rows
 * `ingest-reference.ts` writes from docs/help, each carrying its article's route in `data.url`.
 * The general assistant's corpus (galaxy data, forum guides, market prices) is deliberately out
 * of reach: a member asking the SUPPORT chat "how do I pair the app" must be answered from the
 * article written for that question, not from whatever forum guide embeds nearest. A 'guide' row
 * surfacing in a support answer is a bug, and the spec pins it.
 *
 * ★ THREE HONEST OUTCOMES, AND NEVER A GUESS ★
 *
 *   an answer     grounded in retrieved passages, quoting the site's own labels, ending with
 *                 the article route(s) it drew from — appended HERE, not generated, so the model
 *                 cannot invent a link.
 *   "not here"    retrieval found nothing over the floor: the turn says plainly that the help
 *                 pages do not answer it and points at the officer button. No model call at all —
 *                 an empty passage block would invite the model to answer from its weights.
 *   null          the AI cannot take this turn: unconfigured, the embedder unreachable, or the
 *                 model itself down. The caller treats the conversation as officer-handled for
 *                 that message — a requester must never be stranded talking to a dead model, and
 *                 they are never shown an error for it.
 */

/** How many help passages one answer is built from. The corpus is small; six is plenty. */
const PASSAGE_LIMIT = 6;

/**
 * The same cosine floor the assistant's semantic leg uses, for the same measured reason:
 * questions the corpus covers land 0.6–0.8, questions it does not sit under 0.5. Below the floor
 * the honest answer is the "not here" turn, never the least-unrelated paragraph.
 */
const MIN_SIMILARITY = 0.55;

/** How many turns of the conversation ride along. Enough for a follow-up, not enough to drift. */
const HISTORY_TURNS = 6;

/** How much of a question the log keeps. A whole pasted screed is not a useful log line. */
const LOGGED_PROMPT_CHARS = 500;

/**
 * What the AI turn says when the help pages do not answer the question.
 *
 * A fixed sentence rather than a generated one: the model is not consulted when there is nothing
 * to ground it, so this is the one turn whose wording the code owns outright. It names the
 * button, because "an officer is available" without saying how is a hint, not a hand-off.
 */
export const NOT_IN_HELP_PAGES =
  'The help pages do not answer that one. Press "Talk to an officer" below and a person picks ' +
  'this conversation up from here.';

/**
 * The rules the model answers under. Written as prohibitions, like the assistant's prompt,
 * because prohibitions are what fail: handed six passages and a question they do not cover, a
 * model will bridge the gap with something that sounds right.
 */
const SUPPORT_SYSTEM_PROMPT = [
  `You are ${AI_NAME}, answering in the live help chat on the Grim's Squad website.`,
  '',
  'You answer ONLY from the HELP PAGES passages provided below. They are the squadron\'s own',
  'help articles, and they describe every page and process on this site.',
  '',
  'Rules, in order of importance:',
  '1. If the passages do not answer the question, say so plainly and tell the person that the',
  '   "Talk to an officer" button below this chat brings a real person into the conversation.',
  '   Do not fill the gap from general knowledge, however confident you are.',
  '2. Use the site\'s own words for anything on screen: quote button labels, tab names, page',
  '   names and settings exactly as the passages spell them, in double quotes.',
  '3. Do not write URLs or file paths. The relevant help article links are appended to your',
  '   answer automatically.',
  '4. Be brief. Two or three short sentences, in plain British English. Plain text only — no',
  '   headings, no markdown, no bullet symbols.',
  '5. You are talking to a member or visitor of the website, not a developer. Name what they',
  '   should press and where it is, not how it works inside.',
].join('\n');

/** One retrieved help passage, with the article it belongs to. */
interface HelpPassage {
  readonly name: string;
  readonly text: string;
  /** The article's route (`data.url` from the ingest), for the appended link. */
  readonly url: string | null;
}

export interface SupportTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

@Injectable()
export class SupportAnswerService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(EmbedClient) private readonly embed: EmbedClient | null,
    @Inject(AiLog) private readonly log: AiLog,
  ) {}

  /**
   * One AI turn for a support conversation, or null when the AI cannot take it.
   *
   * Null is a STATE, not an error — the caller hands the conversation to the officers and says
   * nothing to the requester, exactly as `notify.ts` swallows a bell that cannot ring. Every
   * other failure inside is already an answer: "not in the help pages" is a real turn.
   */
  async answer(
    question: string,
    history: readonly SupportTurn[],
    who: { conversationId: string; userId: string | null },
  ): Promise<string | null> {
    const startedAt = Date.now();

    // Unconfigured is a legitimate state (the owner's machine may be off for days) and the
    // support desk worked before the AI existed: the officers simply answer everything.
    if (!this.ai.configured) return null;

    const passages = await this.#helpPassages(question);

    /*
     * The embedder is DOWN, not merely empty-handed. Without a vector there is no way to know
     * whether the corpus covers the question, so claiming "the help pages do not answer that"
     * would be a guess about our own ignorance — the one turn this service must never fake.
     */
    if (passages === null) {
      await this.#record(who, question, null, 'embedder unreachable', startedAt);
      return null;
    }

    /*
     * ★ NOTHING RETRIEVED MEANS NO MODEL CALL AT ALL ★
     *
     * The assistant's doctrine, applied to support: an empty passage block asks the model to
     * answer from its weights, which is the exact behaviour the design exists to prevent. The
     * fixed sentence is more honest and faster — and it is still a real AI turn, so the
     * conversation stays AI-handled until the requester asks for a person.
     */
    if (passages.length === 0) {
      await this.#record(who, question, NOT_IN_HELP_PAGES, 'nothing retrieved from help', startedAt);
      return NOT_IN_HELP_PAGES;
    }

    const raw = await this.ai.ask(SUPPORT_SYSTEM_PROMPT, [
      ...history.slice(-HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content })),
      {
        role: 'user' as const,
        content: `HELP PAGES:\n${renderPassages(passages)}\n\nQUESTION: ${question}`,
      },
    ]);

    // The model itself is unreachable or answered nothing. Same as unconfigured: the officers
    // take it, silently. The record keeps the null response — that is itself worth knowing.
    if (raw === null) {
      await this.#record(who, question, null, null, startedAt);
      return null;
    }

    const reply = `${raw.trim()}${sourcesSuffix(passages)}`;
    await this.#record(who, question, reply, null, startedAt);
    return reply;
  }

  /**
   * The help corpus's passages nearest the question, or null when the embedder is unreachable.
   *
   * ★ THE NARROWING LIVES IN THE WHERE, NOT IN A FILTER AFTERWARDS ★
   *
   * `source='reference' AND kind='help'` inside the ranked subquery, so a 'guide' or 'document'
   * row can never occupy one of the top-N seats and then be filtered into an empty answer — and
   * can never survive into the prompt at all. The help corpus is a few hundred chunks, so the
   * planner's freedom to scan them instead of walking the HNSW index costs nothing.
   */
  async #helpPassages(question: string): Promise<HelpPassage[] | null> {
    if (this.embed === null || !this.embed.configured) return null;

    const vector = await this.embed.embed(question);
    if (vector === null) return null;

    const rows = await this.db.$queryRawUnsafe<
      Array<{ name: string; text: string | null; data: unknown; similarity: number }>
    >(
      `SELECT name, text, data, similarity
         FROM (
           SELECT name, text, data,
                  1 - (embedding <=> $1::vector) AS similarity
             FROM knowledge_items
            WHERE source = 'reference' AND kind = 'help' AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT $2
         ) ranked
        WHERE similarity >= $3
        ORDER BY similarity DESC`,
      `[${vector.join(',')}]`,
      PASSAGE_LIMIT,
      MIN_SIMILARITY,
    );

    return rows
      .filter((r): r is typeof r & { text: string } => typeof r.text === 'string' && r.text !== '')
      .map((r) => {
        const data = (r.data ?? {}) as Record<string, unknown>;
        return {
          name: r.name,
          text: r.text,
          url: typeof data['url'] === 'string' && data['url'] !== '' ? data['url'] : null,
        };
      });
  }

  /** Best-effort, always — a log write must never fail the answer it describes. */
  async #record(
    who: { conversationId: string; userId: string | null },
    question: string,
    response: string | null,
    refusedReason: string | null,
    startedAt: number,
  ): Promise<void> {
    await this.log
      .record({
        userId: who.userId,
        kind: 'support',
        surface: 'support',
        prompt: question.slice(0, LOGGED_PROMPT_CHARS),
        response,
        // The conversation id is the thread: officer review reads a support conversation the
        // same way it reads an assistant one — as one exchange, not shuffled turns.
        threadId: who.conversationId,
        ...(refusedReason === null ? {} : { refusedReason }),
        tookMs: Date.now() - startedAt,
      })
      .catch(() => undefined);
  }
}

/**
 * The passage block the model reads. Numbered, like the assistant's FACTS, so an answer has
 * something to point at. Each passage's text already opens with its article title — the ingest
 * put it there so a chunk is never disembodied advice.
 */
function renderPassages(passages: readonly HelpPassage[]): string {
  return passages.map((p, i) => `[${i + 1}] ${p.text}`).join('\n');
}

/** Past this many articles the suffix stops being a pointer and starts being a bibliography. */
const MAX_SOURCE_LINES = 3;

/**
 * The article route(s) the answer drew from, appended after the model's words.
 *
 * Appended HERE so a link can never be invented: every route below came out of a retrieved
 * row's `data.url`, which the ingest read from the article's own frontmatter. Deduplicated
 * because a long article retrieves as several chunks of one page, and bounded to the
 * best-matching few — the passages arrive similarity-first, so the cut keeps the articles the
 * answer actually leaned on.
 *
 * Some articles document the COMPANION APP's screens, whose frontmatter route is a screen name
 * ("Settings") rather than a site path. Those keep their title and drop the dash — a screen
 * name presented in link position reads as a broken link.
 */
function sourcesSuffix(passages: readonly HelpPassage[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of passages) {
    if (lines.length >= MAX_SOURCE_LINES) break;
    if (p.url === null) continue;
    const line = p.url.startsWith('/') ? `${p.name} — ${p.url}` : p.name;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  if (lines.length === 0) return '';
  return lines.length === 1
    ? `\n\nFrom the help pages: ${lines[0]}`
    : `\n\nFrom the help pages:\n${lines.join('\n')}`;
}
