import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const form = readFileSync(join(HERE, 'security-form.tsx'), 'utf8');

/** Source with comments stripped, so prose explaining a rule cannot satisfy it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/**
 * Two-factor enrolment.
 *
 * Nobody types a base32 secret into their phone by hand. Without a QR code the
 * feature is technically present and practically unused, which for a control
 * that gates the admin console is the same as not having it.
 */
describe('the QR code', () => {
  it('MANDATORY: a scannable QR is rendered, not just the raw secret', () => {
    expect(code(form)).toContain('<QRCodeSVG');
    expect(code(form)).toMatch(/value=\{uri\}/);
  });

  it('MANDATORY: it is drawn LOCALLY, never fetched from a QR service', () => {
    /*
     * ★ THE MISTAKE THIS FORECLOSES ★
     *
     * The obvious shortcut is an <img> pointing at Google Charts or
     * api.qrserver.com. That puts the TOTP SECRET in a URL and sends it to a
     * third party, in plaintext, from every member's browser, at the exact
     * moment they are setting up their second factor.
     *
     * It would hand that service the ability to generate valid codes for every
     * admin account on the platform — and nothing about the page would look
     * wrong. The QR would render perfectly.
     */
    const offenders = walk(SRC)
      .filter((p) => !p.endsWith('.spec.ts') && !p.endsWith('.spec.tsx'))
      // Comment-stripped: security-form.tsx NAMES these services in the note
      // explaining why it does not use them, and a test that fails on its own
      // documentation is a test people learn to delete.
      .filter((p) => /chart\.googleapis|qrserver|qrcode\.tec-it|goqr\.me|quickchart\.io/i.test(code(readFileSync(p, 'utf8'))))
      .map((p) => p.slice(SRC.length + 1));

    expect(
      offenders,
      `A remote QR generator would receive the TOTP secret in a URL, from every ` +
        `member's browser, and could then produce valid codes for those ` +
        `accounts forever:\n${offenders.map((o) => `  ${o}`).join('\n')}`,
    ).toEqual([]);
  });

  it('MANDATORY: sits on a light plate, or phones cannot read it', () => {
    // The site is near-black. A QR rendered dark-on-dark is unscannable —
    // readers look for dark modules on a light field — so this is the one place
    // that deliberately breaks the theme.
    expect(code(form)).toMatch(/bg-white/);
  });

  it('keeps the manual key as a fallback', () => {
    // Somebody enrolling on the same device they are reading has no second
    // camera, and a desktop authenticator needs the key typed in.
    expect(code(form)).toContain('{secret}');
  });
});

describe('what is shown once and never again', () => {
  it('MANDATORY: offers no CONTROL that claims to redisplay them', () => {
    /*
     * There is nothing to redisplay: the server keeps only a hash of the codes
     * and never returns the secret after enrolment. A button implying otherwise
     * would be a lie the interface tells about its own security.
     *
     * Scoped to interactive elements, not to prose. The page SAYS "we cannot
     * show them again even if you ask" — which is the correct copy, and an
     * earlier version of this test failed on it.
     */
    const interactive = code(form)
      .split(/\r?\n/)
      .filter((l) => /<button|onClick=|<a href/i.test(l))
      .join('\n');

    expect(interactive).not.toMatch(/show.*again|reveal|view.*secret/i);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : [];
  });
}
