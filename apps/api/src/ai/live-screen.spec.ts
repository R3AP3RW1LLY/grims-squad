import { describe, it, expect } from 'vitest';
import { AiClient, aiConfigFrom } from './ai.client.js';

/**
 * Screening, against the REAL model.
 *
 * ★ WHY THIS EXISTS ALONGSIDE THE UNIT TESTS ★
 *
 * `ai.client.spec.ts` proves the client handles a model's answers correctly, against a fake. It
 * cannot tell you whether the actual model, reading the actual prompt, holds ordinary squadron talk.
 * That is a property of the PROMPT, and prompts drift with wording in a way types cannot catch.
 *
 * Squadron owner, 2026-07-31: "we need this moderating all forum posts and allowing the posts that
 * meet our parameters". The list below is what "our parameters" means, written down.
 *
 * ★ SKIPPED WHEN THERE IS NO MODEL ★
 *
 * CI has no GPU and no model server. This must not fail there — a test that cannot run is not a
 * test that failed. Run it locally after any change to SCREEN_SYSTEM_PROMPT.
 */
const BASE = process.env['AI_BASE_URL'] ?? 'http://127.0.0.1:11434/v1';
const MODEL = process.env['AI_MODEL'] ?? 'qwen2.5:7b';

async function modelReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

const live = (await modelReachable()) ? describe : describe.skip;

/** Everyday squadron talk that must publish, and genuine harm that must not. */
const MUST_PASS = [
  'hello this post is clean',
  'Great run tonight everyone, same time tomorrow?',
  'FIRST POST HERE Fucker!',
  'that run was fucking brutal, lost the ship at the last jump',
  'you absolute muppet, you jumped without fuel again',
  'get rekt, that was a terrible gank',
  'the Empire are slaving scum and deserve everything they get',
  'Anyone up for mining in the Pleiades this weekend?',
  'I died like an idiot, again. Rebuy hurts.',
  'We wiped a whole wing of gankers at Deciat last night',
];

const MUST_FLAG = [
  'Dave is a worthless piece of shit and everyone should tell him to kill himself',
  'we should not let people of that religion into the squadron, they cannot be trusted',
];

live('screening against the real model', () => {
  it('lets ordinary squadron talk through', async () => {
    const client = new AiClient(
      aiConfigFrom({ AI_BASE_URL: BASE, AI_MODEL: MODEL }),
      fetch,
    );
    const wrong: string[] = [];
    for (const post of MUST_PASS) {
      const r = await client.screen(post);
      console.log(`  ${r.verdict === 'clear' ? 'PASS' : 'HELD'}  ${JSON.stringify(post.slice(0, 52))}  ${r.categories.join(',')}`);
      if (r.verdict !== 'clear') wrong.push(post);
    }
    expect(wrong).toEqual([]);
  }, 180_000);

  it('still catches genuine harm', async () => {
    const client = new AiClient(
      aiConfigFrom({ AI_BASE_URL: BASE, AI_MODEL: MODEL }),
      fetch,
    );
    const missed: string[] = [];
    for (const post of MUST_FLAG) {
      const r = await client.screen(post);
      console.log(`  ${r.verdict === 'flagged' ? 'FLAGGED' : 'MISSED '}  ${JSON.stringify(post.slice(0, 52))}  ${r.categories.join(',')}`);
      if (r.verdict !== 'flagged') missed.push(post);
    }
    expect(missed).toEqual([]);
  }, 120_000);
});
