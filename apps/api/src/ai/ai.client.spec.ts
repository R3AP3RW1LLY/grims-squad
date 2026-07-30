import { describe, it, expect, vi } from 'vitest';
import { AiClient, aiConfigFrom, parseScreenJson } from './ai.client.js';

/**
 * Talking to a model on somebody's home GPU.
 *
 * ★ THE PROPERTY THAT MATTERS MOST ★
 *
 * The machine may be off, asleep, or behind a tunnel that has dropped. That is a NORMAL state.
 * Every one of those has to come back as `unavailable` rather than as an exception — because
 * screening is on the post path, and a throw here means the forum stops working whenever somebody
 * reboots their PC.
 *
 * ★ AND THE ONE THAT IS SUBTLER ★
 *
 * An unparseable answer must NOT be read as "clear". An answer nobody understood is not evidence
 * that a post is fine, and defaulting to clear would let a confused or swapped model silently
 * switch moderation off while appearing to work.
 */

const CONFIG = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' };

const reply = (content: string) =>
  ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) as unknown as Response;

describe('when the AI cannot be reached', () => {
  it('MANDATORY: an unconfigured AI is unavailable, never an error', async () => {
    const out = await new AiClient(null).screen('hello');
    expect(out.verdict).toBe('unavailable');
  });

  it('MANDATORY: a refused connection is unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const out = await new AiClient(CONFIG, fetchImpl as never).screen('hello');
    expect(out.verdict).toBe('unavailable');
  });

  it('MANDATORY: an HTTP error is unavailable', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }) as Response);
    const out = await new AiClient(CONFIG, fetchImpl as never).screen('hello');
    expect(out.verdict).toBe('unavailable');
  });

  it('MANDATORY: an unparseable answer is unavailable, NOT clear', async () => {
    /*
     * THE SUBTLE ONE. Treating "I could not read that" as "the post is fine" means a confused
     * model silently disables moderation while every request still returns 200.
     */
    const fetchImpl = vi.fn(async () => reply('I think this post is probably fine, mate.'));
    const out = await new AiClient(CONFIG, fetchImpl as never).screen('hello');
    expect(out.verdict).toBe('unavailable');
  });

  it('aborts rather than abandoning a stalled request', async () => {
    /*
     * An AbortController rather than a Promise.race: a race leaves the request running, so a
     * stalled tunnel accumulates one abandoned connection per post while the machine at the other
     * end keeps generating tokens nobody will read.
     */
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return reply('{"flagged":false,"categories":[],"reason":""}');
    });
    await new AiClient(CONFIG, fetchImpl as never).screen('hello');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('MANDATORY: never retries', async () => {
    // Screening is synchronous with a member watching a button, so a retry is only a longer wait
    // for the same answer. The moderation queue IS the retry.
    const fetchImpl = vi.fn(async () => ({ ok: false }) as Response);
    await new AiClient(CONFIG, fetchImpl as never).screen('hello');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('reading a verdict', () => {
  it('clears a post the model did not flag', async () => {
    const fetchImpl = vi.fn(async () => reply('{"flagged":false,"categories":[],"reason":""}'));
    const out = await new AiClient(CONFIG, fetchImpl as never).screen('o7 commanders');
    expect(out.verdict).toBe('clear');
    expect(out.categories).toEqual([]);
  });

  it('flags with categories and keeps the reason for the reviewer', async () => {
    const fetchImpl = vi.fn(async () =>
      reply('{"flagged":true,"categories":["harassment"],"reason":"Directed insult"}'),
    );
    const out = await new AiClient(CONFIG, fetchImpl as never).screen('...');
    expect(out.verdict).toBe('flagged');
    expect(out.categories).toEqual(['harassment']);
    expect(out.reason).toBe('Directed insult');
  });

  it('screens at temperature zero', async () => {
    /*
     * The same post must reach the same verdict twice. A moderator who sees a post cleared on
     * retry that was flagged a minute ago cannot trust either answer, and members would quickly
     * learn to simply post again.
     */
    const fetchImpl = vi.fn(async () => reply('{"flagged":false,"categories":[],"reason":""}'));
    await new AiClient(CONFIG, fetchImpl as never).screen('x');

    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.temperature).toBe(0);
  });
});

describe('parsing what the model actually sends', () => {
  it('tolerates a fenced code block', () => {
    // Told to return only JSON, models wrap it anyway. That is not a reason to lose a good verdict.
    const out = parseScreenJson('```json\n{"flagged":true,"categories":["spam"],"reason":"ad"}\n```');
    expect(out).toMatchObject({ flagged: true, categories: ['spam'] });
  });

  it('tolerates a preamble', () => {
    const out = parseScreenJson('Here is the result: {"flagged":false,"categories":[],"reason":""}');
    expect(out?.flagged).toBe(false);
  });

  it('MANDATORY: refuses a non-boolean flagged', () => {
    /*
     * A model answering `"flagged": "no"` is answering a different question. Coercing a truthy
     * string here would make "no" mean flagged — the exact inversion that would be hardest to
     * notice, because most posts are fine and would simply start being held.
     */
    expect(parseScreenJson('{"flagged":"yes","categories":[],"reason":""}')).toBeNull();
    expect(parseScreenJson('{"flagged":"no","categories":[],"reason":""}')).toBeNull();
    expect(parseScreenJson('{"flagged":1,"categories":[],"reason":""}')).toBeNull();
  });

  it('drops categories the system does not define', () => {
    // A reviewer filtering by category should never meet one that is not in the list.
    const out = parseScreenJson('{"flagged":true,"categories":["harassment","vibes"],"reason":"x"}');
    expect(out?.categories).toEqual(['harassment']);
  });

  it('deduplicates repeated categories', () => {
    const out = parseScreenJson('{"flagged":true,"categories":["spam","spam"],"reason":"x"}');
    expect(out?.categories).toEqual(['spam']);
  });

  it('returns null for anything that is not an object', () => {
    expect(parseScreenJson('not json at all')).toBeNull();
    expect(parseScreenJson('[1,2,3]')).toBeNull();
    expect(parseScreenJson('')).toBeNull();
  });
});

describe('configuration', () => {
  it('is null when nothing is set, which is a legitimate state', () => {
    // The site must run with no AI at all — that is how it runs today, and how it runs whenever
    // the owner's machine is off.
    expect(aiConfigFrom({})).toBeNull();
    expect(aiConfigFrom({ AI_BASE_URL: 'http://x/v1' })).toBeNull();
    expect(aiConfigFrom({ AI_MODEL: 'qwen' })).toBeNull();
  });

  it('trims a trailing slash so the path is not doubled', () => {
    const config = aiConfigFrom({ AI_BASE_URL: 'http://x/v1/', AI_MODEL: 'qwen' });
    expect(config?.baseUrl).toBe('http://x/v1');
  });
});
