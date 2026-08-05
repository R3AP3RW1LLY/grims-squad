import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_NAME } from '@grims/shared';

/**
 * The AI has one name, and no other is ever shown.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "please only refer to our AI as GMSD AI please dont mention any 3rd party AI models in this app
 * or website please! this is very important!"
 *
 * ★ WHY A GUARD AND NOT A STYLE RULE ★
 *
 * The leak that prompted this was not prose anybody typed. `GET /v1/ai/health` returned the
 * configured model name, and the moderation tab rendered it faithfully — so an officer read a raw
 * model identifier that had travelled from an environment variable to a screen without passing
 * through a single sentence a human wrote.
 *
 * A convention cannot catch that. The next status field would reintroduce it the same way.
 */

const API = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(API, '../../../../apps/web/src');

/** Vendor and model names. Wiring may use them; nothing a person reads may. */
const VENDOR = /qwen|ollama|comfyui|kontext|sdxl|stable.?diffusion|llama|gpt-|claude|mistral/i;

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('the name', () => {
  it('MANDATORY: is GMSD AI', () => {
    expect(AI_NAME).toBe('GMSD AI');
  });
});

describe('no model identifier escapes the API', () => {
  it('MANDATORY: the health route does not return one', () => {
    /*
     * This is the exact leak. `AiHealth.text` carried `model`, and it was rendered. The field is
     * GONE rather than blanked, so a later edit cannot resurrect it by populating something that
     * already exists.
     */
    const controller = readFileSync(join(API, 'ai.controller.ts'), 'utf8');
    const shape = controller.slice(
      controller.indexOf('export interface AiHealth'),
      controller.indexOf('@Controller'),
    );
    expect(shape).not.toMatch(/readonly model/);
  });

  it('MANDATORY: no vendor name reaches a web-facing string', () => {
    /*
     * Scanned across the whole web app, comments stripped. Comments are engineering notes nobody
     * reads in a browser; a string literal is one render away from a screen.
     */
    const offenders: string[] = [];
    for (const file of walk(WEB)) {
      const code = codeOf(readFileSync(file, 'utf8'));
      for (const literal of code.match(/'[^']{4,}'|"[^"]{4,}"|`[^`]{4,}`/g) ?? []) {
        if (VENDOR.test(literal)) offenders.push(`${file}: ${literal.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('MANDATORY: no vendor name reaches a line streamed to the admin log', () => {
    /*
     * The live log is a screen an officer reads. `message:` on a stream emit lands there verbatim,
     * so "check the ComfyUI window" is as visible as anything in the web app.
     */
    const offenders: string[] = [];
    for (const file of walk(API)) {
      for (const line of codeOf(readFileSync(file, 'utf8')).split('\n')) {
        if (/message:/.test(line) && VENDOR.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('what the rule deliberately does not touch', () => {
  it('model filenames and graph node names still work', () => {
    /*
     * Stated so nobody "fixes" these next. They are how we talk to the runtime — a filename on disk
     * and a node type in a graph. Renaming them does not rebrand anything; it stops the thing
     * working. The rule is about what a person READS, and none of these reach a screen.
     */
    const studio = readFileSync(join(API, 'studio.client.ts'), 'utf8');
    expect(studio).toMatch(/\.gguf/);
    expect(studio).toMatch(/class_type/);
  });
});
