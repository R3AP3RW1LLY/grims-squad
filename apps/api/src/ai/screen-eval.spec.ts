import { describe, it, expect } from 'vitest';
import { AiClient, aiConfigFrom } from './ai.client.js';
import { SCREEN_EVAL } from './screen-eval.js';

/**
 * Screening, scored against the labelled set.
 *
 * Skipped when no model is reachable, so CI — which has no GPU — is unaffected. A test that cannot
 * run is not a test that failed. Run it after ANY change to SCREEN_SYSTEM_PROMPT.
 */
const BASE = process.env['AI_BASE_URL'] ?? 'http://127.0.0.1:11434/v1';
const MODEL = process.env['AI_MODEL'] ?? 'qwen2.5:7b';

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
}

const live = (await reachable()) ? describe : describe.skip;

live(`screening scored against the eval set (${MODEL})`, () => {
  it('gets every case right', async () => {
    const client = new AiClient(aiConfigFrom({ AI_BASE_URL: BASE, AI_MODEL: MODEL }), fetch);
    const wrong: string[] = [];

    for (const c of SCREEN_EVAL) {
      const r = await client.screen(c.text);
      // `unavailable` counts as wrong: a screener that cannot answer is not a screener.
      const got = r.verdict === 'flagged' ? 'flagged' : r.verdict === 'clear' ? 'clear' : 'unavailable';
      const ok = got === c.expect;
      if (!ok) wrong.push(`${c.expect.toUpperCase()} expected, got ${got.toUpperCase()}: ${JSON.stringify(c.text)}  (${c.because})`);
      console.log(`  ${ok ? 'ok  ' : 'WRONG'} ${c.expect.padEnd(7)} ${JSON.stringify(c.text.slice(0, 56))}`);
    }

    console.log(`\n  ${SCREEN_EVAL.length - wrong.length}/${SCREEN_EVAL.length} correct`);
    for (const w of wrong) console.log(`  - ${w}`);
    expect(wrong).toEqual([]);
  }, 300_000);
});
