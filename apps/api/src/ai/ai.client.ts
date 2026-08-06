import {
  ASSISTANT_TIMEOUT_MS,
  MODEL_KEEP_ALIVE,
  fewshotBlock,
  type ScreenDecision,
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

/**
 * How long to wait before the heartbeat's second attempt.
 *
 * Three seconds: comfortably longer than the tunnel takes to re-establish in the common case, and
 * a rounding error against the four-minute beat — so a genuine outage is still reported in the
 * same cycle rather than deferred to the next one.
 *
 * NOT a shorter warm timeout. A healthy `warm()` has been measured at up to 16.5 seconds on a cold
 * model load, so tightening the budget would manufacture the very false alarm this removes.
 */
const WARM_RETRY_MS = 3_000;

export class AiClient {
  constructor(
    private readonly config: AiConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
    /*
     * Optional, so the client is still constructible in a unit test that does not care about the
     * admin stream. Every string that reaches it is redacted at the stream's own funnel — see
     * `AiStreamService.emit` — rather than here, so a future call site cannot forget.
     */
    private readonly stream: { emit(line: { level: 'info' | 'warn' | 'error'; kind: string; message: string; tookMs?: number }): void } | null = null,
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
  async screen(text: string, precedent: readonly ScreenDecision[] = []): Promise<ScreenResult> {
    const started = Date.now();

    /*
     * ★ PRECEDENT, APPENDED TO THE SYSTEM PROMPT ★
     *
     * Past decisions by this squadron's officers on SIMILAR posts. Empty is the normal case and the
     * safe one — on a new install, or when the embedding model is unreachable, this is exactly the
     * prompt it has always been.
     *
     * Appended rather than interleaved as chat turns: examples presented as a conversation invite
     * the model to continue the conversation, and what is wanted is a rule, not a dialogue.
     */
    const raw = await this.#complete(
      [
        { role: 'system', content: SCREEN_SYSTEM_PROMPT + fewshotBlock(precedent) },
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
    if (raw === null) {
      this.stream?.emit({
        level: 'warn',
        kind: 'screen',
        message: 'No answer from the model — the post will be held for review.',
        tookMs,
      });
      return { verdict: 'unavailable', categories: [], reason: null, tookMs };
    }

    const parsed = parseScreenJson(raw);
    if (parsed === null) {
      /*
       * The model answered with something that is not our shape. Treated as unavailable rather
       * than as clear: an unparseable answer is not evidence that a post is fine, and defaulting
       * to "clear" would mean a confused model silently disables moderation.
       */
      this.stream?.emit({
        level: 'error',
        kind: 'screen',
        // The raw answer, redacted and truncated downstream. Seeing WHAT the model said instead of
        // JSON is the difference between "swap the model" and an afternoon of guessing.
        message: `Could not read the model's answer: ${raw}`,
        tookMs,
      });
      return { verdict: 'unavailable', categories: [], reason: null, tookMs };
    }

    this.stream?.emit({
      level: parsed.flagged ? 'warn' : 'info',
      kind: 'screen',
      message: parsed.flagged
        ? `Held — ${parsed.categories.join(', ') || 'no category given'}`
        : 'Cleared',
      tookMs,
    });

    return {
      verdict: parsed.flagged ? 'flagged' : 'clear',
      categories: parsed.categories,
      reason: parsed.reason,
      tookMs,
    };
  }

  /**
   * Loads the model and holds it there. Safe to call repeatedly.
   *
   * ★ WHY ANYTHING CALLS THIS AT ALL ★
   *
   * A cold model answers in 8.7 seconds; a resident one in 0.22. Screening happens while a member
   * watches a button, so the difference decides whether their post publishes or is held for review.
   *
   * `keep_alive` on each request covers the ordinary case. This covers the rest: the model server
   * restarting, the machine waking from sleep, or another model evicting ours. Called at boot and
   * on a heartbeat, so the first member to post after a quiet night is not the one who pays.
   *
   * Deliberately silent about failure — the model being unreachable is normal and is reported by
   * the health route, not by a warmup throwing into application startup.
   */
  async warm(): Promise<boolean> {
    if (this.config === null) return false;

    /*
     * Two steps, and both are needed.
     *
     * The pin is runtime-specific and may do nothing. The completion is portable and always works,
     * because loading a model is what answering a question requires — which is also why this
     * doubles as the heartbeat on runtimes that have no pin at all.
     */
    await this.#pin();

    // One token. Enough to force the load, small enough to cost nothing every four minutes.
    const answer = await this.#complete([{ role: 'user', content: 'ok' }], SCREEN_TIMEOUT_MS, 0);
    if (answer !== null) return true;

    /*
     * ★ ONE RETRY, AND ONLY FOR THE FAST FAILURE — SQUADRON OWNER, 2026-08-06 ★
     *
     * "we need to ensure this does not happen any more!"
     *
     * The AI runs on the owner's own machine and production reaches it down a reverse SSH tunnel
     * that drops several times a day. A healthy round trip through it is 35-47ms, so the reported
     * 4ms failures never reached the far end: they are a local connection refused, in the seconds
     * between sshd reaping the dead session and the tunnel coming back.
     *
     * That is a reconnect in progress, not an outage, and it was being logged as "posts will be
     * held". One retry after a short pause turns almost all of them into nothing at all.
     *
     * The pause is deliberately longer than a refusal takes and far shorter than the four-minute
     * beat, so a genuine outage is still reported inside the same cycle rather than hidden.
     */
    await new Promise((resolve) => setTimeout(resolve, WARM_RETRY_MS));

    const second = await this.#complete([{ role: 'user', content: 'ok' }], SCREEN_TIMEOUT_MS, 0);
    return second !== null;
  }

  /**
   * Asks the runtime to hold the model in memory indefinitely.
   *
   * ★ WHY THIS TALKS TO A NON-STANDARD ENDPOINT ★
   *
   * Everything else in this file speaks the OpenAI chat protocol on purpose, so the runtime is
   * swappable. This one call is not portable, and the measurement is the reason: the compatibility
   * layer silently DROPS `keep_alive`, while the native endpoint honours it. Portability that
   * leaves the model unloaded is portability that holds members' posts for review.
   *
   * Failure is ignored completely. A runtime without this endpoint returns 404, which is a correct
   * answer to a question it does not implement — and the completion in `warm()` loads the model
   * anyway. This is an optimisation, not a requirement.
   */
  async #pin(): Promise<void> {
    if (this.config === null) return;

    // `/v1` is the compatibility prefix; the native API sits beside it at the root.
    const root = this.config.baseUrl.replace(/\/v1$/, '');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SCREEN_TIMEOUT_MS);

    try {
      await this.fetchImpl(`${root}/api/generate`, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: 'ok',
          stream: false,
          keep_alive: MODEL_KEEP_ALIVE,
        }),
      });
    } catch {
      // Unreachable, unsupported, or timed out. All fine — see the note above.
    } finally {
      clearTimeout(timer);
    }
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
          /*
           * ★ SENT, BUT KNOWN TO BE IGNORED BY THE RUNTIME WE ACTUALLY USE ★
           *
           * Measured 2026-07-31: sending this to the OpenAI-compatible `/v1/chat/completions` path
           * leaves the model expiring in five minutes, while the runtime's NATIVE endpoint honours
           * it and pushes expiry three centuries out. The compatibility layer simply drops the
           * field.
           *
           * It stays because other runtimes do accept it and it costs nothing — but it is NOT what
           * keeps the model resident here. `warm()` is. Recorded plainly so nobody later concludes
           * this line is doing the job and removes the thing that is.
           */
          keep_alive: MODEL_KEEP_ALIVE,
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

