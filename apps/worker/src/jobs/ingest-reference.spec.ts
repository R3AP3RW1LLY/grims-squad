import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { chunk, readHelpFrontmatter, readReferenceKnowledge } from './ingest-reference.js';
import type { PrismaClient } from '@grims/db';

/**
 * The help corpus is what the support assistant answers from, so the reader that feeds it is worth
 * pinning: an article whose frontmatter is silently mis-parsed becomes a passage with no title and
 * no route — retrievable but unable to link anywhere, which reads as an assistant that knows the
 * answer and cannot say where it lives.
 */

const emptyBoard = {
  // The guides-board query. These tests are about the FILE readers, so the board answers empty.
  $queryRawUnsafe: async () => [],
} as unknown as PrismaClient;

const noDir = join(tmpdir(), 'grims-does-not-exist');

const HERE = dirname(fileURLToPath(import.meta.url));

describe('readHelpFrontmatter', () => {
  it('parses title and route and returns the body without the fence', () => {
    const out = readHelpFrontmatter('---\ntitle: Pairing the app\nsurface: both\nroute: /settings/devices\n---\nThe body.');
    expect(out.title).toBe('Pairing the app');
    expect(out.route).toBe('/settings/devices');
    expect(out.body).toBe('The body.');
  });

  it('a file with no frontmatter is all body, honestly', () => {
    const out = readHelpFrontmatter('Just prose, no fence.');
    expect(out.title).toBeNull();
    expect(out.route).toBeNull();
    expect(out.body).toBe('Just prose, no fence.');
  });

  it('CRLF fences parse the same as LF — articles are edited on Windows', () => {
    const out = readHelpFrontmatter('---\r\ntitle: T\r\nroute: /r\r\n---\r\nBody.');
    expect(out.title).toBe('T');
    expect(out.route).toBe('/r');
  });
});

describe('the help corpus leg', () => {
  const helpDir = mkdtempSync(join(tmpdir(), 'grims-help-'));
  afterAll(() => rmSync(helpDir, { recursive: true, force: true }));

  const article = (name: string, title: string, route: string): void =>
    writeFileSync(
      join(helpDir, name),
      `---\ntitle: ${title}\nsurface: web\nroute: ${route}\n---\n${'A sentence about the thing. '.repeat(20)}`,
    );

  it('MANDATORY: help rows carry kind "help" — the support leg filters on exactly this', async () => {
    article('pairing.md', 'Pairing', '/settings/devices');
    const out = await readReferenceKnowledge(emptyBoard, noDir, helpDir);

    expect(out.fromHelp).toBe(1);
    const row = out.rows.find((r) => r.extKey.startsWith('help/pairing.md'));
    expect(row?.kind).toBe('help');
    expect(row?.source).toBe('reference');
    // The route rides along so an answer can link the member to the page it is explaining.
    expect((row?.data as { url: string | null }).url).toBe('/settings/devices');
    // The title anchors the embedding; a chunk without it describes advice, not a subject.
    expect(row?.text?.startsWith('Pairing')).toBe(true);
  });

  it('INDEX.md is navigation, not an answer — never embedded', async () => {
    writeFileSync(join(helpDir, 'INDEX.md'), `# Index\n\n${'- a line in the index\n'.repeat(30)}`);
    const out = await readReferenceKnowledge(emptyBoard, noDir, helpDir);
    expect(out.rows.some((r) => r.extKey.startsWith('help/INDEX'))).toBe(false);
  });

  it('a missing help directory is zero articles, not a crash — production may predate the corpus', async () => {
    const out = await readReferenceKnowledge(emptyBoard, noDir, noDir);
    expect(out.fromHelp).toBe(0);
    expect(out.rows).toEqual([]);
  });
});

describe('chunk', () => {
  it('keeps paragraphs whole and splits near the target', () => {
    const paragraph = 'word '.repeat(100).trim();
    const pieces = chunk(`${paragraph}\n\n${paragraph}\n\n${paragraph}`, 600);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.startsWith('word')).toBe(true);
  });
});

/**
 * Does the corpus actually REACH production?
 *
 * ★ THE BUG THIS EXISTS TO STOP, WHICH HAD ALREADY HAPPENED ★
 *
 * Every test above passed while production held ten reference passages and zero help articles.
 * They test the READER, and the reader was never wrong — `docs/` was in `.dockerignore`, so
 * `docs/help` was not in the build context, so the directory did not exist in the image at all.
 * The ingest found nothing, wrote the guides it did find, and reported success.
 *
 * `.dockerignore` already carries a note warning that `ssot/` looks like documentation and is
 * read at runtime. `docs/help` is the same trap, and it was not caught the same way.
 *
 * Last matching pattern wins, which is Docker's own rule — so a bare `docs` followed by
 * `!docs/help` includes the corpus, and reordering them silently breaks it again.
 */
describe('the help corpus survives the Docker build context', () => {
  const IGNORE = readFileSync(join(HERE, '../../../../.dockerignore'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

  /** Docker's rule: the LAST pattern that matches decides. Returns true when the path ships. */
  function included(path: string): boolean {
    let excluded = false;
    for (const raw of IGNORE) {
      const negated = raw.startsWith('!');
      const pattern = negated ? raw.slice(1) : raw;
      // Enough for the plain directory prefixes this file cares about.
      if (path === pattern || path.startsWith(`${pattern}/`) || pattern.startsWith(`${path}/`)) {
        excluded = !negated;
      }
    }
    return !excluded;
  }

  it('MANDATORY: docs/help is in the build context', () => {
    expect(
      included('docs/help'),
      'The support assistant answers ONLY from help-tagged rows, and those rows come from these ' +
        'files. Excluded from the build context, the ingest reports success and writes none of them.',
    ).toBe(true);
  });

  it('MANDATORY: ssot is in the build context', () => {
    // Read at runtime by the promotion run. The note in .dockerignore says so; this enforces it.
    expect(included('ssot')).toBe(true);
  });

  it('the rest of docs is still excluded — only the corpus is needed at runtime', () => {
    // A named file rather than the directory: `docs` itself is now PARTLY included, so asking
    // about the directory has no true answer. These describe the build; nothing reads them.
    expect(included('docs/ai-tunnel.md')).toBe(false);
    expect(included('docs/scheduled-jobs.md')).toBe(false);
  });
});
