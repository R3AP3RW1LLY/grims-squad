import { forStream } from './redact.js';

/**
 * The live AI log, for the admin area.
 *
 * ★ WHAT THIS IS FOR ★
 *
 * Squadron owner, 2026-07-30: "we also want realtime streaming logs for ai in the admin area".
 *
 * The stored log in `ai_calls` answers "what did it say to that member last Tuesday". This answers
 * a different question — "is it working RIGHT NOW" — which is what somebody actually wants while
 * setting up a tunnel, swapping a model, or wondering why posts are being held.
 *
 * ★ IN MEMORY, AND DELIBERATELY LOSSY ★
 *
 * A ring buffer of recent lines, not a durable store. Two reasons: `ai_calls` already keeps the
 * durable record, so persisting twice would mean two things to keep in step; and a stream that
 * guarantees delivery has to buffer per subscriber, which turns one officer leaving a tab open
 * overnight into unbounded memory.
 *
 * A subscriber that misses lines has missed lines. That is the correct trade for a live view.
 */

export type AiLogLevel = 'info' | 'warn' | 'error';

export interface AiLogLine {
  readonly at: string;
  readonly level: AiLogLevel;
  /** `screen`, `assistant`, `signature`, `health`. */
  readonly kind: string;
  readonly message: string;
  /** Milliseconds, when the line describes a completed call. */
  readonly tookMs?: number;
}

/** How many recent lines a newly-connected admin sees. Enough to show a pattern, not a history. */
const BACKLOG = 100;

export class AiStreamService {
  readonly #recent: AiLogLine[] = [];
  readonly #subscribers = new Set<(line: AiLogLine) => void>();
  /**
   * Where every line is kept.
   *
   * ★ OPTIONAL, AND THE STREAM WORKS WITHOUT IT ★
   *
   * Set once at boot by the module. Absent, the panel behaves exactly as it always has — a ring
   * buffer and nothing else — which is what every unit test constructs and what a deployment with
   * no database would do. The record is an addition, never a dependency.
   */
  #sink: ((line: AiLogLine) => void) | null = null;

  /** Called once, at boot. See `#sink`. */
  persistTo(sink: (line: AiLogLine) => void): void {
    this.#sink = sink;
  }

  /**
   * Records a line and pushes it to anybody watching.
   *
   * ★ EVERY STRING IS REDACTED HERE, NOT AT THE CALL SITES ★
   *
   * One choke point. Redacting at each call site means the next person to add a log line has to
   * remember — and the line they forget will be the one carrying a stack trace full of
   * `C:\Users\<name>\`. A single funnel makes the guarantee structural rather than a convention.
   */
  emit(line: Omit<AiLogLine, 'at'>): void {
    const entry: AiLogLine = {
      at: new Date().toISOString(),
      level: line.level,
      kind: forStream(line.kind),
      message: forStream(line.message),
      ...(line.tookMs === undefined ? {} : { tookMs: line.tookMs }),
    };

    this.#recent.push(entry);
    if (this.#recent.length > BACKLOG) this.#recent.shift();

    /*
     * ★ RECORDED AFTER THE BUFFER, BEFORE THE FAN-OUT, AND NEVER ALLOWED TO THROW ★
     *
     * Squadron owner: "record all logs so we have a record of them." The ring buffer is a hundred
     * lines that vanish on restart; this is the part that survives.
     *
     * Wrapped because a log line must never be the reason something fails. The database being
     * unreachable is exactly the sort of moment when the live panel matters most, and taking the
     * stream down to record a message about it would be the worst possible trade.
     */
    if (this.#sink !== null) {
      try {
        this.#sink(entry);
      } catch {
        // Deliberately silent: reporting a failed log write through the log is a loop.
      }
    }

    for (const send of this.#subscribers) {
      /*
       * One broken subscriber must not stop the others. A closed connection throws on write, and
       * without this the first officer to close a tab silently kills the stream for everybody else.
       */
      try {
        send(entry);
      } catch {
        this.#subscribers.delete(send);
      }
    }
  }

  /** The recent backlog, so a fresh connection is not a blank panel. */
  recent(): readonly AiLogLine[] {
    return [...this.#recent];
  }

  subscribe(send: (line: AiLogLine) => void): () => void {
    this.#subscribers.add(send);
    return () => this.#subscribers.delete(send);
  }

  /** How many admins are watching. Shown so nobody wonders whether the stream is connected. */
  get watchers(): number {
    return this.#subscribers.size;
  }
}
