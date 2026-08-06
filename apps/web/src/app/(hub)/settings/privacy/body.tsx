/**
 * The privacy controls, on the Commander Management page.
 *
 * ★ IT WAS A PAGE, THEN A TAB, AND IS NOW A SECTION ★
 *
 * `/settings/privacy` was its own route and its own sidebar entry. It became a
 * tab on Commander Management, and on 2026-07-29 the squadron owner asked for
 * the tab to go too.
 *
 * That is the right call: it is five switches. A tab is a thing somebody has to
 * remember exists, and "what does the squadron see about me" belongs beside the
 * rest of a member's settings, where they are already looking.
 *
 * ★ A SECTION, NOT A BODY ★
 *
 * It used to render its own `PageBody` with its own rail and its own lead.
 * Dropped into a page that already has both, that would have produced two of
 * each. It now renders only its own content and inherits the page around it —
 * which is why the rail summary moved to the parent, and why `sharedFields` is
 * exported rather than counted here.
 */

import { LEADERBOARDS, type LeaderboardKey } from '@grims/shared';
import { getMyPrivacy, type PrivacySettings } from '../../../../lib/api';
import { PrivacyForm, type Toggle } from './privacy-form';
import { Section } from '../../../../components/hub-page';

/**
 * Which privacy field carries each board's opt-in.
 *
 * ★ A Record OVER THE KEY UNION, NOT A LOOKUP THAT SHRUGS ★
 *
 * The owner's requirement is that a board added to the shared catalogue appears here by being
 * added there. `Record<LeaderboardKey, …>` is the mechanism: a new board key widens the union,
 * this table stops compiling until the new field is named, and the toggle therefore cannot be
 * silently missing. Derived in this SERVER component because the form is a client component and
 * may not import runtime values from the `@grims/shared` barrel (client-imports.spec.ts).
 */
const LB_PRIVACY_KEYS: Record<LeaderboardKey, keyof PrivacySettings> = {
  bounties: 'showLbBounties',
  colony: 'showLbColony',
  trade: 'showLbTrade',
  mining: 'showLbMining',
};

/** One switch per board, straight off the catalogue: its name is the label, its measure the help. */
const BOARD_TOGGLES: readonly Toggle[] = LEADERBOARDS.map((board) => ({
  key: LB_PRIVACY_KEYS[board.key],
  label: board.name,
  help: board.measures,
}));

/**
 * How many of the five sharing toggles are on.
 *
 * ★ EXPORTED, BECAUSE THE RAIL LIVES ON THE PARENT NOW ★
 *
 * Computing it in two places is how a summary ends up disagreeing with the
 * switches directly beneath it.
 *
 * `showOnPublicRoster` is deliberately NOT counted. Appearing on the roster
 * stopped being a setting, and including a toggle nobody can change would make
 * the total describe something a member cannot act on.
 */
export function sharedFields(settings: PrivacySettings | null): number {
  if (settings === null) return 0;
  return [
    settings.showLocation,
    settings.showCredits,
    settings.showFleet,
    settings.showActivity,
    settings.showOnLeaderboard,
  ].filter(Boolean).length;
}

export async function PrivacyControls() {
  const settings = await getMyPrivacy();

  /*
   * A failure here does NOT take the page down.
   *
   * The timezone form above is unrelated and works perfectly well without
   * privacy settings. Blanking the whole screen because one read failed would
   * cost a member the setting they actually came for, so this says what is
   * missing and leaves the rest alone.
   */
  if (settings === null) {
    return (
      <Section
        title="What others can see"
        description="These settings could not be loaded just now. Nothing has changed, and the rest of this page still works."
      >
        <p className="max-w-[68ch] rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Try again in a moment. If it keeps happening, tell an officer.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="What others can see"
      description="Each item is separate — showing your position does not also show your balance. Changes save as you make them, so there is no button to forget."
    >
      <PrivacyForm initial={settings} boardToggles={BOARD_TOGGLES} />
    </Section>
  );
}
