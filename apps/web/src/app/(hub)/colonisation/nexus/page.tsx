import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyBlocs, type ColonyBloc } from '../../../../lib/api';
import { NewBloc } from './new-bloc';

/**
 * Groups of our own systems, and what they can feed each other.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "we need a way to allow members who have multiple systems in their colonization to create a nexus
 * that will predict trade routes, and work like the raven colonial nexus system please."
 *
 * ★ WHAT THIS ANSWERS THAT NO SYSTEM PAGE CAN ★
 *
 * Every other colonisation page looks at one system. This one looks across several and asks the
 * question a member cannot answer by opening each in turn: of everything these systems will want,
 * what does NOTHING here produce? That is a permanent haul from outside the group, long after
 * construction is finished — and it is worth knowing before committing a fortnight to it.
 */
export const metadata: Metadata = {
  title: "Nexus — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function BlocCard({ bloc }: { bloc: ColonyBloc }) {
  return (
    <Link
      href={`/colonisation/nexus/${bloc.id}`}
      className="block rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4 transition hover:border-[var(--color-brand-cyan-bright)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">{bloc.name}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          {bloc.owner === 'squadron'
            ? 'Squadron'
            : bloc.visibility === 'squadron'
              ? 'Shared'
              : 'Private'}
        </span>
      </div>

      {bloc.note === null ? null : (
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{bloc.note}</p>
      )}

      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
        {/*
          A count, and the systems themselves. A group of one cannot feed anything, and saying so
          here saves opening it to find an empty table — which is what a failed load looks like too.
        */}
        {bloc.systems.length === 0
          ? 'No systems in it yet'
          : bloc.systems.length === 1
            ? '1 system — a group needs more than one before anything can feed anything else'
            : `${bloc.systems.length} systems`}
      </p>

      {bloc.systems.length === 0 ? null : (
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-secondary)]">
          {bloc.systems.join(' · ')}
        </p>
      )}

      {bloc.owner === 'personal' && bloc.createdBy !== '' ? (
        <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">by {bloc.createdBy}</p>
      ) : null}
    </Link>
  );
}

export default async function NexusPage() {
  const read = await getColonyBlocs();

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const blocs = read.data.blocs;
  const squadron = blocs.filter((b) => b.owner === 'squadron');
  const mine = blocs.filter((b) => b.owner === 'personal' && b.mayEdit);
  const shared = blocs.filter((b) => b.owner === 'personal' && !b.mayEdit);

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="NEXUS"
        subtitle="What a group of our systems can supply each other"
      />
      <PageBody
        wide
        lead="Group the systems you are building and this works out which of them can feed which — and, more usefully, what nothing in the group produces at all. Where a station is already standing its real market is used; where it is not, the economy model predicts one, and every route says which it is."
      >
        <Section title="Make a group">
          <NewBloc />
        </Section>

        {squadron.length === 0 ? null : (
          <Section title="The squadron's groups">
            <div className="grid gap-3 sm:grid-cols-2">
              {squadron.map((b) => (
                <BlocCard key={b.id} bloc={b} />
              ))}
            </div>
          </Section>
        )}

        {mine.length === 0 ? null : (
          <Section title="Your groups">
            <div className="grid gap-3 sm:grid-cols-2">
              {mine.map((b) => (
                <BlocCard key={b.id} bloc={b} />
              ))}
            </div>
          </Section>
        )}

        {shared.length === 0 ? null : (
          <Section title="Shared with the squadron">
            <div className="grid gap-3 sm:grid-cols-2">
              {shared.map((b) => (
                <BlocCard key={b.id} bloc={b} />
              ))}
            </div>
          </Section>
        )}

        {blocs.length === 0 ? (
          <Section title="Nothing grouped yet">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {/*
                Said in words rather than left as an empty page. Groups were officer-only until
                2026-08-25, so there were none to find — a member arriving here to a blank screen
                would reasonably assume it was broken.
              */}
              Nobody has grouped any systems yet. Make one above — it is yours alone until you choose
              to share it, and you need two systems in it before there is anything to work out.
            </p>
          </Section>
        ) : null}
      </PageBody>
    </>
  );
}
