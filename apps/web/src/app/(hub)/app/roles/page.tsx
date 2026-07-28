import type { Metadata } from 'next';
import { getAdminRoles, getAdminMappings } from '../../../../lib/api';
import { RoleEditor } from './role-editor';
import { MappingEditor } from './mapping-editor';
import { StepUp } from '../step-up';
import { PageHeader, Section, StatGrid, StatTile } from '../../../../components/hub-page';

export const metadata: Metadata = {
  title: "Roles — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const [roles, mappings] = await Promise.all([getAdminRoles(), getAdminMappings()]);
  // Null means the API refused — which for these routes is the two-factor gate,
  // not a fault. A locked door should look like a locked door.
  if (roles === null) return <StepUp />;

  const hierarchical = roles.roles.filter((r) => r.isHierarchical).length;
  const mapped = new Set((mappings?.mappings ?? []).map((m) => m.roleId)).size;

  return (
    <>
      <PageHeader
        eyebrow="Squadron leadership"
        title="ROLES & PERMISSIONS"
        action={
          <a
            href="/app"
            className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]"
          >
            Back to console
          </a>
        }
      />

      <StatGrid>
        <StatTile label="Roles" value={String(roles.roles.length)} hint="Defined on the platform" />
        <StatTile label="Rank roles" value={String(hierarchical)} hint="The promotion ladder" />
        <StatTile
          label="Mapped to Discord"
          value={String(mapped)}
          hint={mapped === 0 ? 'Nothing reconciles yet' : 'Reconciled nightly'}
          tone={mapped === 0 ? 'warn' : 'default'}
        />
        <StatTile
          label="Unmapped"
          value={String(roles.roles.length - mapped)}
          hint="Granted here only"
        />
      </StatGrid>

      {/*
        Both editors are full width and stacked rather than sat side by side.

        They look like a natural pair, and putting them in two columns was the
        first thing I tried. It is wrong: the role editor's PREVIEW lists every
        member gaining and losing a permission, by name, and that list needs
        room to be read carefully. Halving its width to fill the page would make
        the most consequential screen in the console the hardest one to read.
      */}
      <Section
        title="Role permissions"
        description="Every change has to be previewed before it can be saved. A permission mask is a 70-bit number and nobody can read one — the preview lists exactly which members gain and lose what, by name, before anything is written."
      >
        <RoleEditor roles={roles.roles} />
      </Section>

      <Section
        title="Discord role mappings"
        description="This is the only place Discord role IDs enter the system. They live in data rather than in code, so a role deleted and recreated in Discord can be fixed here rather than by a deploy."
      >
        <MappingEditor roles={roles.roles} mappings={mappings?.mappings ?? []} />
      </Section>
    </>
  );
}
