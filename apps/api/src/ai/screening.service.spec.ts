import { describe, it, expect, vi } from 'vitest';
import { HELD_MESSAGE, ScreeningService } from './screening.service.js';
import { NullAiLog } from './ai-log.port.js';
import type { AiClient } from './ai.client.js';
import type { ScreenResult } from '@grims/shared';

/**
 * Whether a post may be read.
 *
 * ★ THE RULE ★
 *
 * Squadron owner, 2026-07-30: "the ai must ingest and moderate all posts before they are visible /
 * posted to the forum!" — and, asked what happens when the screener is unreachable: hold it for
 * human review.
 *
 * So there are three verdicts and two outcomes. `flagged` and `unavailable` are different facts
 * with the same consequence, and the tests below pin both halves of that: they must behave
 * identically to a reader, and remain distinguishable to a reviewer.
 */

const ai = (result: ScreenResult, configured = true): AiClient =>
  ({ configured, screen: vi.fn(async () => result) }) as unknown as AiClient;

const CLEAR: ScreenResult = { verdict: 'clear', categories: [], reason: null, tookMs: 12 };
const FLAGGED: ScreenResult = {
  verdict: 'flagged',
  categories: ['harassment'],
  reason: 'Directed insult at a named member',
  tookMs: 900,
};
const DOWN: ScreenResult = { verdict: 'unavailable', categories: [], reason: null, tookMs: 8000 };

describe('screening a post', () => {
  it('clears what the model cleared', async () => {
    const svc = new ScreeningService(ai(CLEAR), new NullAiLog());
    const out = await svc.screenPost('o7 commanders', { userId: 'u1', surface: 'web' });
    expect(out.state).toBe('clear');
  });

  it('MANDATORY: holds what the model flagged', async () => {
    const svc = new ScreeningService(ai(FLAGGED), new NullAiLog());
    const out = await svc.screenPost('...', { userId: 'u1', surface: 'web' });
    expect(out.state).toBe('held');
  });

  it('MANDATORY: holds when the screener is unreachable', async () => {
    /*
     * The owner's explicit choice. The alternative — publish and screen later — breaks the rule
     * that nothing unscreened is visible, and the gap would be exactly as long as the GPU was off.
     */
    const svc = new ScreeningService(ai(DOWN), new NullAiLog());
    const out = await svc.screenPost('perfectly fine post', { userId: 'u1', surface: 'web' });
    expect(out.state).toBe('held');
  });

  it('MANDATORY: flagged and unavailable are indistinguishable in the outcome', async () => {
    /*
     * Because the author is told the same thing either way. If the two produced different states,
     * the difference would eventually surface in the UI and leak whether the model objected to
     * what somebody wrote.
     */
    const flagged = await new ScreeningService(ai(FLAGGED), new NullAiLog()).screenPost('a', {
      userId: 'u1',
      surface: 'web',
    });
    const down = await new ScreeningService(ai(DOWN), new NullAiLog()).screenPost('b', {
      userId: 'u1',
      surface: 'web',
    });
    expect(flagged.state).toBe(down.state);
  });

  it('keeps the verdict for the reviewer, who DOES need them distinguished', async () => {
    // The officer working a backlog wants to know whether the model objected or the GPU was off.
    const flagged = await new ScreeningService(ai(FLAGGED), new NullAiLog()).screenPost('a', {
      userId: 'u1',
      surface: 'web',
    });
    expect(flagged.verdict.verdict).toBe('flagged');
    expect(flagged.verdict.categories).toEqual(['harassment']);
    expect(flagged.verdict.reason).toContain('Directed insult');
  });
});

describe('when screening is not configured at all', () => {
  it('publishes, because "not enabled" is not "broken"', async () => {
    /*
     * THE ONE PLACE THE RULE BENDS, AND WHY.
     *
     * `AI_BASE_URL` unset means screening was never turned on — a development machine, or
     * production before the tunnel exists. Holding every post in that state would mean the forum
     * silently stops working the moment this code deploys, for a reason nobody would connect to a
     * feature they had not enabled.
     *
     * Configured-but-unreachable is the case the owner decided, and that still holds.
     */
    const svc = new ScreeningService(ai(DOWN, false), new NullAiLog());
    const out = await svc.screenPost('anything', { userId: 'u1', surface: 'web' });
    expect(out.state).toBe('clear');
  });

  it('does not call the model at all', async () => {
    const client = ai(DOWN, false);
    await new ScreeningService(client, new NullAiLog()).screenPost('x', {
      userId: 'u1',
      surface: 'web',
    });
    expect(client.screen).not.toHaveBeenCalled();
  });
});

describe('logging', () => {
  it('records the call for officer review', async () => {
    const record = vi.fn(async () => undefined);
    const svc = new ScreeningService(ai(FLAGGED), { record } as never);

    await svc.screenPost('some post', { userId: 'u1', surface: 'web' });
    await Promise.resolve();

    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({ kind: 'screen', userId: 'u1' });
  });

  it('MANDATORY: a failing log never costs somebody their post', async () => {
    /*
     * The log is evidence, not a gate. If a log write could fail a post, an officer-review feature
     * would become an outage the first time the table was locked.
     */
    const record = vi.fn(async () => {
      throw new Error('database on fire');
    });
    const svc = new ScreeningService(ai(CLEAR), { record } as never);

    await expect(
      svc.screenPost('x', { userId: 'u1', surface: 'web' }),
    ).resolves.toMatchObject({ state: 'clear' });
  });
});

describe('what the author is told', () => {
  it('MANDATORY: never names a category or a reason', async () => {
    /*
     * Owner's decision: held, but not why. Naming the category teaches anybody determined exactly
     * which wording gets through, and they can retry as often as they like.
     */
    expect(HELD_MESSAGE).not.toMatch(/harassment|hate|spam|extremis|politic|religio|sexual/i);
    expect(HELD_MESSAGE).not.toMatch(/offline|unavailable|error|AI|model/i);
  });

  it('says a person will look, so it does not read as a rejection', () => {
    // A member whose ordinary post was held by a jumpy model should not be made to feel accused.
    expect(HELD_MESSAGE).toMatch(/officer/i);
    expect(HELD_MESSAGE).not.toMatch(/violat|breach|rule|sorry/i);
  });
});
