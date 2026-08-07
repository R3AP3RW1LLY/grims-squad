import { PageHeader } from '../../../../components/hub-page';
import { boardHeaderProps, boardMetadata, LeaderboardBoardBody } from '../board-page';

/**
 * The Welcome — who brought people in, and whose recruits stayed.
 *
 * A thin route like the other five: everything is in `board-page.tsx`, and this file exists so the
 * sidebar entry resolves to a literal page.tsx (see the note there on the nav guard).
 */
export const metadata = boardMetadata('recruit');

export const dynamic = 'force-dynamic';

export default function TheWelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <PageHeader {...boardHeaderProps('recruit')} />
      <LeaderboardBoardBody boardKey="recruit" searchParams={searchParams} />
    </>
  );
}
