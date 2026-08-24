import type { RavenImport } from './raven-import.js';

/**
 * What importing a Raven export would actually change, worked out before anything is written.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * The ruling on the one genuine conflict: "Import wins, and say so." The file comes from the
 * architect view in game, and typed numbers were always somebody's best guess at the same thing.
 *
 * ★ WHY A PREVIEW EXISTS AT ALL ★
 *
 * The worst outcome available to this feature is silently replacing a plan somebody spent an evening
 * on. A member picks a file off their disk — possibly the wrong one, possibly an old export of a
 * system they have since rebuilt — and every failure mode here is quiet: the plan simply becomes
 * something else, and nothing says which parts were theirs.
 *
 * So the import is two steps, and this is the first. It writes nothing. It answers "here is what
 * would change, including what you would lose", and the member decides.
 *
 * ★ AND IT IS ONLY WORTH READING IF IT IS HONEST ABOUT THE LOSSES ★
 *
 * The tempting shape is a cheerful summary of everything gained — forty bodies, nine slot counts,
 * four structures. That reads as pure profit and hides the only line that matters, which is the one
 * saying a number the member typed themselves is about to be overwritten.
 */

/** A body as the plan currently holds it. Only the fields an import can disturb. */
export interface CurrentBody {
  readonly bodyId: number;
  readonly name: string;
  readonly orbitalSlots: number | null;
  readonly surfaceSlots: number | null;
  /** When somebody last set those counts by hand. Null when nobody has. */
  readonly slotsAt: string | null;
}

/** A site the plan already holds. */
export interface CurrentSite {
  readonly bodyId: number | null;
  readonly buildTypeId: string | null;
  /** Anything past 'planned' exists in the game and cannot be moved — see `colony-draft-mode`. */
  readonly state: 'planned' | 'started' | 'building' | 'complete';
}

export interface SlotChange {
  readonly bodyId: number;
  readonly bodyName: string;
  readonly from: { readonly orbital: number | null; readonly surface: number | null };
  readonly to: { readonly orbital: number | null; readonly surface: number | null };
  /** True when a member had typed these by hand and the import disagrees. The line that matters. */
  readonly overwritesTyped: boolean;
}

export interface RavenPreview {
  readonly systemName: string;
  /** Bodies the plan does not hold at all. Usually zero — both sides come from the same survey. */
  readonly unknownBodies: readonly string[];
  /** Slot counts that would be written, split by whether they replace something. */
  readonly slotsAdded: readonly SlotChange[];
  readonly slotsChanged: readonly SlotChange[];
  /** Structures in the file the plan has no row for. */
  readonly sitesAdded: number;
  /**
   * Structures the file says are BUILT on a body where the plan already has something else.
   *
   * Reported rather than resolved: the game is the authority on what is standing, but silently
   * replacing a member's intention with it is the same silent edit this preview exists to prevent.
   */
  readonly siteConflicts: readonly string[];
  /** True when nothing at all would change — worth saying, because it looks like a failure. */
  readonly identical: boolean;
  /** Everything the parser could not read, carried through so one screen shows the whole picture. */
  readonly problems: readonly string[];
}

const sameCount = (a: number | null, b: number | null): boolean => a === b;

/**
 * Works out the difference. Writes nothing, and never throws.
 *
 * ★ MATCHED ON BODY ID, WHICH BOTH SIDES AGREE ON ★
 *
 * Verified against production before this was written: Raven's `num` is Frontier's body id, which is
 * exactly what `colony_bodies.body_id` holds. Matching on NAME would fail the moment a survey spells
 * a body differently, and would fail silently — producing an import that quietly added duplicates.
 */
