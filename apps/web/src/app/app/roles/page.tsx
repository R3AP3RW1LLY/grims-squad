import type { Metadata } from 'next';
import { getAdminRoles, getAdminMappings } from '../../../lib/api';
import { RoleEditor } from './role-editor';
import { MappingEditor } from './mapping-editor';
import { StepUp } from '../step-up';

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

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
        Squadron leadership
      </p>
      <h1
        className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight text-[var(--color-brand-orange)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        ROLES &amp; PERMISSIONS
      </h1>
      <div className="rule-glow mt-5" aria-hidden="true" />

      <section aria-labelledby="roles-heading" className="mt-10">
        <h2 id="roles-heading" className="sr-only">
          Role permissions
        </h2>
        <p className="max-w-[70ch] text-sm text-[var(--color-text-muted)]">
          Every change has to be previewed before it can be saved. A permission mask is a 70-bit
          number and nobody can read one — the preview lists exactly which members gain and lose
          what, by name, before anything is written.
        </p>
        <RoleEditor roles={roles.roles} />
      </section>

      <section aria-labelledby="mappings-heading" className="mt-20">
        <h2
          id="mappings-heading"
          className="text-xl text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          DISCORD ROLE MAPPINGS
        </h2>
        <p className="mt-3 max-w-[70ch] text-sm text-[var(--color-text-muted)]">
          This is the only place Discord role IDs enter the system. They live in data rather than in
          code, so a role deleted and recreated in Discord can be fixed here rather than by a
          deploy.
        </p>
        <MappingEditor roles={roles.roles} mappings={mappings?.mappings ?? []} />
      </section>
    </main>
  );
}
