import { commodityKey } from './commodity-name.js';

/**
 * What of a member's hold the hub is allowed to remember.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * Asked how far server-side hold tracking should go, the answer was: only while on a project, and
 * cleared when they undock empty or leave it.
 *
 * ★ WHY THAT BOUNDARY ★
 *
 * Storing every hold on every upload would answer the question and a great many others nobody asked
 * — the hub would keep a live record of what every member is carrying, everywhere, indefinitely.
 * The question that needs answering is narrow: "is somebody already carrying the Titanium this build
 * wants". Anything past that is collection for its own sake, on a platform whose telemetry rules are
 * written the other way round.
 *
 * So the project's want list IS the filter. A commodity no live build needs never reaches storage,
 * which means a member's mining run, trade loop and mission cargo never do either.
 *
 * ★ IT REPLACES, IT DOES NOT ACCUMULATE ★
 *
 * The tempting implementation is a running total, and it is wrong in a way nothing corrects: selling
 * 300 of 480 must read 180, where a maximum-so-far reads 480 for ever. Each call is the whole truth
 * about that hold at that moment, so an empty hold clears everything.
 */

export interface HeldLine {
  readonly commodity: string;
  readonly tonnes: number;
}

export interface ProjectWant {
  readonly commodity: string;
  /** Tonnes still wanted. Zero means the build needs no more of it. */
  readonly remaining: number;
}

/**
 * The part of a hold worth storing, given what live builds still want.
 *
 * Returns the WHOLE truth for this member: an empty result means store nothing and clear what was
 * there. There is deliberately no "no change" answer, because that is the shape that lets a stale
 * figure survive a sale.
 */
export function scopeHold(
  hold: readonly HeldLine[],
  wants: readonly ProjectWant[],
): readonly HeldLine[] {
  /*
   * Keyed the way the rest of the module keys commodities. "H.E. Suits" and "Hazardous Environment
   * Suits" are one thing, and missing that here would silently drop a hold the build genuinely
   * wants — an alias bug this codebase has already had once, in the project identification.
   */
  const wanted = new Set(
    wants.filter((w) => w.remaining > 0).map((w) => commodityKey(w.commodity)),
  );

  /*
   * A fast path, NOT a guard — said plainly because the difference matters to whoever edits this
   * next. The loop below already keeps nothing when the set is empty, and mutation testing confirms
   * removing this line changes no behaviour. It is here because "no live wants" is the common case
   * for most uploads and there is no reason to walk a hold to conclude that.
   */
  if (wanted.size === 0) return [];

  // Cargo.json reports per STACK, so one commodity can arrive as several rows. A Map keeps the order
  // it was seen in rather than re-sorting into something nobody asked for.
  const totals = new Map<string, { commodity: string; tonnes: number }>();

  for (const line of hold) {
    const key = commodityKey(line.commodity);
    if (!wanted.has(key)) continue;
    // A zero row is a stack just emptied; a negative one is nonsense. Neither is worth drawing.
    if (!Number.isFinite(line.tonnes) || line.tonnes <= 0) continue;

    const held = totals.get(key);
    if (held === undefined) totals.set(key, { commodity: line.commodity, tonnes: line.tonnes });
    else held.tonnes += line.tonnes;
  }

  return [...totals.values()];
}