/**
 * Whether the model is answering right now.
 *
 * ★ WORKS IDENTICALLY ON LOCALHOST AND ON THE SERVER ★
 *
 * Squadron owner, 2026-07-30: "the AI must work on both Localhost and our actual server / website".
 *
 * It does, and the shape is worth stating precisely — an earlier version of this comment said the
 * URL was `127.0.0.1:11434` in BOTH places, which is wrong and sends anybody debugging it to the
 * wrong socket.
 *
 *   development   AI_BASE_URL=http://127.0.0.1:11434/v1    Ollama on this machine.
 *   production    AI_BASE_URL=http://172.18.0.1:11434/v1   the Docker BRIDGE GATEWAY.
 *
 * The server value cannot be loopback: the API runs in a container, and 127.0.0.1 inside a
 * container is the container. The tunnel's near end is published on the bridge gateway, which is
 * reachable by containers on that host and by nothing else.
 *
 * What IS identical is the code path — one variable, no environment branching anywhere in this
 * file — which is what makes "it worked locally" mean something. The value differs; the logic does
 * not.
 */
export async function aiHealth(
  client: AiClient,
  fetchImpl: typeof fetch = fetch,
  config: AiConfig | null = aiConfigFrom(process.env),
): Promise<{ reachable: boolean; model: string | null; tookMs: number }> {
  if (config === null || !client.configured) return { reachable: false, model: null, tookMs: 0 };

  const started = Date.now();
  const abort = new AbortController();
  // Short: this is a liveness question, and a health check that hangs is itself a fault.
  const timer = setTimeout(() => abort.abort(), 4_000);

  try {
    const res = await fetchImpl(`${config.baseUrl}/models`, {
      signal: abort.signal,
      headers: config.apiKey === undefined ? {} : { authorization: `Bearer ${config.apiKey}` },
    });
    return { reachable: res.ok, model: config.model, tookMs: Date.now() - started };
  } catch {
    return { reachable: false, model: config.model, tookMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
