import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatUtcSeconds, formatLocal, zoneLabel } from './time';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * How times are shown.
 *
 * ★ TWO RULES, AND MIXING THEM IS THE FAILURE ★
 *
 * The audit log is always UTC. Everything else is the member's own zone. Both
 * halves matter: a log in each reader's local time makes "which happened first"
 * unanswerable from a screenshot, and a device page in UTC makes "when did my
 * laptop last upload" a subtraction.
 */

const INSTANT = '2026-07-27T14:32:09.123Z';

describe('the audit log', () => {
  it('MANDATORY: renders UTC regardless of where the code is running', () => {
    /*
     * `toISOString` is UTC by definition, so this holds on a server in Frankfurt
     * and in a browser in Denver. That is the property the audit log depends on.
     */
    expect(formatUtcSeconds(INSTANT)).toBe('2026-07-27 14:32:09 UTC');
  });

  it('MANDATORY: shows SECONDS', () => {
    /*
     * Privileged actions arrive in bursts — a role change and the grant it
     * caused land in the same minute. At minute resolution the log records that
     * both happened and loses which came first, which is half of what an
     * investigation needs.
     */
    expect(formatUtcSeconds(INSTANT)).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('MANDATORY: says UTC on the face of it', () => {
    // An unlabelled timestamp is read as local by everybody. This is exactly
    // the ambiguity that prompted the change.
    expect(formatUtcSeconds(INSTANT)).toContain('UTC');
  });

  it('returns something rather than throwing on a bad value', () => {
    // A malformed row should cost one unreadable cell, not the whole log.
    expect(formatUtcSeconds('not a date')).toBe('not a date');
  });
});

describe('everywhere else', () => {
  it('MANDATORY: renders in the timezone it is GIVEN, not the machine default', () => {
    /*
     * The point of storing a zone. If this followed the runtime, every time on
     * the site would be correct on the server in UTC and wrong for the member.
     */
    const london = formatLocal(INSTANT, 'Europe/London');
    const denver = formatLocal(INSTANT, 'America/Denver');

    expect(london).not.toBe(denver);
    // 14:32 UTC is 15:32 British Summer Time in July.
    expect(london).toContain('15:32');
    expect(denver).toContain('08:32');
  });

  it('MANDATORY: is deterministic, so server and client agree', () => {
    /*
     * Hydration. Given the same instant and the same zone the output must be
     * identical wherever it runs — otherwise React replaces the text after
     * mount and every timestamp on the page visibly flickers.
     */
    expect(formatLocal(INSTANT, 'Europe/London')).toBe(formatLocal(INSTANT, 'Europe/London'));
  });

  it('falls back to UTC on a zone this runtime does not know', () => {
    // A zone retired between Node versions should cost a slightly wrong label,
    // not a page that fails to render.
    expect(formatLocal(INSTANT, 'Mars/Olympus_Mons')).toContain('UTC');
  });

  it('can render a date with no time', () => {
    expect(formatLocal(INSTANT, 'UTC', { withTime: false })).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('zoneLabel', () => {
  it('names the offset a member is reading in', () => {
    expect(zoneLabel('Europe/London', new Date(INSTANT))).toMatch(/GMT\+1|BST/);
  });

  it('survives nonsense', () => {
    expect(zoneLabel('nowhere')).toBe('UTC');
  });
});

describe('the rules are actually applied', () => {
  it('MANDATORY: the audit log does not format in local time', () => {
    /*
     * The regression that would matter most, and it would look completely
     * normal: someone "helpfully" switching the audit column to the member's
     * zone, and two officers then reading different times for one event.
     */
    const audit = readFileSync(
      resolve(SRC, 'app', '(hub)', 'app', 'audit-filters.tsx'),
      'utf8',
    );

    expect(audit).toContain('formatUtcSeconds');
    expect(audit).not.toContain('formatLocal');

    /*
     * Scoped to DATES. An earlier version of this matched any toLocaleString
     * and failed on `total.toLocaleString('en-GB')` — which formats the entry
     * COUNT with thousands separators and has nothing to do with time.
     */
    expect(audit).not.toMatch(/new Date\([^)]*\)\.toLocale/);
  });

  it('MANDATORY: no members-area page falls back to the BROWSER timezone', () => {
    /*
     * `toLocaleString()` with no zone follows the DEVICE, so a member on a work
     * laptop abroad reads every time shifted — and it cannot run on the server,
     * so the value would change after hydration.
     *
     * The stored zone is passed explicitly instead.
     */
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { join } = require('node:path') as typeof import('node:path');

      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!path.endsWith('.tsx') || path.endsWith('.spec.tsx')) continue;

        const source = readFileSync(path, 'utf8');
        /*
         * A DATE formatted with no arguments is the browser-default one.
         * Anchored on `new Date(...)` so a number being formatted for
         * readability — `total.toLocaleString('en-GB')` — is not swept up.
         */
        if (/new Date\([^)]*\)\.toLocale(String|TimeString|DateString)\(\)/.test(source)) {
          offenders.push(path.slice(SRC.length + 1));
        }
      }
    };
    walk(resolve(SRC, 'app', '(hub)'));

    expect(
      offenders,
      `These format times using the browser's default timezone. Pass the ` +
        `member's stored zone to formatLocal instead — otherwise the value is ` +
        `wrong for anyone on a device set to another country, and changes ` +
        `after hydration:\n${offenders.map((o) => `  ${o}`).join('\n')}`,
    ).toEqual([]);
  });
});
