import type { Metadata } from 'next';
import { TRAINING_TYPES_NOTE } from '@grims/shared';
import { getAiCorpusGated } from '../../../../lib/api';
import { StepUp } from '../../app/step-up';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { TrainStudio } from './train-studio';

export const metadata: Metadata = {
  title: "Help Train the Bot — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Help Train the Bot.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "a new side bar category called GMSD AI ... name it Help Train the Bot ... a category based
 * uploader, a material progression bar that shows how many images are required in the pool to
 * properly train that category and what were at in collecting those images for each category, each
 * image should have a slot for text description."
 *
 * ★ WHY THE BARS COME FIRST AND THE FORM SECOND ★
 *
 * The page has to answer "is this worth my time" before it asks for anything. A member who can see
 * that cockpits are at 4 of 20 knows exactly what to go and photograph; one who sees an upload box
 * first has no idea whether they are helping or adding to a pile of two thousand.
 */
export default async function TrainPage() {
  const read = await getAiCorpusGated();

  if (read.state === 'needs-step-up' || read.state === 'signed-out') return <StepUp />;
  if (read.state === 'forbidden') {
    return <NoAccess what="Help Train the Bot" permission="AI_TRAIN_SUBMIT" />;
  }
  if (read.state === 'unavailable') return <AdminUnavailable />;

  const { categories, mine, canSubmit } = read.data;

  const trainable = categories.filter((c) => c.trainable).length;
  const approved = categories.reduce((n, c) => n + c.approved, 0);

  return (
    <>
      <PageHeader
        eyebrow="GMSD AI"
        title="Help Train the Bot"
        subtitle={`${approved.toLocaleString()} images in the pool · ${trainable} of ${categories.length} categories ready to train`}
      />

      <PageBody
        wide
        lead="GMSD AI learns to draw Elite from screenshots the squadron sends it. What it can draw well is decided entirely by what is in these categories — and by how well each shot is described."
      >
        <Section
          title="What the pool needs"
          description="Each bar fills towards the point where that category can be trained at all. More is better after that, but nothing below the line is usable."
        >
          <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">
            {categories.map((c) => (
              <li
                key={c.key}
                className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[var(--color-text-primary)]">{c.label}</span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                    {c.approved} / {c.min}
                    {c.trainable && (
                      <span className="ml-2 text-[var(--color-semantic-success)]">ready</span>
                    )}
                  </span>
                </div>

                {/*
                  role="progressbar" with the real numbers on it. A bare coloured div is invisible
                  to a screen reader, and this is the one element on the page that carries the
                  whole message.
                */}
                <div
                  role="progressbar"
                  aria-valuenow={c.approved}
                  aria-valuemin={0}
                  aria-valuemax={c.min}
                  aria-label={`${c.label}: ${c.approved} of ${c.min} images`}
                  className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-panel-sunken)]"
                >
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      c.trainable
                        ? 'bg-[var(--color-semantic-success)]'
                        : 'bg-[var(--color-brand-cyan-bright)]'
                    }`}
                    style={{ width: `${Math.round(c.fraction * 100)}%` }}
                  />
                </div>

                <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  {c.guidance}
                </p>

                <p className="mt-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
                  {/*
                    Pending is stated separately and never counted in the bar. A member who sends
                    thirty images should not watch the bar fill and then empty when half are
                    refused — it tracks what is actually usable.
                  */}
                  {c.pending > 0 ? `${c.pending} awaiting review · ` : ''}
                  {c.ideal} would make it reliable
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <TrainStudio categories={categories} mine={mine} canSubmit={canSubmit} note={TRAINING_TYPES_NOTE} />
      </PageBody>
    </>
  );
}
