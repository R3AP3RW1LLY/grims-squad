import type { Metadata } from 'next';
import { getTotpStatus, getAccountStatus, getMySessions } from '../../../../lib/api';
import { SecurityForm } from '../../../../components/security-form';
import {
  PageHeader,
  PageBody,
  Panel,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export const metadata: Metadata = {
  title: "Security — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const [status, account, sessions] = await Promise.all([
    getTotpStatus(),
    getAccountStatus(),
    getMySessions(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="SECURITY"
      />

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
                  href="/settings/privacy"
                  className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Privacy settings
                </a>
              </Panel>
            </>
          }
        >
          <SecurityForm enrolled={status.enrolled} />
        </PageBody>
      )}
    </>
  );
}
