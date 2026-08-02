/**
 * The Security tab of Commander Management.
 *
 * ★ EXTRACTED FROM ITS OWN PAGE, NOT COPIED ★
 *
 * This was `/settings/security`, a separate sidebar entry and a separate route.
 * Four routes for one person's settings meant four page loads to answer "how is
 * my account set up", and the "Related" panels existed purely to hop between
 * them — a rail full of links to the other three quarters of the same page.
 *
 * The BODY moved here verbatim so nothing was rewritten in the move; the old
 * route now redirects, so links and bookmarks still land in the right place.
 */

import { getTotpStatus, getAccountStatus, getMySessions } from '../../../../lib/api';
import { SecurityForm } from '../../../../components/security-form';
import {
  PageBody,
  Panel,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export async function SecurityBody() {
  const [status, account, sessions] = await Promise.all([
    getTotpStatus(),
    getAccountStatus(),
    getMySessions(),
  ]);

  return (
    <>
      {/* No PageHeader: the Commander Management page renders one for every tab. */}

      {status === null ? (
        <CouldNotLoad what="your security settings" />
      ) : (
        <PageBody
          lead="Signing in to the hub takes one step — your Discord account. A second factor is required only to open the admin console, because those accounts can grant roles and change how the site works."
          rail={
            <>
              <Panel title="Status">
                <RailStat
                  label="Second factor"
                  value={status.enrolled ? 'Enrolled' : 'Not set up'}
                  tone={status.enrolled ? 'good' : account?.privileged === true ? 'warn' : 'default'}
                />
                <RailStat
                  label="Account type"
                  value={account?.privileged === true ? 'Privileged' : 'Standard'}
                />
                <RailStat
                  label="Signed-in devices"
                  value={sessions === null ? '—' : String(sessions.sessions.length)}
                />
              </Panel>

              {/*
                Named, not summarised. "You hold admin permissions" is an
                assertion; a list is something a member can check against what
                they think they were given, and dispute if it is wrong.
              */}
              {account !== null && account.because.length > 0 && (
                <Panel title="Why this is required">
                  <ul className="list-none space-y-1 p-0 font-mono text-xs text-[var(--color-brand-cyan-bright)]">
                    {account.because.map((p) => (
                      <li key={p}>{p.replace(/_/g, ' ').toLowerCase()}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                    A stolen Discord account holding these is other people&rsquo;s problem, not just
                    yours.
                  </p>
                </Panel>
              )}

              <Panel title="Related">
                <a
                  href="/settings/account"
                  className="block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Signed-in devices
                </a>
                <a
                  href="/settings/commander"
                  className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Privacy settings
                </a>
              </Panel>
            </>
          }
        >
          {/*
            `privileged` only changes what removal WARNS about. Whether the admin console actually
            closes is decided by AdminGateGuard, which reads enrolment directly — this is the
            courtesy of saying so first.
          */}
          <SecurityForm enrolled={status.enrolled} privileged={account?.privileged === true} />
        </PageBody>
      )}
    </>
  );
}
