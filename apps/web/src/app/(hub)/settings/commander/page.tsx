import type { Metadata } from 'next';
import { getInaraStatus } from '../../../../lib/api';
import { InaraForm } from './inara-form';
import {
  PageHeader,
  PageBody,
  Panel,
  Section,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export const metadata: Metadata = {
  title: "Commander — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function CommanderPage() {
  const status = await getInaraStatus();

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="COMMANDER"
        lead="Link your Inara account and we can confirm which commander is yours, rather than taking your word for it. Your Discord nickname is then kept matching your in-game name."
      />

      {status === null ? (
        <CouldNotLoad what="your commander details" />
      ) : (
        <PageBody
          rail={
            <>
              <Panel title="Status">
                <RailStat
                  label="Commander"
                  value={status.cmdrName ?? 'Not verified'}
                  tone={status.cmdrName === null ? 'default' : 'good'}
                />
                <RailStat label="Inara key" value={status.linked ? 'Linked' : 'None'} />
                <RailStat
                  label="Verified"
                  value={
                    status.verifiedAt === null
                      ? 'No'
                      : new Date(status.verifiedAt).toLocaleDateString()
                  }
                />
              </Panel>

              {/*
                In the rail, where it is read BEFORE somebody pastes a key —
                not surfaced after a failure that was never their fault. Inara
                refuses every call from an unregistered application, and our
                registration is still outstanding.
              */}
              <Panel title="Not available yet" tone="warning">
                <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                  Inara requires our application to be registered before it will answer any key, and
                  that request is still outstanding. Ask an officer to verify you for now — it works
                  just as well.
                </p>
              </Panel>

              <Panel title="What Inara is for">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  Two things only: confirming your commander name, and checking you are in
                  Grim&rsquo;s Squad. Ranks, ships, loadouts and activity come from the{' '}
                  <a href="/companion" className="text-[var(--color-brand-cyan-bright)]">
                    companion app
                  </a>
                  , which reads the game&rsquo;s own journals and carries far more than Inara has.
                </p>
              </Panel>
            </>
          }
        >
          <p className="max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Entirely optional. Without a key an officer verifies you by hand instead — it works just
            as well, it simply needs a person. Adding a key later upgrades you without anyone else
            being involved.
          </p>

          <div className="mt-6">
            <InaraForm initial={status} />
          </div>

          <div className="mt-14">
            <Section title="What we do with it">
              <ul className="space-y-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                <li>
                  We ask Inara which commander the key belongs to. That answer is what verifies you —
                  you never type your own commander name here.
                </li>
                <li>
                  The key is encrypted before it is stored and is never shown again, to you or to
                  anyone else.
                </li>
                <li>
                  Removing the key does not un-verify you. You proved it once; taking the key back is
                  about us not calling Inara on your behalf any more.
                </li>
              </ul>
            </Section>
          </div>
        </PageBody>
      )}
    </>
  );
}
