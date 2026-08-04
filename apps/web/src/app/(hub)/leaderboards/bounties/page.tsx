import { PageHeader } from '../../../../components/hub-page';
import { boardHeaderProps, boardMetadata, LeaderboardBoardBody } from '../board-page';

/**
 * The Data Runners board. A thin route on purpose — the tables, the member's own strip and the
 * tier ladder all live in `board-page.tsx`, shared with the other two boards, and this file
 * exists so the sidebar entry resolves to a literal page.tsx (see the note there on the nav
 * guard). The header renders HERE because every rendering hub page owns its shared PageHeader
 * (hub-page.spec); its props come from one helper so the three boards stay one design.
 */
export const metadata = boardMetadata('bounties');

export const dynamic = 'force-dynamic';

export default function DataRunnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <PageHeader {...boardHeaderProps('bounties')} />
      <LeaderboardBoardBody boardKey="bounties" searchParams={searchParams} />
    </>
  );
}