export function previewRavenImport(
  file: RavenImport,
  current: { readonly bodies: readonly CurrentBody[]; readonly sites: readonly CurrentSite[] },
): RavenPreview {
  const byId = new Map(current.bodies.map((b) => [b.bodyId, b]));

  const slotsAdded: SlotChange[] = [];
  const slotsChanged: SlotChange[] = [];
  const unknownBodies: string[] = [];

  for (const incoming of file.slots) {
    const body = byId.get(incoming.bodyNum);
    if (body === undefined) {
      /*
       * A slot record for a body the plan has never heard of. Named rather than counted: it almost
       * certainly means the file is for a different system, which is the mistake a member most wants
       * catching before they press the button.
       */
      unknownBodies.push(`body ${incoming.bodyNum}`);
      continue;
    }

    if (sameCount(body.orbitalSlots, incoming.orbital) && sameCount(body.surfaceSlots, incoming.surface)) {
      continue;
    }

    const change: SlotChange = {
      bodyId: body.bodyId,
      bodyName: body.name,
      from: { orbital: body.orbitalSlots, surface: body.surfaceSlots },
      to: { orbital: incoming.orbital, surface: incoming.surface },
      /*
       * `slotsAt` is the record of somebody having typed these. Its presence is what turns "filling
       * in a blank" into "overruling a person", and those two need to read differently on screen.
       */
      overwritesTyped: body.slotsAt !== null,
    };

    if (body.orbitalSlots === null && body.surfaceSlots === null) slotsAdded.push(change);
    else slotsChanged.push(change);
  }

  /*
   * Sites are matched by body AND build type: the same structure on the same body is the same
   * structure. A body that already holds a DIFFERENT build is a conflict rather than an addition,
   * because the file and the plan disagree about what is there.
   */
  const existing = new Set(
    current.sites
      .filter((s) => s.bodyId !== null && s.buildTypeId !== null)
      .map((s) => `${s.bodyId}:${s.buildTypeId}`),
  );
  const occupied = new Map<number, CurrentSite[]>();
  for (const site of current.sites) {
    if (site.bodyId === null) continue;
    occupied.set(site.bodyId, [...(occupied.get(site.bodyId) ?? []), site]);
  }

  let sitesAdded = 0;
  const siteConflicts: string[] = [];

  for (const site of file.sites) {
    if (site.bodyNum === null || site.buildTypeId === null) continue;
    if (existing.has(`${site.bodyNum}:${site.buildTypeId}`)) continue;

    const here = occupied.get(site.bodyNum) ?? [];
    const clash = here.find((s) => s.buildTypeId !== null && s.buildTypeId !== site.buildTypeId);

    if (clash !== undefined && site.status !== 'planned') {
      const where = byId.get(site.bodyNum)?.name ?? `body ${site.bodyNum}`;
      siteConflicts.push(
        `${where}: the file says ${site.buildTypeId} is ${site.status === 'complete' ? 'built' : 'being built'}, the plan has ${clash.buildTypeId}.`,
      );
      continue;
    }

    sitesAdded += 1;
  }

  return {
    systemName: file.systemName,
    unknownBodies,
    slotsAdded,
    slotsChanged,
    sitesAdded,
    siteConflicts,
    identical:
      slotsAdded.length === 0 &&
      slotsChanged.length === 0 &&
      sitesAdded === 0 &&
      siteConflicts.length === 0,
    problems: file.problems,
  };
}

/**
 * The preview in a member's words.
 *
 * ★ LOSSES FIRST ★
 *
 * The same ordering the survey warnings and the plan checker already use on this platform: the thing
 * that might stop somebody comes before the thing that encourages them. A summary that leads with
 * "nine slot counts added" and buries "two you typed will be replaced" is a summary designed to be
 * agreed with rather than read.
 */
export function describeRavenPreview(preview: RavenPreview): readonly string[] {
  const lines: string[] = [];

  if (preview.unknownBodies.length > 0) {
    lines.push(
      `${preview.unknownBodies.length} slot record${preview.unknownBodies.length === 1 ? '' : 's'} name a body this system does not have — check this is the right file.`,
    );
  }

  const typed = preview.slotsChanged.filter((c) => c.overwritesTyped);
  if (typed.length > 0) {
    lines.push(
      `${typed.length} slot count${typed.length === 1 ? '' : 's'} you entered by hand will be replaced by the file's.`,
    );
  }

  const untyped = preview.slotsChanged.length - typed.length;
  if (untyped > 0) {
    lines.push(`${untyped} slot count${untyped === 1 ? '' : 's'} will change.`);
  }

  for (const clash of preview.siteConflicts) lines.push(clash);

  if (preview.slotsAdded.length > 0) {
    lines.push(
      `${preview.slotsAdded.length} bod${preview.slotsAdded.length === 1 ? 'y' : 'ies'} will get slot counts for the first time.`,
    );
  }

  if (preview.sitesAdded > 0) {
    lines.push(`${preview.sitesAdded} structure${preview.sitesAdded === 1 ? '' : 's'} will be added.`);
  }

  for (const problem of preview.problems) lines.push(problem);

  /*
   * Said in words rather than shown as an empty list. An import that would change nothing and an
   * import that failed to read the file look identical as a blank panel, and only one of them is
   * fine — the same distinction this codebase keeps having to relearn.
   */
  if (lines.length === 0) lines.push('This file matches the plan already — nothing would change.');

  return lines;
}
