import { describe, expect, it } from 'vitest';
import { parseOne } from './signature-design.service.js';

/**
 * Getting JSON back out of a small local model.
 *
 * ★ MEASURED AGAINST THE REAL ONE ★
 *
 * Asked for five designs in one reply, qwen2.5:7b returned nothing usable — the generator produced
 * five padded defaults. A shorter probe asking the same thing returned exactly ONE object where
 * five were requested.
 *
 * That is what the design is built around now: one object per call, five calls, one mood each. So
 * what this has to survive is the wrapping a small model puts around a single object.
 */
describe('parseOne', () => {
  const OBJECT = '{"name":"Void Miner","mood":"industrial","colourA":"#0a0a0a"}';

  it('reads a clean object', () => {
    expect(parseOne(OBJECT)?.['name']).toBe('Void Miner');
  });

  it('MANDATORY: reads it out of a markdown fence', () => {
    expect(parseOne('```json\n' + OBJECT + '\n```')?.['name']).toBe('Void Miner');
  });

  it('MANDATORY: reads it out from behind a sentence of preamble', () => {
    expect(parseOne('Sure! Here is a design:\n' + OBJECT)?.['name']).toBe('Void Miner');
  });

  it('MANDATORY: takes the first object when it wraps one in an array', () => {
    /*
     * Observed: asked for one object, the model returns `[ {...} ]` — half-remembering an earlier
     * instruction. Refusing that would discard a perfectly good design.
     */
    expect(parseOne('[' + OBJECT + ']')?.['name']).toBe('Void Miner');
  });

  it('returns null rather than throwing on anything unparseable', () => {
    for (const junk of ['', 'I cannot help with that.', '{', '{not json]', '[]']) {
      expect(() => parseOne(junk)).not.toThrow();
      expect(parseOne(junk)).toBeNull();
    }
  });
});
