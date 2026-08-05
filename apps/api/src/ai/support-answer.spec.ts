import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@grims/db';
import type { AiClient } from './ai.client.js';
import type { EmbedClient } from './embed.client.js';
import { AiLog, type AiCallRecord } from './ai-log.port.js';
import { NOT_IN_HELP_PAGES, SupportAnswerService } from './support-answer.service.js';

/**
 * The support chat's answer leg, against recording stubs.
 *
 * ★ WHAT CARRIES THE FEATURE ★
 *
 * Three properties are the approved design, and each has a MANDATORY test: retrieval is
 * narrowed to the help corpus and NOTHING else can reach the prompt; an empty retrieval is the
 * honest fixed sentence with no model call at all; and every way the AI can be absent —
 * unconfigured, embedder down, model down — is null, never an error and never a guess.
 */

/** A believable embedding. The service only joins it into the query string. */
const VECTOR = Array.from({ length: 8 }, (_, i) => i / 10);

interface HelpRow {
  name: string;
  text: string | null;
  data: unknown;
  similarity: number;
}

/** What one retrieval-narrowing regression would surface as. See the MANDATORY test. */
const POISON_GUIDE: HelpRow = {
  name: 'Painite mining, the long way',
  text: 'POISON-GUIDE-PROSE: fit a Type-9 and undermine the void opals…',
  data: { url: '/forum/guides/painite' },
  similarity: 0.99,
};

function stubDb(rows: HelpRow[] = []): { db: PrismaClient; queries: string[] } {
  const queries: string[] = [];
  const db = {
    $queryRawUnsafe: async (sql: string) => {
      queries.push(sql);
      /*
       * ★ ADVERSARIAL, NOT COOPERATIVE ★
       *
       * If the query ever loses its narrowing — source pinned to 'reference' AND kind pinned to
       * 'help', inside the ranked subquery — this stub hands back a forum guide with a perfect
       * similarity score, and the assertion that POISON never reaches the model fails the build.
       * A stub that returned help rows regardless would pass forever no matter what the SQL said.
       */
      const narrowed = sql.includes(`source = 'reference'`) && sql.includes(`kind = 'help'`);
      return narrowed ? rows : [POISON_GUIDE];
    },
  };
  return { db: db as unknown as PrismaClient, queries };
}

function stubAi(over: Partial<{ configured: boolean; reply: string | null }> = {}): {
  ai: AiClient;
  asked: Array<{ system: string; messages: Array<{ role: string; content: string }> }>;
} {
  const asked: Array<{ system: string; messages: Array<{ role: string; content: string }> }> = [];
  const ai = {
    configured: over.configured ?? true,
    ask: async (system: string, messages: Array<{ role: string; content: string }>) => {
      asked.push({ system, messages });
      return over.reply === undefined ? 'Open "Settings", then press "Pair this device".' : over.reply;
    },
  };
  return { ai: ai as unknown as AiClient, asked };
}

function stubEmbed(vector: number[] | null = VECTOR): EmbedClient {
  return { configured: true, embed: async () => vector } as unknown as EmbedClient;
}

class RecordingLog extends AiLog {
  readonly records: AiCallRecord[] = [];
  override async record(entry: AiCallRecord): Promise<void> {
    this.records.push(entry);
  }
}

const HELP_ROW: HelpRow = {
  name: 'Pair the companion app',
  text: 'Pair the companion app\n\nOpen "Settings", press "Pair this device" and approve the code in your browser.',
  data: { url: '/help/companion-pairing' },
  similarity: 0.82,
};

const WHO = { conversationId: 'c1', userId: 'u1' };

