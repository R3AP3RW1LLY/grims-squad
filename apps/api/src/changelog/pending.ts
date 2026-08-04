import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The not-yet-deployed changelog, as `tools/changelog.mjs --write-pending`
 * writes it to `.changelog-pending.json` at the repo root.
 *
 * ★ A FILE, NOT `git log` — THE API BOX MAKES NO PROMISES ABOUT GIT ★
 *
 * The obvious design was for the API to run the generator itself. But the
 * production API is a container built from a COPY of the tree: it has no .git
 * directory, no git binary, and no business growing either just to render a
 * preview. So the tool writes a plain JSON file and the API serves it when it
 * is present — which in practice means a development machine, where the
 * webmaster actually previews what the next deploy will say. In production
 * the file simply never exists, and the released list (written by the deploy
 * script into the database) is the record.
 */
export interface PendingChangelog {
  readonly fromSha: string;
  readonly toSha: string;
  readonly generatedAt: string;
  readonly commitCount: number;
  readonly websiteMd: string;
  readonly companionMd: string;
  readonly platformMd: string;
}

/**
 * Where to look. An explicit CHANGELOG_PENDING_FILE always wins; otherwise
 * the two places a repo root can be relative to the API process — the cwd
 * itself (running from the repo root) and two levels up (running from
 * apps/api, which is what `pnpm dev` does).
 */
function candidatePaths(): string[] {
  const explicit = process.env['CHANGELOG_PENDING_FILE'];
  if (explicit !== undefined && explicit !== '') return [explicit];
  return [
    resolve(process.cwd(), '.changelog-pending.json'),
    resolve(process.cwd(), '../../.changelog-pending.json'),
  ];
}

/**
 * The pending preview, or null when none has been written.
 *
 * Read on every request rather than cached: the file changes every time the
 * webmaster regenerates it, this endpoint is behind SITE_CONFIG, and a stale
 * preview is precisely the thing the page exists to prevent.
 */
export function readPendingChangelog(): PendingChangelog | null {
  for (const path of candidatePaths()) {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      continue; // Not present here — the normal case everywhere but a dev box.
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A half-written or hand-mangled file. Absent is the honest answer; the
      // fix is rerunning the tool, and a 500 would say "the API is broken"
      // about a file the API does not own.
      continue;
    }

    const p = parsed as Record<string, unknown>;
    const str = (v: unknown): v is string => typeof v === 'string';
    if (
      str(p['fromSha']) &&
      str(p['toSha']) &&
      str(p['generatedAt']) &&
      typeof p['commitCount'] === 'number' &&
      str(p['websiteMd']) &&
      str(p['companionMd']) &&
      str(p['platformMd'])
    ) {
      return {
        fromSha: p['fromSha'],
        toSha: p['toSha'],
        generatedAt: p['generatedAt'],
        commitCount: p['commitCount'],
        websiteMd: p['websiteMd'],
        companionMd: p['companionMd'],
        platformMd: p['platformMd'],
      };
    }
  }
  return null;
}
