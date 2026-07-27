import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * INV-036 is enforced in CI by gitleaks, which scans full history. That is the
 * primary control and this file does not duplicate it.
 *
 * What this adds is the part gitleaks cannot check: that the repo's own
 * CONVENTIONS hold — no .env is tracked, and .env.example contains placeholders
 * rather than values. gitleaks caught a real violation of exactly that on the
 * first CI run (a Discord guild ID in .env.example), which is why it is worth a
 * test rather than trust.
 */

function tracked(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

describe('@INV-036 no secrets in the repository', () => {
  it('tracks no .env file other than the example', () => {
    const offenders = tracked().filter(
      (f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'),
    );
    expect(offenders).toEqual([]);
  });

  it('tracks no private key or certificate material', () => {
    const offenders = tracked().filter((f) => /\.(pem|key|p12|pfx)$/.test(f));
    expect(offenders).toEqual([]);
  });

  it('.env.example contains placeholders, not values', () => {
    const path = resolve(REPO, '.env.example');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf8');

    const assignments = body
      .split('\n')
      .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
      .map((l) => {
        const idx = l.indexOf('=');
        return { key: l.slice(0, idx), value: l.slice(idx + 1).trim() };
      })
      .filter((a) => a.value !== '');

    // Anything that looks like a real credential shape.
    const suspicious = assignments.filter(({ value }) => {
      if (/^CHANGE_ME/.test(value)) return false;
      if (/^(true|false|\d+|development|production)$/.test(value)) return false;
      if (/^(https?|postgresql|redis):\/\//.test(value)) return false;
      // A bare 17-20 digit run is a Discord snowflake shape — the exact thing
      // gitleaks flagged here on the first run.
      if (/^\d{17,20}$/.test(value)) return true;
      // Known credential prefixes.
      if (/^(gh[pousr]_|sk-|xox[baprs]-|AKIA|eyJ)/.test(value)) return true;
      // Long high-entropy-looking blobs.
      if (/^[A-Za-z0-9+/=_-]{32,}$/.test(value)) return true;
      return false;
    });

    expect(
      suspicious.map((s) => s.key),
      `.env.example must hold placeholders only — these look like real values`,
    ).toEqual([]);
  });

  it('the gitleaks allowlist is narrowly scoped, not rule-wide', () => {
    // A blanket `discord-client-id` suppression would hide a genuinely leaked
    // OAuth client ID. The allowlist must target literal values only.
    const cfg = readFileSync(resolve(REPO, '.gitleaks.toml'), 'utf8');
    expect(cfg).toMatch(/\[allowlist\]/);
    expect(cfg).toMatch(/regexes\s*=/);
    // Must not disable a rule outright.
    expect(cfg).not.toMatch(/^\s*stopwords\s*=\s*\[\s*\]\s*$/m);
    expect(cfg).toMatch(/discord-bot-token/);
  });
});

describe('recovery material can never be committed', () => {
  /**
   * The recovery card holds the vault passphrase, which opens BOTH the secrets
   * vault and every encrypted database backup. It is written to the user's home
   * directory precisely so it is nowhere near this repository — but a copy
   * pasted into the project folder would be the worst single file this repo
   * could contain, and gitignore is the last line of defence for a mistake
   * that takes two seconds to make.
   */
  const MUST_BE_IGNORED = [
    'GRIMS-SQUAD-RECOVERY.txt',
    'grims-vault-passphrase.txt',
    'vault-latest.enc',
    'vault-20260726-170623.enc',
    'grims-secrets-20260726.tar.gz.enc',
    'TODO.local.md',
    'apps/api/.env',
  ];

  for (const path of MUST_BE_IGNORED) {
    it(`git ignores ${path}`, () => {
      // `git check-ignore` is the authority here rather than reading the file
      // and reasoning about the patterns ourselves — it answers the question
      // git will actually answer at commit time.
      let ignored = true;
      try {
        execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: REPO });
      } catch {
        ignored = false;
      }
      expect(ignored, `${path} is NOT gitignored`).toBe(true);
    });
  }
});
