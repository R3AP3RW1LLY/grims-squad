import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPendingChangelog } from './pending.js';

/**
 * The pending-changelog reader.
 *
 * The file is written by a TOOL on a developer's machine and read by the API,
 * which makes it boundary input like any other: the reader must survive the
 * file being absent (production, always), half-written, or hand-edited into
 * the wrong shape — and must never turn any of those into a 500, because the
 * API does not own the file and cannot fix it.
 */

const dir = mkdtempSync(join(tmpdir(), 'changelog-pending-'));
const file = join(dir, 'pending.json');

const VALID = {
  fromSha: 'a'.repeat(40),
  toSha: 'b'.repeat(40),
  generatedAt: '2026-08-04T00:00:00.000Z',
  commitCount: 3,
  websiteMd: '### A change\n\nWhy it changed.',
  companionMd: '',
  platformMd: '### Another\n\nDetail.',
};

afterEach(() => {
  delete process.env['CHANGELOG_PENDING_FILE'];
  rmSync(file, { force: true });
});

describe('readPendingChangelog', () => {
  it('MANDATORY: serves a well-formed file, through the env override', () => {
    writeFileSync(file, JSON.stringify(VALID), 'utf8');
    process.env['CHANGELOG_PENDING_FILE'] = file;

    expect(readPendingChangelog()).toMatchObject({
      fromSha: VALID.fromSha,
      commitCount: 3,
      websiteMd: VALID.websiteMd,
    });
  });

  it('MANDATORY: a missing file is null, not an error — production never has one', () => {
    process.env['CHANGELOG_PENDING_FILE'] = join(dir, 'nowhere.json');
    expect(readPendingChangelog()).toBeNull();
  });

  it('a half-written file is null rather than a 500 about a file the API does not own', () => {
    writeFileSync(file, '{"fromSha": "abc', 'utf8');
    process.env['CHANGELOG_PENDING_FILE'] = file;
    expect(readPendingChangelog()).toBeNull();
  });

  it('a file with the wrong shape is null — valid JSON is not the same thing as a changelog', () => {
    writeFileSync(file, JSON.stringify({ fromSha: 42, toSha: [] }), 'utf8');
    process.env['CHANGELOG_PENDING_FILE'] = file;
    expect(readPendingChangelog()).toBeNull();
  });

  it('carries only the declared fields — a stray key in the file does not travel to the browser', () => {
    writeFileSync(file, JSON.stringify({ ...VALID, secret: 'leak' }), 'utf8');
    process.env['CHANGELOG_PENDING_FILE'] = file;

    const pending = readPendingChangelog();
    expect(pending).not.toBeNull();
    expect(Object.keys(pending ?? {})).not.toContain('secret');
  });
});
