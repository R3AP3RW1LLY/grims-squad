/**
 * The Account tab of Commander Management.
 *
 * ★ EXTRACTED FROM ITS OWN PAGE, NOT COPIED ★
 *
 * This was `/settings/account`, a separate sidebar entry and a separate route.
 * Four routes for one person's settings meant four page loads to answer "how is
 * my account set up", and the "Related" panels existed purely to hop between
 * them — a rail full of links to the other three quarters of the same page.
 *
 * The BODY moved here verbatim so nothing was rewritten in the move; the old
 * route now redirects, so links and bookmarks still land in the right place.
 */

import { getMySessions, getMe } from '../../../../lib/api';
import { SessionsPanel } from './sessions-panel';
import {
  PageBody,
  Panel,
  Section,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export async function AccountBody() {
  const [data, me] = await Promise.all([getMySessions(), getMe()]);

  return (
    <>
      {/* No PageHeader: the Commander Management page renders one for every tab. */}

      {data === null ? (
        <CouldNotLoad what="your account details" />
      ) : (
        <PageBody
          lead="Where you are signed in, and everything the hub holds about you."
          rail={
            <>
              <Panel title="You">
                <RailStat label="Display name" value={me.user?.displayName ?? '—'} />
                <RailStat label="Handle" value={me.user?.handle ?? '—'} />
                <RailStat label="Rank" value={me.user?.rank ?? 'None'} />
                <RailStat label="Open sessions" value={String(data.sessions.length)} />
              </Panel>

              <Panel title="Related">
                <a
                  href="/settings/privacy"
                  className="block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Privacy settings
                </a>
                <a
                  href="/settings/commander"
                  className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Your commander
                </a>
                <a
                  href="/settings/security"
                  className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Security
                </a>
              </Panel>
            </>
          }
        >
          <Section
            title="Signed-in devices"
            description="Ending a session signs that device out immediately. If you see something here you do not recognise, end it and tell an officer."
          >
            <SessionsPanel initial={data.sessions} />
          </Section>

          <Section
            title="Your data"
            description="Download everything the hub holds about you as a JSON file: your profile, privacy settings, Discord link, roles, verified commander names, activity totals and sessions."
          >
            <p className="max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Access tokens are not included. They are credentials for your Discord account that we
              hold on your behalf, and a copy in your downloads folder would help nobody.
            </p>
            <a
              href="/v1/me/export"
              download="grims-squad-export.json"
              className="mt-6 inline-block rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]"
            >
              Download my data
            </a>
          </Section>
        </PageBody>
      )}
    </>
  );
}
