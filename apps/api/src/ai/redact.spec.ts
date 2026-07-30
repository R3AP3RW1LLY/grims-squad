import { describe, it, expect } from 'vitest';
import { MAX_LOG_LINE, forStream, redactPaths } from './redact.js';
import { AiStreamService } from './ai-stream.service.js';

/**
 * Keeping somebody's machine out of the admin log stream.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "just dont show PC file paths into this streaming logs servic please".
 *
 * ★ WHAT IS ACTUALLY BEING PROTECTED ★
 *
 * The AI runs on a home PC, and its errors are full of that PC. The one that matters is
 * `C:\Users\<name>\…`, which is a real person's Windows account name — a small disclosure to a
 * small group, that nobody consented to and nobody needs. Server paths go too: `/srv/grims/…` in a
 * log line publishes the deployment layout to anybody reading over a shoulder.
 */

describe('paths are removed', () => {
  it('MANDATORY: a Windows user path, which carries a real name', () => {
    const out = redactPaths('Failed to load C:\\Users\\starf\\.ollama\\models\\blob');
    expect(out).not.toContain('starf');
    expect(out).not.toContain('C:\\');
    expect(out).toContain('<path>');
  });

  it('MANDATORY: server paths', () => {
    expect(redactPaths('reading /srv/grims/.env')).not.toContain('/srv/grims');
    expect(redactPaths('at /home/deploy/app/main.js')).not.toContain('/home/deploy');
    expect(redactPaths('spawn /usr/local/bin/ollama')).not.toContain('/usr/local');
  });

  it('UNC shares and home shorthand', () => {
    expect(redactPaths('\\\\NAS\\models\\qwen.gguf')).toBe('<path>');
    expect(redactPaths('cache at ~/.ollama/models')).toBe('cache at <path>');
  });

  it('handles several in one line', () => {
    const out = redactPaths('copy C:\\Users\\starf\\a.gguf to /srv/grims/b.gguf');
    expect(out).toBe('copy <path> to <path>');
  });
});

describe('what it deliberately leaves alone', () => {
  it('MANDATORY: keeps the error message readable', () => {
    /*
     * REPLACED, NOT DELETED. "cannot open <path>" still reads as a file problem; "cannot open"
     * reads as a truncated log line and sends somebody hunting for a bug in the logger.
     */
    const out = redactPaths('CUDA out of memory while loading C:\\models\\qwen.gguf');
    expect(out).toContain('CUDA out of memory while loading');
    expect(out).toContain('<path>');
  });

  it('does not eat our own API routes', () => {
    // A redactor that matched every /foo/bar would remove half of every useful line.
    expect(redactPaths('POST /v1/forum/threads returned 500')).toBe(
      'POST /v1/forum/threads returned 500',
    );
  });

  it('does not eat URLs', () => {
    const url = 'connecting to http://127.0.0.1:11434/v1/chat/completions';
    expect(redactPaths(url)).toBe(url);
  });

  it('leaves ordinary prose alone', () => {
    expect(redactPaths('Model answered in 1.2s')).toBe('Model answered in 1.2s');
  });
});

describe('length', () => {
  it('bounds a line so one stack trace cannot fill the panel', () => {
    /*
     * The stream is a live view, not an archive — `ai_calls` keeps the full record. A single line
     * that fills the screen makes the thing useless for its only job, which is noticing that
     * something is wrong.
     */
    const out = forStream('x'.repeat(5_000));
    expect(out.length).toBeLessThanOrEqual(MAX_LOG_LINE + 1);
  });

  it('redacts before truncating, so a path cannot survive at the cut', () => {
    // Truncating first could leave `C:\Users\starf` intact in the kept portion.
    const out = forStream(`${'a'.repeat(MAX_LOG_LINE - 10)} C:\\Users\\starf\\secret`);
    expect(out).not.toContain('starf');
  });
});

describe('the stream itself', () => {
  it('MANDATORY: redacts at the funnel, not at the call sites', () => {
    /*
     * One choke point. Redacting per call site means the next person to add a log line has to
     * remember — and the line they forget will be the one carrying a stack trace full of
     * `C:\Users\<name>`.
     */
    const stream = new AiStreamService();
    const seen: string[] = [];
    stream.subscribe((l) => seen.push(l.message));

    stream.emit({ level: 'error', kind: 'screen', message: 'boom at C:\\Users\\starf\\x.js' });

    expect(seen[0]).not.toContain('starf');
    expect(seen[0]).toContain('<path>');
  });

  it('keeps a bounded backlog so a fresh connection is not blank', () => {
    const stream = new AiStreamService();
    for (let i = 0; i < 250; i += 1) {
      stream.emit({ level: 'info', kind: 'screen', message: `line ${i}` });
    }
    // Bounded: an in-memory buffer that grows forever is a leak with a nice name.
    expect(stream.recent().length).toBeLessThanOrEqual(100);
    expect(stream.recent().at(-1)?.message).toBe('line 249');
  });

  it('MANDATORY: one broken subscriber does not kill the stream for everybody', () => {
    /*
     * A closed connection throws on write. Without catching it, the first officer to close a tab
     * silently ends the stream for every other officer watching.
     */
    const stream = new AiStreamService();
    const good: string[] = [];

    stream.subscribe(() => {
      throw new Error('connection closed');
    });
    stream.subscribe((l) => good.push(l.message));

    stream.emit({ level: 'info', kind: 'screen', message: 'still here' });
    stream.emit({ level: 'info', kind: 'screen', message: 'and here' });

    expect(good).toEqual(['still here', 'and here']);
    // The broken one is dropped rather than retried forever.
    expect(stream.watchers).toBe(1);
  });

  it('unsubscribing stops delivery', () => {
    const stream = new AiStreamService();
    const seen: string[] = [];
    const off = stream.subscribe((l) => seen.push(l.message));

    stream.emit({ level: 'info', kind: 'screen', message: 'one' });
    off();
    stream.emit({ level: 'info', kind: 'screen', message: 'two' });

    expect(seen).toEqual(['one']);
  });
});
