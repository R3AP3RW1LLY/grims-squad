'use client';

import { useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../../lib/api-client';
import type { RoadmapArchivedCard, RoadmapCard } from '../../../lib/api';

/**
 * The roadmap's management board — five columns, webmaster only.
 *
 * ★ BUTTONS, NOT DRAG AND DROP ★
 *
 * The colonisation planner's precedent, for the same reasons it states: no drag library, and a
 * drag control works for nobody on a keyboard and badly on a phone. ↑↓ move a card within its
 * column, ←→ move it a column over (landing at the end), and every press sends the same
 * column+position write a drop would.
 *
 * Moves REFETCH rather than reconcile: the server renumbers whole columns transactionally, and
 * mirroring that arithmetic here would be a second copy of it that drifts. One extra GET per
 * press on an admin board is nothing.
 */

const COLUMNS = [
  ['ideas', 'Ideas'],
  ['considering', 'Considering'],
  ['planned', 'Planned'],
  ['building', 'Building'],
  ['shipped', 'Shipped'],
] as const;

type ColumnKey = (typeof COLUMNS)[number][0];

const CHIP =
  'rounded border border-[var(--color-border-hairline)] px-2 py-0.5 font-mono text-[10px] ' +
  'text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] ' +
  'hover:text-[var(--color-text-primary)] disabled:opacity-30';

interface BoardState {
  readonly cards: readonly RoadmapCard[];
  readonly archived: readonly RoadmapArchivedCard[];
}

export function RoadmapBoard({ initial }: { readonly initial: BoardState }) {
  const [board, setBoard] = useState<BoardState>(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = (): Promise<void> =>
    apiGet<{ cards: RoadmapCard[]; archived: RoadmapArchivedCard[] }>('/v1/roadmap/manage')
      .then((r) => setBoard(r))
      .catch(() => {
        // A transient miss keeps the last board; the next act reloads again.
      });

  const act = (run: () => Promise<unknown>): void => {
    setBusy(true);
    setProblem(null);
    run()
      .then(() => reload())
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That did not go through.');
        void reload();
      })
      .finally(() => setBusy(false));
  };

  const move = (card: RoadmapCard, column: ColumnKey, position?: number): void =>
    act(() =>
      apiPatch(`/v1/roadmap/manage/cards/${card.id}/move`, {
        column,
        // Absent means "the end of the column" — the server clamps.
        ...(position === undefined ? {} : { position }),
      }),
    );

  return (
    <div className="space-y-4">
      {problem !== null && (
        <p
          role="alert"
          className="rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {problem}
        </p>
      )}

      {/* The board scrolls sideways as one unit; five columns never fit a laptop honestly. */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[64rem] grid-cols-5 gap-3">
          {COLUMNS.map(([key, label], columnIndex) => {
            const cards = board.cards
              .filter((c) => c.column === key)
              .sort((a, b) => a.position - b.position);

            return (
              <section key={key} className="rounded border border-[var(--color-border-hairline)] p-3">
                <h3 className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  {label}
                  <span className="text-[var(--color-text-dim)]">{cards.length}</span>
                </h3>

                <ol className="mt-3 space-y-2">
                  {cards.map((card, i) => (
                    <li
                      key={card.id}
                      className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-3"
                    >
                      {editingId === card.id ? (
                        <CardEditor
                          card={card}
                          busy={busy}
                          onCancel={() => setEditingId(null)}
                          onSave={(title, body) => {
                            setEditingId(null);
                            act(() =>
                              apiPatch(`/v1/roadmap/manage/cards/${card.id}`, { title, body }),
                            );
                          }}
                        />
                      ) : (
                        <>
                          <p className="text-sm text-[var(--color-text-primary)]">{card.title}</p>
                          {card.body !== null && (
                            <p className="mt-1 text-xs whitespace-pre-wrap text-[var(--color-text-secondary)]">
                              {card.body}
                            </p>
                          )}
                          {card.threadLink !== null && (
                            <a
                              href={card.threadLink}
                              className="mt-1 inline-block text-[11px] text-[var(--color-brand-cyan-bright)] underline-offset-2 hover:underline"
                            >
                              The thread it came from
                            </a>
                          )}
                          <span className="mt-2 flex flex-wrap gap-1">
                            <button type="button" disabled={busy || i === 0} className={CHIP} aria-label={`Move "${card.title}" up`} onClick={() => move(card, key, i - 1)}>
                              ↑
                            </button>
                            <button type="button" disabled={busy || i === cards.length - 1} className={CHIP} aria-label={`Move "${card.title}" down`} onClick={() => move(card, key, i + 1)}>
                              ↓
                            </button>
                            <ColumnHop card={card} to={COLUMNS[columnIndex - 1]} direction="←" busy={busy} onMove={move} />
                            <ColumnHop card={card} to={COLUMNS[columnIndex + 1]} direction="→" busy={busy} onMove={move} />
                            <button type="button" disabled={busy} className={CHIP} onClick={() => setEditingId(card.id)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className={CHIP}
                              onClick={() =>
                                act(() => apiPatch(`/v1/roadmap/manage/cards/${card.id}/archive`))
                              }
                            >
                              Archive
                            </button>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ol>

                <AddCard
                  column={key}
                  busy={busy}
                  onAdd={(title, body) =>
                    act(() => apiPost('/v1/roadmap/manage/cards', { title, body, column: key }))
                  }
                />
              </section>
            );
          })}
        </div>
      </div>

      {board.archived.length > 0 && (
        <section className="rounded border border-[var(--color-border-hairline)] p-4">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Archived
          </h3>
          <ul className="mt-2 space-y-1">
            {board.archived.map((card) => (
              <li key={card.id} className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
                <span className="truncate">{card.title}</span>
                <button
                  type="button"
                  disabled={busy}
                  className={CHIP}
                  onClick={() =>
                    act(() => apiPatch(`/v1/roadmap/manage/cards/${card.id}/restore`))
                  }
                >
                  Put it back
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One sideways hop. At either edge there is no `to`, and the disabled chip still renders so
 *  the four arrows keep their places under the cursor. */
function ColumnHop({
  card,
  to,
  direction,
  busy,
  onMove,
}: {
  card: RoadmapCard;
  to: (typeof COLUMNS)[number] | undefined;
  direction: '←' | '→';
  busy: boolean;
  onMove: (card: RoadmapCard, column: ColumnKey) => void;
}) {
  return (
    <button
      type="button"
      disabled={busy || to === undefined}
      className={CHIP}
      aria-label={to === undefined ? 'No column that way' : `Move "${card.title}" to ${to[1]}`}
      onClick={() => {
        if (to !== undefined) onMove(card, to[0]);
      }}
    >
      {direction}
    </button>
  );
}

function CardEditor({
  card,
  busy,
  onSave,
  onCancel,
}: {
  card: RoadmapCard;
  busy: boolean;
  onSave: (title: string, body: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body ?? '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim().length >= 3 && !busy) onSave(title, body);
      }}
      className="space-y-2"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        maxLength={200}
        aria-label="Card title"
        className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.currentTarget.value)}
        maxLength={2000}
        rows={3}
        aria-label="Card body"
        placeholder="What, and why."
        className="w-full resize-y rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
      />
      <span className="flex gap-1">
        <button type="submit" disabled={busy || title.trim().length < 3} className={CHIP}>
          Save
        </button>
        <button type="button" disabled={busy} className={CHIP} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </form>
  );
}

function AddCard({
  column,
  busy,
  onAdd,
}: {
  column: ColumnKey;
  busy: boolean;
  onAdd: (title: string, body: string) => void;
}) {
  const [openForm, setOpenForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  if (!openForm) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpenForm(true)}
        className="mt-3 w-full rounded border border-dashed border-[var(--color-border-hairline)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
      >
        Add a card
      </button>
    );
  }

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim().length >= 3 && !busy) {
          onAdd(title, body);
          setTitle('');
          setBody('');
          setOpenForm(false);
        }
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        maxLength={200}
        aria-label={`New card in ${column}`}
        placeholder="Title"
        autoFocus
        className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.currentTarget.value)}
        maxLength={2000}
        rows={2}
        aria-label="New card body"
        placeholder="What, and why."
        className="w-full resize-y rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
      />
      <span className="flex gap-1">
        <button type="submit" disabled={busy || title.trim().length < 3} className={CHIP}>
          Add it
        </button>
        <button type="button" disabled={busy} className={CHIP} onClick={() => setOpenForm(false)}>
          Cancel
        </button>
      </span>
    </form>
  );
}
