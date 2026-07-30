/**
 * The embed extension point (P2.9).
 *
 * ★ WHAT THIS IS FOR, AND WHY IT SHIPS EMPTY ★
 *
 * P2.9's acceptance is that the extension point exists with a NO-OP renderer registered. Not a
 * feature — a seam. Later phases will want to render an in-post preview of a station, a loadout, a
 * BGS report or an operation, and each of those is a different phase's work.
 *
 * Shipping the seam now rather than later is the same reasoning as the reindex port: adding a
 * registry is easy, and finding every place that should have used one is the failure this project
 * has produced repeatedly. A renderer added in P7 should have exactly one place to register itself.
 *
 * ★ THE NO-OP IS THE SECURITY POSTURE, NOT A PLACEHOLDER ★
 *
 * An unknown embed kind renders as NOTHING — not as a link, not as the raw payload, not as an error
 * message containing it. That is deliberate:
 *
 *   - A document can only contain node types the validator accepts, so an unknown embed can only
 *     arrive from a future version of our own code or from a bug. Neither should produce output.
 *   - Rendering the payload "just so something appears" would be exactly the hole this whole
 *     document format exists to close: a path where content reaches HTML without a renderer that
 *     understands it.
 *
 * ★ EVERY RENDERER MUST RETURN ESCAPED HTML, AND THAT IS ITS CONTRACT ★
 *
 * Stated here because a registry is an invitation to add code that bypasses the careful bit. A
 * renderer receives a validated payload and returns markup; if it interpolates a string it did not
 * escape, it has reopened the injection surface for its own kind. `rich-doc.ts` has one `esc()` for
 * exactly this reason, and a future renderer belongs on the same side of it.
 */

/** A validated embed payload. Shape is per-kind and is the registering renderer's business. */
export interface EmbedPayload {
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Renders one embed kind to HTML.
 *
 * MUST return HTML that is already escaped. See the note above — the registry cannot check this,
 * which is why it is written down where a renderer author will read it.
 */
export type EmbedRenderer = (payload: EmbedPayload) => string;

/**
 * The registry.
 *
 * A class rather than a module-level map so tests can build one in isolation, and so a second
 * registry is possible if a future consumer needs a different set — a module-level singleton is the
 * thing that later has to be unpicked.
 */
export class EmbedRegistry {
  readonly #renderers = new Map<string, EmbedRenderer>();

  /**
   * Registers a renderer for a kind.
   *
   * Refuses to REPLACE one. Two renderers for the same kind means one of them is dead code and
   * nobody knows which — and silently taking the last registration makes the behaviour depend on
   * module import order, which is not a thing anybody should have to reason about.
   */
  register(kind: string, renderer: EmbedRenderer): void {
    if (kind.trim() === '') {
      throw new Error('An embed kind cannot be empty.');
    }
    if (this.#renderers.has(kind)) {
      throw new Error(
        `An embed renderer for "${kind}" is already registered. Two renderers for one kind means ` +
          `one is dead code and which one wins depends on import order.`,
      );
    }
    this.#renderers.set(kind, renderer);
  }

  /** Kinds that have a renderer. For a diagnostics endpoint, and for tests. */
  kinds(): readonly string[] {
    return [...this.#renderers.keys()].sort();
  }

  /**
   * Renders an embed, or NOTHING.
   *
   * Returns an empty string for an unregistered kind. Not a link, not the payload, not an error
   * message that contains it — see the header. An unknown kind is either a future version of our own
   * code or a bug, and neither should reach a reader.
   */
  render(payload: EmbedPayload): string {
    const renderer = this.#renderers.get(payload.kind);
    if (renderer === undefined) return '';
    try {
      return renderer(payload);
    } catch {
      /*
       * A renderer that throws must not take the whole post down with it. One broken embed costs its
       * own space and nothing else — a post that fails to render entirely because a station preview
       * hit a null is a far worse outcome than a gap where the preview would have been.
       */
      return '';
    }
  }
}

/**
 * The no-op renderer P2.9 requires, registered under `none`.
 *
 * It exists so the seam is exercised rather than merely present: a registry with nothing in it has
 * never had its register/render path run, and the first real renderer would be the first thing to
 * discover a mistake in it.
 */
export const NOOP_EMBED_KIND = 'none';

export function createEmbedRegistry(): EmbedRegistry {
  const registry = new EmbedRegistry();
  registry.register(NOOP_EMBED_KIND, () => '');
  return registry;
}
