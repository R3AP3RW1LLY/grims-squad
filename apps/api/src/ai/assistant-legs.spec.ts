import { describe, expect, it } from 'vitest';
import { AiModule } from './ai.module.js';
import { AssistantService } from './assistant.service.js';
import { MiningService } from '../mining/mining.service.js';
import { BgsService } from '../bgs/bgs.service.js';
import { MiningModule } from '../mining/mining.module.js';
import { BgsModule } from '../bgs/bgs.module.js';
import { OpsService } from '../ops/ops.service.js';
import { OpsModule } from '../ops/ops.module.js';

/**
 * The assistant's optional retrieval legs are actually wired.
 *
 * ★ AN OPTIONAL INJECTION IS ONLY OPTIONAL IF SOMETHING PROVIDES IT ★
 *
 * `{ token: X, optional: true }` resolves to `undefined` when the token is not in the module's
 * context. No error. No warning. Nothing in a log. The leg simply never runs, and the assistant
 * goes on answering from whatever prose the semantic search found — which is the exact failure each
 * leg was written to prevent.
 *
 * `ai.module.ts` has carried a comment warning about this since the ring survey was added. A
 * comment cannot fail a build, and there are two of these now. The standing-orders leg is the one
 * where a silent absence costs most: "who are we pushing" answered from a two-year-old wiki page
 * sends a member to spend their evening working against their own squadron.
 *
 * ★ IT ASSERTS ON THE DECLARATION, NOT ON A LIVE CONTAINER ★
 *
 * Booting Nest here would need a database, Redis and Meilisearch. What actually breaks is somebody
 * adding a leg and forgetting the module import — a mistake visible in the metadata alone.
 */

interface Providerish {
  provide?: unknown;
  inject?: unknown[];
}

function assistantProvider(): Providerish {
  const providers = (Reflect.getMetadata('providers', AiModule) ?? []) as Providerish[];
  const found = providers.find((p) => p?.provide === AssistantService);
  if (found === undefined) throw new Error('AssistantService is not provided by AiModule at all');
  return found;
}

function tokensOf(p: Providerish): unknown[] {
  return (p.inject ?? []).map((dep) =>
    typeof dep === 'object' && dep !== null && 'token' in dep
      ? (dep as { token: unknown }).token
      : dep,
  );
}

describe('the assistant’s optional legs', () => {
  it('MANDATORY: the ring survey is injected AND its module is imported', () => {
    expect(tokensOf(assistantProvider()), 'the ring leg would silently never run').toContain(
      MiningService,
    );

    const imports = (Reflect.getMetadata('imports', AiModule) ?? []) as unknown[];
    expect(imports, 'MiningService is injected but nothing provides it').toContain(MiningModule);
  });

  it('MANDATORY: the standing orders are injected AND their module is imported', () => {
    /*
     * The costly one. Every other leg being absent means a vaguer answer; this one being absent
     * means a confidently WRONG answer about what the squadron wants done.
     */
    expect(tokensOf(assistantProvider()), 'the standing-orders leg would silently never run').toContain(
      BgsService,
    );

    const imports = (Reflect.getMetadata('imports', AiModule) ?? []) as unknown[];
    expect(imports, 'BgsService is injected but nothing provides it').toContain(BgsModule);
  });

  it('MANDATORY: the operations board is injected AND its module is imported', () => {
    /*
     * "What is on tonight" is the most asked question in a squadron. Answered without this leg it
     * describes an op that ran months ago, in the present tense.
     */
    expect(tokensOf(assistantProvider()), 'the operations leg would silently never run').toContain(
      OpsService,
    );

    const imports = (Reflect.getMetadata('imports', AiModule) ?? []) as unknown[];
    expect(imports, 'OpsService is injected but nothing provides it').toContain(OpsModule);
  });

  it('passes every injected token to the constructor in order', () => {
    /*
     * The list is positional. Appending a token without appending a parameter hands the new service
     * to whichever argument happens to sit at that index — and both trailing parameters here are
     * optional, so it typechecks and fails silently.
     */
    const p = assistantProvider();
    const factory = (p as { useFactory?: (...args: unknown[]) => unknown }).useFactory;
    expect(factory, 'AssistantService is not built by a factory any more').toBeTypeOf('function');
    expect(
      factory?.length,
      'the factory takes a different number of arguments than the inject list provides',
    ).toBe(tokensOf(p).length);
  });
});
