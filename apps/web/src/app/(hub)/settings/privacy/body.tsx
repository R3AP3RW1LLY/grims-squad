/**
 * The Privacy tab of Commander Management.
 *
 * ★ EXTRACTED FROM ITS OWN PAGE, NOT COPIED ★
 *
 * This was `/settings/privacy`, a separate sidebar entry and a separate route.
 * Four routes for one person's settings meant four page loads to answer "how is
 * my account set up", and the "Related" panels existed purely to hop between
 * them — a rail full of links to the other three quarters of the same page.
 *
 * The BODY moved here verbatim so nothing was rewritten in the move; the old
 * route now redirects, so links and bookmarks still land in the right place.
 */

import { getMyPrivacy } from '../../../../lib/api';
import { PrivacyForm } from './privacy-form';
import {
  PageBody,
  Panel,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export async function PrivacyBody() {
  const settings = await getMyPrivacy();

  /*
   * Counted for the rail, and worth counting: the toggles are individually
   * clear but collectively hard to hold in your head. "Two of six on" is the
   * answer to the question a member actually has, which is "how exposed am I".
   */
  const shown =
    settings === null
      ? 0
      : [
          settings.showLocation,
          settings.showCredits,
          settings.showFleet,
          settings.showActivity,
          settings.showOnLeaderboard,
        ].filter(Boolean).length;

  return (
    <>
      {/* No PageHeader: the Commander Management page renders one for every tab. */}

      {settings === null ? (
        <CouldNotLoad what="your privacy settings" />
      ) : (
        <PageBody
          lead="Everything here starts switched off. Nothing on this list is shared with anyone until you turn it on, and each item is separate — showing your position does not also show your balance."
          rail={
            <>
              <Panel title="At a glance">
                <RailStat
                  label="Fields shared"
                  value={`${shown} of 5`}
                  tone={shown === 0 ? 'good' : 'default'}
                />
                {/*
                  Stated as a fact rather than offered as a switch. Being on the
                  roster is not a setting any more, and a member should learn
                  that here rather than by looking for a toggle that is gone.
                */}
                <RailStat label="On the roster" value="Everyone" />
                <RailStat
                  label="On leaderboards"
                  value={settings.showOnLeaderboard ? 'Yes' : 'No'}
                />
              </Panel>

              <Panel title="How this works">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  Changes save as you make them — there is no button to forget. A field you have not
                  turned on is left out of the answer entirely rather than sent blank, so nothing can
                  infer it from an empty space.
                </p>
              </Panel>

              <Panel title="Related">
                <a href="/roster" className="block text-sm text-[var(--color-brand-cyan-bright)]">
                  See the roster
                </a>
                <a
                  href="/settings/devices"
                  className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  What the companion app sends
                </a>
              </Panel>
            </>
          }
        >
          <PrivacyForm initial={settings} />
        </PageBody>
      )}
    </>
  );
}