describe('retrieval is the help corpus and nothing else', () => {
  it('MANDATORY: a guide row must never be quoted — the narrowing lives inside the ranked subquery', async () => {
    const { db, queries } = stubDb([HELP_ROW]);
    const { ai, asked } = stubAi();
    const log = new RecordingLog();
    const svc = new SupportAnswerService(db, ai, stubEmbed(), log);

    const answer = await svc.answer('how do I pair the app?', [], WHO);

    // The narrowing was IN the SQL the database saw — not a filter after the fact.
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain(`source = 'reference'`);
    expect(queries[0]).toContain(`kind = 'help'`);

    // What the model read was the help passage; the poison guide reached nothing, ever.
    expect(asked).toHaveLength(1);
    const prompt = JSON.stringify(asked[0]);
    expect(prompt).toContain('Pair the companion app');
    expect(prompt).not.toContain('POISON-GUIDE-PROSE');
    expect(answer).not.toBeNull();
    expect(answer).not.toContain('POISON-GUIDE-PROSE');
  });

  it('the answer ends with the article route(s) it drew from, each named once', async () => {
    const twoChunksOneArticle: HelpRow[] = [
      HELP_ROW,
      { ...HELP_ROW, similarity: 0.7 }, // a second chunk of the same page
      {
        name: 'Reset two-factor sign-in',
        text: 'Reset two-factor sign-in\n\nAsk an officer to clear it from the admin console.',
        data: { url: '/help/two-factor' },
        similarity: 0.6,
      },
    ];
    const svc = new SupportAnswerService(
      stubDb(twoChunksOneArticle).db,
      stubAi().ai,
      stubEmbed(),
      new RecordingLog(),
    );

    const answer = await svc.answer('how do I pair the app?', [], WHO);

    expect(answer).toContain('From the help pages:');
    expect(answer).toContain('Pair the companion app — /help/companion-pairing');
    expect(answer).toContain('Reset two-factor sign-in — /help/two-factor');
    // One link per ARTICLE, not per chunk.
    expect(answer?.match(/\/help\/companion-pairing/g)).toHaveLength(1);
    // And the links come after the model's words, not instead of them.
    expect(answer?.startsWith('Open "Settings"')).toBe(true);
  });
});

describe('nothing retrieved is the honest sentence, never a guess', () => {
  it('MANDATORY: no passages over the floor means NO model call and the fixed hand-off line', async () => {
    const { ai, asked } = stubAi();
    const log = new RecordingLog();
    const svc = new SupportAnswerService(stubDb([]).db, ai, stubEmbed(), log);

    const answer = await svc.answer('what is the capital of France?', [], WHO);

    // The model was never consulted — an empty passage block would invite its weights to answer.
    expect(asked).toHaveLength(0);
    expect(answer).toBe(NOT_IN_HELP_PAGES);
    // The turn still points at the officer button: the hand-off is IN the sentence.
    expect(answer).toContain('Talk to an officer');
    expect(log.records[0]?.refusedReason).toContain('nothing retrieved');
  });
});

describe('the AI being absent is null — the caller hands the conversation to a person', () => {
  it('MANDATORY: unconfigured, embedder down, and model down all answer null, never a turn', async () => {
    const log = new RecordingLog();

    // Unconfigured: the owner's machine may simply be off. Nothing else is even consulted.
    const unconfigured = new SupportAnswerService(
      stubDb([HELP_ROW]).db,
      stubAi({ configured: false }).ai,
      stubEmbed(),
      log,
    );
    await expect(unconfigured.answer('how do I pair?', [], WHO)).resolves.toBeNull();

    /*
     * Embedder unreachable: without a vector there is no way to know whether the corpus covers
     * the question, so claiming "the help pages do not answer that" would be a guess about our
     * own ignorance — the one turn this service must never fake.
     */
    const embedderDown = new SupportAnswerService(
      stubDb([HELP_ROW]).db,
      stubAi().ai,
      stubEmbed(null),
      log,
    );
    await expect(embedderDown.answer('how do I pair?', [], WHO)).resolves.toBeNull();

    // Model unreachable mid-call: retrieval worked, Ollama did not answer.
    const modelDown = new SupportAnswerService(
      stubDb([HELP_ROW]).db,
      stubAi({ reply: null }).ai,
      stubEmbed(),
      log,
    );
    await expect(modelDown.answer('how do I pair?', [], WHO)).resolves.toBeNull();
  });
});

describe('the record for officer review', () => {
  it("logs kind 'support' with the conversation as the thread", async () => {
    const log = new RecordingLog();
    const svc = new SupportAnswerService(stubDb([HELP_ROW]).db, stubAi().ai, stubEmbed(), log);

    await svc.answer('how do I pair the app?', [], WHO);

    expect(log.records).toHaveLength(1);
    expect(log.records[0]).toMatchObject({
      kind: 'support',
      surface: 'support',
      userId: 'u1',
      threadId: 'c1',
    });
    expect(log.records[0]?.response).toContain('From the help pages');
  });

  it('carries the recent turns so a follow-up stays a follow-up', async () => {
    const { ai, asked } = stubAi();
    const svc = new SupportAnswerService(stubDb([HELP_ROW]).db, ai, stubEmbed(), new RecordingLog());

    await svc.answer(
      'and on my phone?',
      [
        { role: 'user', content: 'how do I pair the app?' },
        { role: 'assistant', content: 'Open "Settings"…' },
      ],
      WHO,
    );

    const messages = asked[0]?.messages ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'how do I pair the app?' });
    expect(messages[1]).toMatchObject({ role: 'assistant' });
    expect(messages[2]?.content).toContain('QUESTION: and on my phone?');
    expect(messages[2]?.content).toContain('HELP PAGES:');
  });
});
