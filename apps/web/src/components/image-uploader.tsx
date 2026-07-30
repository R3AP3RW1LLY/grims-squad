'use client';

import { useRef, useState } from 'react';

/**
 * Uploads a screenshot and hands back the Markdown to paste.
 *
 * ★ WHY IT RETURNS A SNIPPET RATHER THAN INSERTING ANYTHING ★
 *
 * The joining guides are generated from source (`joining-guide.ts`) and re-seeded, because
 * prose that changes whenever Inara moves a button belongs in a diff. So the useful output
 * of an upload is a line somebody can paste into that file — or into a reply box — not an
 * edit applied to a document this widget cannot see.
 *
 * That also makes it work everywhere without knowing anything about its surroundings.
 *
 * ★ THE REQUEST BODY IS THE FILE ITSELF ★
 *
 * No FormData, no multipart, no filename. `fetch(url, { body: file })` sends the bytes with
 * the file's own content type, which is all the API wants — it determines the real format by
 * decoding, and mints the storage key from its own row id. A filename would be an
 * attacker-controlled string with nowhere legitimate to go.
 */

/** Mirrors the API's cap so a too-large file is refused before it is sent. */
const MAX_BYTES = 8 * 1024 * 1024;

interface Uploaded {
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

export function ImageUploader() {
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    setUploaded(null);
    setCopied(false);

    /*
     * Checked here as well as on the server. Not a security boundary — the server enforces it
     * at the socket — but uploading 20MB over a phone connection only to be refused is a bad
     * experience, and this costs one comparison.
     */
    if (file.size > MAX_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 8MB — crop it or save it at lower quality.`);
      setBusy(false);
      return;
    }

    try {
      const res = await fetch('/v1/media/uploads', {
        method: 'POST',
        // The file IS the body. See the note above on why there is no multipart.
        body: file,
        headers: {
          'content-type': file.type === '' ? 'application/octet-stream' : file.type,
          'x-csrf-token': readCsrf(),
        },
        credentials: 'same-origin',
      });

      const json = (await res.json()) as
        | { id: string; path: string; width: number; height: number }
        | { error?: { message?: string } };

      if (!res.ok || !('path' in json)) {
        /*
         * The server's own message, which already says what to do — "that image has too many
         * pixels to process, resize it and try again" rather than "upload failed".
         */
        const message =
          'error' in json && typeof json.error?.message === 'string'
            ? json.error.message
            : 'That upload did not work.';
        setError(message);
        return;
      }

      setUploaded({ path: json.path, width: json.width, height: json.height });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
      // Cleared so re-picking the SAME file fires a change event again.
      if (input.current !== null) input.current.value = '';
    }
  }

  const snippet = uploaded === null ? '' : `![describe the screenshot](${uploaded.path})`;

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Upload a screenshot and paste the line it gives you into a guide or a reply.
      </p>

      <input
        ref={input}
        type="file"
        // A hint to the file picker, not a guarantee — the server decides by decoding.
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) void send(file);
        }}
        className="block w-full text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded file:border file:border-[var(--color-border-hairline)] file:bg-[var(--color-surface-panel-sunken)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--color-text-primary)] disabled:opacity-60"
      />

      {busy && (
        <p className="font-mono text-xs text-[var(--color-text-secondary)]" role="status">
          Uploading and re-encoding…
        </p>
      )}

      {error !== null && (
        <p className="text-sm leading-relaxed text-[var(--color-brand-orange-bright)]" role="alert">
          {error}
        </p>
      )}

      {uploaded !== null && (
        <div className="space-y-2">
          <p className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            {uploaded.width}&times;{uploaded.height} · metadata stripped
          </p>
          <code className="block overflow-x-auto rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]">
            {snippet}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(snippet).then(
                () => setCopied(true),
                /*
                 * Clipboard access can be refused — an insecure origin, or a browser that
                 * wants a user gesture it did not see. The snippet is on screen either way, so
                 * this says what happened instead of pretending it worked.
                 */
                () => setError('Could not copy automatically — select the line above and copy it.'),
              );
            }}
            className="rounded border border-[var(--color-border-hairline)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)]"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Reads the CSRF cookie.
 *
 * Duplicated from `api-client` rather than imported, because this request does NOT go through
 * `apiCall`: that helper sets `content-type: application/json`, and this body is a binary file.
 * Both cookie spellings are checked — the `__Host-` prefix is only valid over https, so the
 * name differs between localhost and production.
 */
function readCsrf(): string {
  /*
   * `gs_csrf`, NOT `csrf`. My first version guessed the shorter name and would have sent an
   * empty token on every upload — a 403 with nothing on screen explaining why, and nothing in
   * this file looking wrong. Copied from `api-client.ts`, which is the one place that knows.
   */
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  return '';
}
