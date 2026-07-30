import {
  ASSISTANT_TIMEOUT_MS,
  SCREEN_CATEGORIES,
  SCREEN_SYSTEM_PROMPT,
  SCREEN_TIMEOUT_MS,
  type ScreenCategory,
  type ScreenResult,
} from '@grims/shared';

/**
 * Talking to the model on the owner's GPU.
 *
 * ★ AN OPENAI-COMPATIBLE ENDPOINT, NOT AN OLLAMA CLIENT ★
 *
 * Ollama serves `/v1/chat/completions`, and so does LM Studio, llama.cpp, vLLM and every hosted
 * provider. Writing against the shape rather than the product means swapping the model, the
 * runtime, or eventually moving off the home GPU entirely is a change to one environment variable
 * rather than to this file.
 *
 * ★ UNAVAILABLE IS AN ANSWER, NOT AN EXCEPTION ★
 *
 * The model lives on a machine that may be off, asleep, or behind a tunnel that has dropped. That
 * is a NORMAL state, not an error — so `screen()` returns `unavailable` rather than throwing, and
 * every caller has to decide what to do about it. Throwing would mean the first caller who forgot
 * a try/catch takes the forum down whenever somebody's PC reboots.
 *
 * ★ NOTHING HERE RETRIES ★
 *
 * Deliberate. Screening is synchronous with a member watching a button, so a retry is just a
 * longer wait before the same answer. The moderation queue is the retry: a post held because the
 * screener was unreachable is reviewed by a human, which is a better outcome than the request
 * eventually succeeding two minutes after somebody gave up.
 */

export interface AiConfig {
  /** Base URL of the OpenAI-compatible server, e.g. `http://127.0.0.1:11434/v1`. */
  readonly baseUrl: string;
  /** Model for text: screening and the assistant. */
  readonly model: string;
  /** Optional bearer, for runtimes that want one. Ollama does not. */
  readonly apiKey?: string;
}

/** Reads config from the environment. Null means the AI is not configured — a legitimate state. */
export function aiConfigFrom(env: NodeJS.ProcessEnv): AiConfig | null {
  const baseUrl = env['AI_BASE_URL'];
  const model = env['AI_MODEL'];
  if (typeof baseUrl !== 'string' || baseUrl === '') return null;
  if (typeof model !== 'string' || model === '') return null;

  const apiKey = env['AI_API_KEY'];
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    ...(typeof apiKey === 'string' && apiKey !== '' ? { apiKey } : {}),
  };
}

export class AiClient {
  constructor(
    private readonly config: AiConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Whether the AI is configured at all. Not whether it is reachable — only a call knows that. */
  get configured(): boolean {
    return this.config !== null;
  }

  /**
   * Screens a piece of writing.
   *
   * Returns `unavailable` for every failure — unconfigured, unreachable, timed out, or an answer
   * that could not be parsed. The caller treats all of those the same way, because from a member's
   * point of view they are the same thing: nobody has looked at this yet.
   */
  async screen(text: string): Promise<ScreenResult> {
    const started = Date.now();

    const raw = await this.#complete(
      [
        { role: 'system', content: SCREEN_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      SCREEN_TIMEOUT_MS,
      /*
       * Zero temperature. Screening the same post twice must reach the same verdict — a moderator
       * who sees a post cleared on retry that was flagged a minute ago has no way to trust either
       * answer, and members would quickly learn to just post again.
       */
      0,
    );

    const tookMs = Date.now() - started;
    if (raw === null) return { verdict: 'unavailable', categories: [], reason: null, tookMs };

    const parsed = parseScreenJson(raw);
    if (parsed === null) {
      /*
       * The model answered with something that is not our shape. Treated as unavailable rather
       * than as clear: an unparseable answer is not evidence that a post is fine, and defaulting
       * to "clear" would mean a confused model silently disables moderation.
       */
      return { verdict: 'unavailable', categories: [], reason: null, tookMs };
    }

    return {
      verdict: parsed.flagged ? 'flagged' : 'clear',
      categories: parsed.categories,
      reason: parsed.reason,
      tookMs,
    };
  }

  /** Asks the assistant. Null when the AI is unreachable, so the caller can say so plainly. */
  async ask(
    systemPrompt: string,
    messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string | null> {
    return this.#complete(
      [{ role: 'system', content: systemPrompt }, ...messages],
      ASSISTANT_TIMEOUT_MS,
      // A little warmth, so answers do not read like a form letter — but not enough to invent.
      0.3,
    );
  }

  async #complete(
    messages: ReadonlyArray<{ role: string; content: string }>,
    timeoutMs: number,
    temperature: number,
  ): Promise<string | null> {
    if (this.config === null) return null;

    /*
     * An AbortController, not a Promise.race. A race leaves the request running — so a stalled
     * tunnel accumulates one abandoned connection per post, and the machine at the other end keeps
     * generating tokens nobody will read.
     */
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey === undefined
            ? {}
            : { authorization: `Bearer ${this.config.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature,
          // Bounded, so a model that starts rambling cannot hold the connection open to the timeout.
          max_tokens: 512,
        }),
      });

      if (!res.ok) return null;

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      return typeof content === 'string' && content.trim() !== '' ? content : null;
    } catch {
      // Timeout, DNS, refused connection, a dropped tunnel. All the same answer: not available.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Reads the model's JSON, tolerating the wrapping models add.
 *
 * ★ WHY THIS IS NOT `JSON.parse(raw)` ★
 *
 * Even told to return only JSON, models wrap it in a fenced code block, or add "Here is the
 * result:" in front. That is not a reason to reject a perfectly good verdict, so the object is
 * extracted from the surrounding text — but anything that is still not our shape is refused rather
 * than guessed at.
 */
export function parseScreenJson(
  raw: string,
): { flagged: boolean; categories: ScreenCategory[]; reason: string | null } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;

  /*
   * `flagged` must be a real boolean. A model that answers `"flagged": "yes"` is answering a
   * different question from the one asked, and coercing a truthy string here would make
   * `"flagged": "no"` mean flagged.
   */
  if (typeof o['flagged'] !== 'boolean') return null;

  const categories = (Array.isArray(o['categories']) ? o['categories'] : [])
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.toLowerCase().trim())
    // Unknown categories dropped rather than kept: a reviewer filtering by category should not
    // meet one the system does not define.
    .filter((c): c is ScreenCategory => (SCREEN_CATEGORIES as readonly string[]).includes(c));

  const reason = typeof o['reason'] === 'string' && o['reason'].trim() !== '' ? o['reason'].trim().slice(0, 500) : null;

  return { flagged: o['flagged'], categories: [...new Set(categories)], reason };
}
