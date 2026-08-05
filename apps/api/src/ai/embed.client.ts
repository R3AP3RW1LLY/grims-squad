import { EMBED_DIMS, EMBED_MODEL } from '@grims/shared';

/**
 * Turning a post into a vector, so similar past decisions can be found.
 *
 * ★ A SEPARATE, TINY MODEL ★
 *
 * nomic-embed-text is about 300MB against the screening model's 4.7GB, and does a different job:
 * it does not judge anything, it only places text near other text. Keeping it separate means
 * retrieval costs a few milliseconds rather than a second, and the screening model is never asked
 * to do something it is bad at.
 *
 * ★ NULL IS AN ANSWER ★
 *
 * Same rule as everywhere else in this folder. Embedding runs on the post path, and a member must
 * never fail to post because a 300MB helper model was unreachable — the screener simply proceeds
 * without precedent, which is exactly how it behaved before this existed.
 */
export class EmbedClient {
  constructor(
    /** The runtime's ROOT, not the `/v1` compatibility prefix — embeddings are a native endpoint. */
    private readonly baseUrl: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return this.baseUrl !== null && this.baseUrl !== '';
  }

  /**
   * Embeds one piece of text. Null if the model is unreachable or answers with the wrong shape.
   *
   * The dimension check is not paranoia: swapping the embedding model changes the vector length,
   * and a 512-wide vector written into a `vector(768)` column fails at the database with an error
   * that names neither this file nor the model. Refusing here says what actually happened.
   */
  async embed(text: string): Promise<number[] | null> {
    if (this.baseUrl === null || this.baseUrl === '') return null;

    const abort = new AbortController();
    // Generous: this runs while somebody waits to post, but a cold 300MB model still loads fast.
    const timer = setTimeout(() => abort.abort(), 10_000);

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: EMBED_MODEL,
          // Bounded. A whole guide would embed the introduction and nothing else useful, and the
          // decisions worth retrieving are all short.
          prompt: text.slice(0, 2_000),
        }),
      });
      if (!res.ok) return null;

      const body = (await res.json()) as { embedding?: unknown };
      const vector = body.embedding;
      if (!Array.isArray(vector) || vector.length !== EMBED_DIMS) return null;
      if (!vector.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) return null;

      return vector;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Derives the native root from the OpenAI-compatible base URL.
 *
 * `AI_BASE_URL` is `http://host:11434/v1` because everything else speaks the chat protocol.
 * Embeddings are a native endpoint beside it, so one config value still drives both and there is no
 * second variable for somebody to set inconsistently.
 */
export function embedRootFrom(env: NodeJS.ProcessEnv): string | null {
  const base = env['AI_BASE_URL'];
  if (typeof base !== 'string' || base === '') return null;
  return base.replace(/\/+$/, '').replace(/\/v1$/, '');
}
