import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORM_VERSION } from '@grims/shared/version';

/**
 * The one-version rule, enforced.
 *
 * ★ SQUADRON OWNER, 2026-08-04: "lets keep the website and companion app versioned the same" ★
 *
 * The canonical number lives in @grims/shared/version and both sidebars print it. This
 * package.json's copy exists only because electron-builder's updater reads it — and a copy that
 * can drift is a copy that will, so the drift is a failing build instead of a shipped lie.
 * Bumping the platform version is two edits, and this spec is what remembers the second one.
 */
describe('the platform version', () => {
  it('MANDATORY: the companion package.json matches PLATFORM_VERSION exactly', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(pkg.version).toBe(PLATFORM_VERSION);
  });
});
