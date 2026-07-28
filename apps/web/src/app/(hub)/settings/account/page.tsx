import type { Metadata } from 'next';
import { getMySessions, getMe } from '../../../../lib/api';
import { SessionsPanel } from './sessions-panel';
import {
  PageHeader,
  PageBody,
  Panel,
  Section,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export const metadata: Metadata = {
  title: "Account — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const [data, me] = await Promise.all([getMySessions(), getMe()]);

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="ACCOUNT"
        lead="Where you are signed in, and everything the hub holds about you."
      />

      {data === null ? (
        <CouldNotLoad what="your account details" />
      ) : (
        <PageBody
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
