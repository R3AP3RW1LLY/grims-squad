/**
 * Talking to ComfyUI: submit a graph, wait, fetch the picture.
 *
 * ★ WHY THIS IS SEPARATE FROM THE GRAPHS ★
 *
 * Two features send ComfyUI completely different pipelines — banner artwork (`image.client.ts`) and
 * the fan art studio (`studio.client.ts`) — over exactly the same protocol. The protocol is fiddly
 * in ways that are easy to get subtly wrong: a history entry exists while a job is still RUNNING,
 * PreviewImage writes to `temp` rather than `output`, and a poll that crosses a dropped tunnel must
 * be retried rather than failed.
 *
 * Every one of those is a bug that would otherwise have to be fixed twice, and the second copy is
 * the one nobody remembers.
 *
 * ★ POLLING, NOT THE WEBSOCKET ★
 *
 * ComfyUI pushes progress over a websocket and it would be a little tidier. Polling wins because
 * this connection crosses an SSH reverse tunnel from a Vultr box to a home PC: a dropped websocket
 * is a lost job with no way to recover it, whereas a dropped poll is one failed request and the
 * next one picks up the result. The job kept running the whole time.
 */

import { IMAGE_POLL_MS } from '@grims/shared';

export interface ImageRef {
  readonly filename: string;
  readonly subfolder: string;
  readonly type: string;
}

export interface HistoryEntry {
  readonly outputs?: Record<string, { images?: Array<Record<string, unknown>> }>;
  readonly status?: { completed?: unknown; status_str?: unknown };
}

/** Why a wait ended without an image. Distinct because the caller words them differently. */
export type WaitFailure = 'rejected' | 'no-image' | 'timeout';

export class ComfyTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Injected so tests do not actually wait two seconds a poll. */
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Whether ComfyUI is answering. Cheap — asks for its stats, does not touch a model. */
  async health(): Promise<{ reachable: boolean; tookMs: number }> {
    const started = Date.now();
    const abort = new AbortController();
    // Short: this is a liveness question, and a health check that hangs is itself a fault.
    const timer = setTimeout(() => abort.abort(), 4_000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/system_stats`, { signal: abort.signal });
      return { reachable: res.ok, tookMs: Date.now() - started };
    } catch {
      return { reachable: false, tookMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Queues a graph. Returns ComfyUI's prompt id, or null if it would not take it. */
  async submit(graph: Record<string, unknown>): Promise<string | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/prompt`, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: graph }),
      });
      if (!res.ok) return null;

      const body = (await res.json()) as { prompt_id?: unknown };
      return typeof body.prompt_id === 'string' && body.prompt_id !== '' ? body.prompt_id : null;
    } catch {
      return null;
    }
    finally {
      clearTimeout(timer);
    }
  }

  /**
   * Sends a source image for the graph to load.
   *
   * ★ THE STUDIO CANNOT WORK WITHOUT THIS ★
   *
   * Every studio operation except `generate` starts from a picture the member already has, and
   * ComfyUI's `LoadImage` reads from ITS OWN input folder rather than accepting bytes inline. So
   * the file goes across first and the graph refers to it by the name ComfyUI gives back — which
   * may not be the name we sent, if one already existed.
   */
  async uploadImage(bytes: Uint8Array, filename: string): Promise<string | null> {
    try {
      const form = new FormData();
      // `bytes.slice()` yields a plain ArrayBuffer, which Blob accepts on every Node version we
      // run. Passing the Uint8Array directly needs DOM lib types this project does not include.
      form.append('image', new Blob([bytes.slice().buffer], { type: 'image/png' }), filename);
      /*
       * `overwrite=false` so two members uploading `screenshot.png` in the same minute cannot
       * collide — ComfyUI renames and returns the name it actually used. Trusting our own filename
       * here would have one member's job silently render the other's screenshot.
       */
      form.append('overwrite', 'false');

      const res = await this.fetchImpl(`${this.baseUrl}/upload/image`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) return null;

      const body = (await res.json()) as { name?: unknown };
      return typeof body.name === 'string' && body.name !== '' ? body.name : null;
    } catch {
      return null;
    }
  }

  /**
   * Polls until the job produces an image, then fetches it.
   *
   * `deadlineAt` is absolute rather than a duration so a caller running several stages (restyle
   * then upscale) can share ONE budget across them instead of each stage getting the full time.
   */
  async awaitImage(
    promptId: string,
    deadlineAt: number,
  ): Promise<{ ok: true; png: Uint8Array } | { ok: false; failure: WaitFailure }> {
    while (Date.now() < deadlineAt) {
      await this.sleep(IMAGE_POLL_MS);

      const entry = await this.#history(promptId);
      if (entry === null) continue;

      const ref = firstImage(entry);
      if (ref === null) {
        /*
         * Finished, with nothing to show. A real failure — a bad model filename, or the card ran
         * out of memory mid-decode — and polling on would spin to the deadline for an answer that
         * already arrived.
         */
        if (isFinished(entry)) return { ok: false, failure: 'no-image' };
        continue;
      }

      const png = await this.#download(ref);
      // A download that failed is worth one more poll rather than failing the job: the image
      // exists, and a single dropped request across the tunnel should not discard it.
      if (png !== null) return { ok: true, png };
    }

    return { ok: false, failure: 'timeout' };
  }

  async #history(promptId: string): Promise<HistoryEntry | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/history/${promptId}`);
      if (!res.ok) return null;
      const body = (await res.json()) as Record<string, HistoryEntry>;
      return body[promptId] ?? null;
    } catch {
      return null;
    }
  }

  async #download(ref: ImageRef): Promise<Uint8Array | null> {
    const q = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder,
      type: ref.type,
    });
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/view?${q.toString()}`);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}

/** Pulls the first image reference out of a history entry, tolerating a graph with several outputs. */
export function firstImage(entry: HistoryEntry): ImageRef | null {
  for (const node of Object.values(entry.outputs ?? {})) {
    for (const img of node.images ?? []) {
      const filename = img['filename'];
      if (typeof filename !== 'string' || filename === '') continue;
      return {
        filename,
        subfolder: typeof img['subfolder'] === 'string' ? img['subfolder'] : '',
        // Defaults to `temp` because that is where PreviewImage writes; `output` would 404.
        type: typeof img['type'] === 'string' && img['type'] !== '' ? img['type'] : 'temp',
      };
    }
  }
  return null;
}

/**
 * Whether ComfyUI considers this job done.
 *
 * A history entry EXISTS while a job is still running, so its presence proves nothing. Only the
 * status says whether there is any point polling again.
 */
export function isFinished(entry: HistoryEntry): boolean {
  const s = entry.status;
  if (s === undefined) return false;
  if (s.completed === true) return true;
  return s.status_str === 'success' || s.status_str === 'error';
}
