import type { Metadata } from 'next';
import { getAdminRoles, getAdminMappings } from '../../../../lib/api';
import { RoleEditor } from './role-editor';
import { MappingEditor } from './mapping-editor';
import { groupRoles } from './role-groups';
import { StepUp } from '../step-up';
import { PageHeader, Section, StatGrid, StatTile } from '../../../../components/hub-page';
import { PageTabs, resolveTab, type PageTab } from '../../../../components/page-tabs';

export const metadata: Metadata = {
  title: "Roles — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * ★ PERMISSIONS FIRST, AND IT IS THE DEFAULT ★
 *
 * Both editors used to be stacked on one page, which meant scrolling past the
 * mapping form every time to reach the thing people actually come here for.
 * They are separate concerns anyway: one answers "what may this role do", the
 * other "which Discord role grants it", and mixing them made a long page where
 * the consequential half was below the fold.
 */
const TABS: readonly PageTab[] = [
  { key: 'permissions', label: 'Roles & permissions' },
  { key: 'mapping', label: 'Role mapping' },
];

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = resolveTab(TABS, params['tab']);

  const [roles, mappings] = await Promise.all([getAdminRoles(), getAdminMappings()]);
  // Null means the API refused — which for these routes is the two-factor gate,
  // not a fault. A locked door should look like a locked door.
  if (roles === null) return <StepUp />;

  const groups = groupRoles(roles.roles);
  const rows = mappings?.mappings ?? [];
  const mapped = new Set(rows.map((m) => m.roleId)).size;

  /*
   * A mapping whose Discord role is not in the guild catalogue. Either it was
   * DELETED in Discord or the bot's sync has not run — and either way that
   * mapping now grants nobody anything, silently. Worth a number on the page.
   */
  const orphaned = rows.filter((m) => m.discordName === null).length;

  return (
    <>
      <PageHeader
        eyebrow="Squadron leadership"
        title="ROLES & PERMISSIONS"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <PageTabs tabs={TABS} current={tab} basePath="/app/roles" />
            <a
              href="/app"
              className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]"
            >
              Back to console
            </a>
          </div>
        }
      />

      <StatGrid>
        <StatTile label="Roles" value={String(roles.roles.length)} hint="Every one is editable" />
        <StatTile
          label="Admin ranks"
          value={String(groups.find((g) => g.key === 'leadership')?.roles.length ?? 0)}
          hint="Leadership appointments"
        />
        <StatTile
          label="General ranks"
          value={String(groups.find((g) => g.key === 'ranks')?.roles.length ?? 0)}
          hint="The promotion ladder"
        />
        <StatTile
          label="Mapped to Discord"
          value={String(mapped)}
          hint={
            orphaned > 0
              ? `${orphaned} point at a role Discord no longer has`
              : mapped === 0
                ? 'Nothing reconciles yet'
                : 'Reconciled nightly'
          }
          tone={orphaned > 0 || mapped === 0 ? 'warn' : 'default'}
        />
      </StatGrid>

      {tab === 'permissions' ? (
        /*
          Full width and not sat beside anything.

          The preview lists every member gaining and losing a permission, BY
          NAME, and that list needs room to be read carefully. Halving its width
          to fill the page would make the most consequential screen in the
          console the hardest one to read.
        */
        <Section
          title="Role permissions"
          description="Every change has to be previewed before it can be saved. A permission mask is a 70-bit number and nobody can read one — the preview lists exactly which members gain and lose what, by name, before anything is written."
        >
          <RoleEditor groups={groups} />
        </Section>
      ) : (
        <Section
          title="Discord role mappings"
          description="Which Discord role grants which platform role. This is the only place Discord role IDs enter the system — they live in data rather than in code, so a role deleted and recreated in Discord can be fixed here rather than by a deploy."
        >
          <MappingEditor roles={roles.roles} mappings={rows} />
        </Section>
      )}
    </>
  );
}
