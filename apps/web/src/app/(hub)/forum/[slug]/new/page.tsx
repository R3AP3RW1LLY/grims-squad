import { notFound } from 'next/navigation';
import { PageHeader, PageBody, Panel } from '../../../../../components/hub-page';
import { getHubThreads } from '../../../../../lib/api';
import { ThreadComposer } from './thread-composer';

/**
 * Starting a thread in a board.
 *
 * ★ `canPost` DECIDES WHETHER THE FORM RENDERS, AND THE SERVER DECIDES AGAIN ★
 *
 * The board read tells us whether the caller may post, so somebody who cannot gets an explanation
 * rather than a form that will refuse them after they have written five paragraphs. That is a
 * courtesy, not a control: `createThread` re-checks the category's `post_perm` and the caller's
 * mute status server-side regardless.
 */

export const dynamic = 'force-dynamic';

export default async function NewThreadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const board = await getHubThreads(slug);

  // Absent, invisible, or the API being unreachable all answer identically (INV-024).
  if (board === null) notFound();

  return (
    <>
      <PageHeader
        eyebrow="FORUM"
        title="New thread"
        subtitle={`in ${board.category.name}`}
        action={
          <a
            href={`/forum/${slug}`}
            className="font-mono text-xs tracking-[0.2em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            &larr; BOARD
          </a>
        }
      />

      <PageBody>
        {board.category.canPost ? (
          <ThreadComposer categorySlug={slug} />
        ) : (
          <Panel tone="warning">
            <p className="text-[var(--color-text-primary)]">
              You can read this board but not post in it.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {/*
                Names the likely reason rather than leaving somebody to guess. The guides board is
                the one most people will hit this on, and "ask an officer" is a better next step
                than staring at a refusal.
              */}
              Some boards are written by officers only. If you think you should be able to post
              here, ask an officer.
            </p>
          </Panel>
        )}
      </PageBody>
    </>
  );
}
