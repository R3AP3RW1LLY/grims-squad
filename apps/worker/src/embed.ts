import { PrismaClient } from '@grims/db';
import { EMBED_DIMS } from '@grims/shared';
import { embedKnowledge, describeEmbedRun, type Embedder } from './jobs/embed-knowledge.js';

/**
 * Embedding prose knowledge, on a schedule.
 *
 * ★ THE ONLY JOB HERE THAT USES THE GPU ★
 *
 * Everything else in the ingest pipeline is a database write. This is the one that hands text to a
 * model — and it is why the card is idle during a galaxy import, which imports no prose.
 *
 * ★ THE CLIENT IS LOCAL TO THIS FILE, DELIBERATELY ★
 *
 * The API has an `EmbedClient` and it is the same twenty lines. Importing it would mean the worker
 * depending on the API package — a Nest application with a database module, a config module and an
 * HTTP server — to make one POST. The two are allowed to be the same shape without being the same
 * object.
 */

/** Where the embedding model answers. Root, not `/v1`: embeddings are a native endpoint. */
function embedRoot(): string | null {
  const raw = process.env['AI_EMBED_URL'] ?? process.env['AI_BASE_URL'] ?? '';
  if (raw === '') return null;
  // `AI_BASE_URL` points at the OpenAI-compatible prefix; the native API sits one level up.
  return raw.replace(/\/v1\/?$/, '');
}

class OllamaEmbedder implements Embedder {
  constructor(private readonly baseUrl: string) {}

  async embed(text: string): Promise<number[] | null> {
    const abort = new AbortController();
    /*
     * Longer than the API's ten seconds. Nothing is waiting on this — it is a nightly job — and a
     * cold model load after an idle spell genuinely takes a while. Giving up early here would mark
     * a perfectly good row as failed.
     */
    const timer = setTimeout(() => abort.abort(), 60_000);

    try {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          /*
           * Bounded at 2,000 characters, matching the API's client.
           *
           * A whole guide would embed its introduction and nothing else useful — the model has a
           * context window and silently truncates past it, so a longer string does not mean a
           * richer vector, it means a vector describing the first few paragraphs while claiming to
           * describe the document.
           */
          prompt: text.slice(0, 2_000),
        }),
      });
      if (!res.ok) return null;

      const body = (await res.json()) as { embedding?: unknown };
      const vector = body.embedding;
      if (!Array.isArray(vector) || vector.length !== EMBED_DIMS) return null;
      return vector as number[];
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function main(): Promise<void> {
  const root = embedRoot();
  if (root === null) {
    /*
     * Not an error. A deployment without a model is a real configuration — the site runs entirely
     * without one — and the vectors simply wait. Said out loud so it is not mistaken for a run that
     * found nothing to do.
     */
    console.log('embed: skipped, no AI_EMBED_URL or AI_BASE_URL configured');
    return;
  }

  const db = new PrismaClient();
  try {
    const report = await embedKnowledge(db, new OllamaEmbedder(root));
    console.log(describeEmbedRun(report));
    /*
     * A run where EVERY row failed is a broken model, not a quiet night — most likely the tunnel is
     * down. Non-zero so cron mails it, because the symptom otherwise is an assistant that quietly
     * answers worse.
     */
    if (report.embedded === 0 && report.failed > 0) process.exitCode = 1;
  } catch (e) {
    console.error(`embed: FAILED — ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

await main();
