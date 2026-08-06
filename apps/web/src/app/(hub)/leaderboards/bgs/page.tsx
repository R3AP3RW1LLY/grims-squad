import { PageHeader } from '../../../../components/hub-page';
import { boardHeaderProps, boardMetadata, LeaderboardBoardBody } from '../board-page';

/**
 * The Faction Hands board — the fifth, and the only one whose score depends on an order.
 *
 * A thin route like the other four: the tables, the member's own strip and the tier ladder all
 * live in `board-page.tsx`, and this file exists so the sidebar entry resolves to a literal
 * page.tsx (see the note there on the nav guard).
 */
export const metadata = boardMetadata('bgs');

export const dynamic = 'force-dynamic';

export default function FactionHandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <PageHeader {...boardHeaderProps('bgs')} />
      <LeaderboardBoardBody boardKey="bgs" searchParams={searchParams} />
    </>
  );
}
