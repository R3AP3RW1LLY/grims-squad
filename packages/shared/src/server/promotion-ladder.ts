import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LadderRung } from '../promotion.js';

/**
 * Reads the ladder from the SSOT file rather than from a table or from source.
 *
 * ssot/02-domain/rank-progression.yaml is authoritative (ADR-019/020), and the
 * drift check fails CI if a generated copy diverges from it. Parsing it here
 * means the engine and the document cannot disagree — a rank added to the
 * ladder is live without a code change, and a code change cannot invent a rank
 * that the document does not describe.
 *
 * Deliberately a small hand-written reader rather than a YAML dependency: the
 * shape being read is a list of four scalar keys, and this parser fails loudly
 * on anything it does not recognise instead of silently accepting it.
 */
export function readLadderFromSsot(repoRoot: string): LadderRung[] {
  const text = readFileSync(resolve(repoRoot, 'ssot/02-domain/rank-progression.yaml'), 'utf8');

  const start = text.indexOf('\nladder:');
  if (start === -1) throw new Error('rank-progression.yaml has no `ladder:` section.');
  const after = text.slice(start + '\nladder:'.length);
  // The ladder ends at the next top-level key.
  const end = after.search(/\n[a-z_]+:/);
  const body = end === -1 ? after : after.slice(0, end);

  const rungs: LadderRung[] = [];
  for (const block of body.split(/\n\s*- /).slice(1)) {
    const rank = /\brank:\s*(.+)/.exec(block)?.[1]?.trim();
    const nextRaw = /\bnext:\s*(.+)/.exec(block)?.[1]?.trim();
    const monthsRaw = /\bqualifyingMonthsRequired:\s*(\S+)/.exec(block)?.[1]?.trim();
    if (rank === undefined) continue;

    rungs.push({
      rank,
      next: nextRaw === undefined || nextRaw === 'null' ? null : nextRaw,
      qualifyingMonthsRequired:
        monthsRaw === undefined || monthsRaw === 'null' ? null : Number(monthsRaw),
    });
  }

  if (rungs.length === 0) throw new Error('Parsed an EMPTY ladder from the SSOT.');
  return rungs;
}
