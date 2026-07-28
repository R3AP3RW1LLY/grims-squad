import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = readFileSync(resolve(REPO, 'pnpm-workspace.yaml'), 'utf8');

/**
 * pnpm's build-script policy must contain no unanswered questions.
 *
 * ★ THE FAILURE THIS CATCHES ★
 *
 * When pnpm meets a build script with no recorded decision it WRITES an entry
 * into pnpm-workspace.yaml reading "set this to true or false" — and while ANY
 * such placeholder is present it ignores EVERY build script, not just the new
 * one.
 *
 * The consequences are badly disproportionate to the cause:
 *
 *  - prisma, esbuild and sharp stop building, all at once, for a change that
 *    had nothing to do with them
 *  - a warm local node_modules hides it completely, because the binaries are
 *    already there
 *  - it therefore surfaces only in CI, on a fresh --frozen-lockfile install
 *
 * It has now happened three times in this project. Twice the placeholder was
 * committed, because pnpm wrote it during an unrelated install between my
 * editing the file and committing it. A comment warning about it was not
 * enough — the comment lived in the file that kept getting overwritten.
 *
 * A test is enough, because it fails before the commit lands.
 */
describe('pnpm build-script policy', () => {
  it('MANDATORY: contains no unanswered build-script prompts', () => {
    const placeholders = workspace
      .split(/\r?\n/)
      .map((l, i) => ({ line: i + 1, text: l }))
      // Comment lines excluded: the file EXPLAINS this trap in prose, and
      // matching the explanation rather than the config is a test that fails on
      // its own documentation. Only a real YAML entry counts.
      .filter((l) => !l.text.trim().startsWith('#'))
      .filter((l) => l.text.includes('set this to true or false'));

    expect(
      placeholders,
      `pnpm left an unanswered build-script prompt. While it is there, EVERY ` +
        `build script is ignored — prisma, esbuild and sharp included — and CI ` +
        `fails on a fresh install while your machine keeps working. Replace the ` +
        `placeholder with true or false.\n` +
        placeholders.map((p) => `  line ${p.line}: ${p.text.trim()}`).join('\n'),
    ).toEqual([]);
  });

  it('the packages we depend on building are approved', () => {
    // Not exhaustive — just the ones whose absence breaks something loudly and
    // whose approval somebody might "tidy away".
    for (const pkg of ['esbuild', 'prisma', 'sharp', 'electron']) {
      expect(workspace, pkg).toMatch(new RegExp(`${pkg}['"]?:\\s*true`));
    }
  });
});
