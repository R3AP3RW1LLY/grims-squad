/**
 * Which project the overlay should be talking about.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Use the Primary button to set or clear your primary project. SrvSurvey will then show cargo
 * items needed only for the primary or all projects."
 *
 * ★ DOCKED WINS, PRIMARY IS THE FALLBACK — THE OWNER'S CALL ★
 *
 * The overlay already followed the dock, and that behaviour is right: a member docked at a
 * construction site is unambiguously working on THAT site, and showing them a different project's
 * shopping list at the moment they are handing cargo over would be wrong exactly when it matters.
 *
 * What it could not do is help anywhere else — buying cargo at a market, sitting on a carrier, out
 * in the black — because it had nothing to fall back to. That is the gap the primary fills.
 *
 * ★ AND A REASON, NOT JUST AN ANSWER ★
 *
 * The overlay says WHY it is showing what it is showing. A member who set a primary and then sees a
 * different project needs to know it is because they are docked, not because the setting was lost.
 * A panel that silently switches focus is one nobody trusts.
 */

export type FocusReason =
  /** Docked at this project's construction site. */
  | 'docked'
  /** The member's chosen project, shown because they are not docked at a site. */
  | 'primary'
  /** Every active project at once. */
  | 'all'
  /** Nothing to show. */
  | 'none';

export interface FocusInput {
  /** The project whose construction site the member is docked at, if any. */
  readonly dockedProjectId: string | null;
  /** What the member chose, or null if they have not chosen. */
  readonly primaryProjectId: string | null;
  /** Every project they could be shown. */
  readonly activeProjectIds: readonly string[];
  /** The member has asked for the combined view. */
  readonly showAll: boolean;
}

export interface Focus {
  /** The project to show, or null when showing all or nothing. */
  readonly projectId: string | null;
  readonly reason: FocusReason;
  /** What to tell the member about this choice. */
  readonly because: string;
  /**
   * Whether that sentence is worth the space.
   *
   * ★ DECIDED HERE SO A PANEL NEVER HAS TO READ THE PROSE ★
   *
   * The overlay is a strip over a cockpit: a line explaining something the member can already see
   * costs a row of the list they are actually flying by. But the surprising cases — docked somewhere
   * that is not your primary, a primary that has quietly stopped applying — are exactly the ones
   * that look like a bug when unexplained.
   *
   * The alternative is each surface matching on the string to decide whether to draw it, which is
   * two copies of a rule that would drift the first time the wording changed.
   */
  readonly notable: boolean;
}

/**
 * Picks the project, and says why.
 *
 * ★ A STALE PRIMARY IS IGNORED, NOT OBEYED ★
 *
 * A primary pointing at a project that has finished or been deleted must not win: the overlay would
 * show a completed shopping list for ever, and the member would have no way to tell that from
 * "nothing left to buy". Checked against the active list rather than trusted.
 */
export function overlayFocus(input: FocusInput): Focus {
  if (input.showAll) {
    // Asked for, so never a surprise — the member is looking at what they switched to.
    return input.activeProjectIds.length === 0
      ? { projectId: null, reason: 'none', because: 'No projects are being built.', notable: false }
      : {
          projectId: null,
          reason: 'all',
          because: `Everything needed across ${input.activeProjectIds.length} project${
            input.activeProjectIds.length === 1 ? '' : 's'
          }.`,
          notable: false,
        };
  }

  /*
   * Docked first. A member handing cargo over is doing that, whatever they set last week.
   *
   * Not checked against the active list: a site can be docked at before its project appears here,
   * and refusing to show it would leave the overlay blank at the one moment it is most useful.
   */
  if (input.dockedProjectId !== null) {
    /*
     * ★ AND WHEN THE DOCK IS NOT WHAT THEY CHOSE, SAY SO ★
     *
     * This is the case that changed behaviour, so it is the case most likely to look like a bug. A
     * member who set a primary, flew to a different site to help out, and found their overlay
     * showing a project they did not pick needs one sentence telling them the app knows. Without it
     * the reasonable conclusion is that the setting broke.
     */
    const diverted =
      input.primaryProjectId !== null && input.primaryProjectId !== input.dockedProjectId;

    return {
      projectId: input.dockedProjectId,
      reason: 'docked',
      because: diverted ? 'Docked here — not your primary project.' : 'Docked here.',
      /*
       * Only the diversion is worth a line. A member docked at their own build can see the station
       * name on the title bar; telling them they are docked where they are docked spends a row of
       * the needs list to say nothing.
       */
      notable: diverted,
    };
  }

  const primary = input.primaryProjectId;
  if (primary !== null && input.activeProjectIds.includes(primary)) {
    // What they chose, doing what they chose it to do. Nothing to explain.
    return { projectId: primary, reason: 'primary', because: 'Your primary project.', notable: false };
  }

  /*
   * A primary that is set but no longer active. Said out loud rather than silently ignored — the
   * member chose it, and a setting that has quietly stopped applying is worse than one that failed.
   */
  if (primary !== null) {
    // Always worth a line: a setting that has silently stopped applying is the worst kind.
    return input.activeProjectIds.length === 0
      ? {
          projectId: null,
          reason: 'none',
          because: 'Your primary project has finished, and nothing else is being built.',
          notable: true,
        }
      : {
          projectId: null,
          reason: 'all',
          because: 'Your primary project has finished — showing everything instead.',
          notable: true,
        };
  }

  if (input.activeProjectIds.length === 0) {
    return { projectId: null, reason: 'none', because: 'No projects are being built.', notable: false };
  }

  /*
   * No primary chosen, not docked. Everything, rather than guessing one — a guess would be right
   * sometimes and silently wrong the rest, and the member has not told us anything to go on.
   */
  return {
    projectId: null,
    reason: 'all',
    because: 'No primary set — showing everything.',
    /*
     * Worth saying once: it points at the fix. A member seeing four projects' worth of commodities
     * has a reason to want one, and this is the only place that tells them one exists.
     */
    notable: true,
  };
}
