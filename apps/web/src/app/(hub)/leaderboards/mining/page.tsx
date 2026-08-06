import { PageHeader } from '../../../../components/hub-page';
import { boardHeaderProps, boardMetadata, LeaderboardBoardBody } from '../board-page';

/**
 * The Deep Core board. A thin route for the same reason the other three are: the tables, the
 * member's own strip and the tier ladder all live in `board-page.tsx`, and this file exists so the
 * sidebar entry resolves to a literal page.tsx (see the note there on the nav guard).
 *
 * Nothing in `board-page.tsx` needed changing to add a fourth board — which is the whole argument
 * for having written it that way, and the reason Deep Core looks and behaves exactly like the
 * boards members already know.
 */
export const metadata = boardMetadata('mining');

export const dynamic = 'force-dynamic';

export default function DeepCorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <PageHeader {...boardHeaderProps('mining')} />
      <LeaderboardBoardBody boardKey="mining" searchParams={searchParams} />
    </>
  );
}
