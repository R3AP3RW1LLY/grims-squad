import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const form = readFileSync(resolve(HERE, 'inara-form.tsx'), 'utf8');
const page = readFileSync(resolve(HERE, 'page.tsx'), 'utf8');
const api = readFileSync(resolve(HERE, '../../../../lib/api.ts'), 'utf8');

/**
 * The Inara key UI.
 *
 * ★ THE ONE THING THAT MUST STAY TRUE ★
 *
 * There is NO commander-name input. The name comes back from Inara, and that is
 * the entire difference between proving a commander is yours and telling us it
 * is. A text box here would turn tier-2 verification into self-declaration
 * while the page still displayed the word "verified" — which is worse than not
 * having the feature, because an officer would trust it.
 */
describe('the Inara key form', () => {
  it('MANDATORY: has no commander-name input', () => {
    // Any input whose id or name suggests a commander name.
    expect(form).not.toMatch(/id="cmdr|id="commander|name="cmdrName"/i);
    // And the REQUEST BODY carries the key and the source, and nothing else.
    //
    // Scoped to the object literal sent as the body, NOT to the whole call:
    // the response type is `{ cmdrName: string }` and the form legitimately
    // reads that back to display it. Sending a name and receiving one are
    // opposite directions, and only one of them is a problem.
    const start = form.indexOf("'/v1/me/inara', 'POST', {");
    const body = form.slice(start, form.indexOf('})', start));

    expect(body).toContain('apiKey: key');
    expect(body).toMatch(/source:\s*'web'/);
    expect(body).not.toMatch(/cmdrName/);
  });

  it('MANDATORY: the key input is a password field with autocomplete off', () => {
    // It is a credential. Not stored by the browser, not shoulder-readable.
    const input = form.slice(form.indexOf('id="inara-key"'), form.indexOf('id="inara-key"') + 400);
    expect(input).toContain("type=\"password\"");
    expect(input).toContain('autoComplete="off"');
  });

  it('clears the key from component state once accepted', () => {
    // No reason for a credential to sit in a form field after the server has
    // taken it.
    expect(form).toContain("setKey('')");
  });

  it('MANDATORY: the status type has no field that could carry the key', () => {
    const type = api.slice(api.indexOf('export interface InaraStatus'), api.indexOf('export const getInaraStatus'));
    expect(type).not.toMatch(/apiKey|key\s*:/i);
  });

  it('tells the member the manual route exists', () => {
    // Optional means optional. Somebody who will not hand over a key needs to
    // know an officer can verify them instead, or the page reads as a wall.
    expect(page).toMatch(/officer verifies you/i);
    expect(page).toMatch(/optional/i);
  });

  it('says removing the key does not un-verify them', () => {
    expect(page).toMatch(/does not un-verify/i);
  });
});
