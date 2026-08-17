'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { CALLSIGN_LENGTH, formatCallsign } from '@grims/shared/carrier';
import type { AttachedCarrier, CarrierMatch, ColonyNeed } from '../../../../lib/api';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../../lib/api-client';
import { CodeInput } from '../../../../components/code-input';
import { CopySystem } from '../../../../components/copy-system';

/**
 * Fleet carriers helping with a build.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we also need a way to add fleet carriers to the project like raven colonial does", and
 * "squadron carriers too".
 *
 * ★ WHAT IS IN A HOLD CHANGES WHAT "REMAINING" MEANS ★
 *
 * Twenty thousand tonnes sitting on a carrier parked at the site is not the same build as twenty
 * thousand tonnes nobody has bought yet. So each commodity shows what the attached carriers are
 * already holding against what the site still wants — the one number that answers "do we need
 * another shopping trip".
 *
 * ★ AND THE READING HAS AN AGE ★
 *
 * A carrier is the one station that can be somewhere else tomorrow, so a six-month-old reading of
 * its hold is worth far less than a six-month-old reading of a starport's. The date is on every
 * row rather than implied.
 */

const CHIP =
  'rounded border border-[var(--color-border-hairline)] px-2 py-0.5 font-mono text-[10px] ' +
  'text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] ' +
  'hover:text-[var(--color-text-primary)] disabled:opacity-30';

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] ' +
  'px-3 py-1.5 text-sm text-[var(--color-text-primary)]';

function seenAgo(at: string | null): { text: string; stale: boolean } {
  if (at === null) return { text: 'never seen', stale: true };
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  const text =
    days <= 0
      ? 'seen today'
      : days === 1
        ? 'seen yesterday'
        : days < 30
          ? `seen ${days}d ago`
          : days < 365
            ? `seen ${Math.floor(days / 30)}mo ago`
            : `seen ${Math.floor(days / 365)}y ago`;
  return { text, stale: days > 30 };
}

export function Carriers({
  projectId,
  carriers,
  needs,
  carrierCover,
  canManage,
  isCrew,
}: {
  projectId: string;
  carriers: readonly AttachedCarrier[];
  needs: readonly ColonyNeed[];
  /** The server's effective cover per commodity — manual beats journal beats mirror. */
  carrierCover: Readonly<Record<string, number>>;
  canManage: boolean;
  /** Declaring a hold is crew work; the pen is drawn only for members on the roster. */
  isCrew: boolean;
}) {
  const router = useRouter();
  /** What is in the boxes. Six characters, no dash — the dash is drawn, never stored. */
  const [callsign, setCallsign] = useState('');
  const [matches, setMatches] = useState<readonly CarrierMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/v1/logistics/colony/projects/${encodeURIComponent(projectId)}/carriers`;

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      setMatches(null);
      setCallsign('');
      router.refresh();
    } catch (err) {
      // The hub's own sentence. "Nobody has reported that carrier's market yet" tells somebody what
      // to do next; "something went wrong" does not.
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * Stable across renders, because `CodeInput` fires this from an effect keyed on it. An identity
   * that changed every render would re-run that effect constantly — harmless today only because
   * `decideSubmit` refuses to send the same code twice, and not something to lean on.
   */
  const look = useCallback(
    async (q: string): Promise<void> => {
      setBusy(true);
      try {
        const found = await apiGet<{ carriers: CarrierMatch[] }>(
          `${base}?q=${encodeURIComponent(q)}`,
        );
        setMatches(found.carriers);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
    },
    [base],
  );

  /*
   * ★ THE SERVER'S EFFECTIVE COVER, NOT A CLIENT RE-DERIVATION ★
   *
   * This used to sum the mirror holds locally, which was two of three sources short: the mirror
   * sees only sell orders, and the declared rows (journal + manual) are exactly the cargo that is
   * not on sale. The merge rule — manual beats journal beats mirror — lives with the shopping
   * maths on the server, and this headline must agree with the shopping list to the tonne.
   */
  const outstanding = needs.filter((n) => n.remaining > 0);
  const totalCovered = outstanding.reduce(
    (sum, n) => sum + Math.min(n.remaining, Math.max(0, carrierCover[n.commodity] ?? 0)),
    0,
  );
  const totalRemaining = outstanding.reduce((sum, n) => sum + n.remaining, 0);

  return (
    <div>
      {error === null ? null : (
        <p className="m-0 mb-4 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}

      {carriers.length === 0 ? (
        <p className="m-0 mb-4 text-sm text-[var(--color-text-secondary)]">
          No carriers on this build yet. Anything a squadron carrier is already holding counts
          towards what is still needed.
        </p>
      ) : (
        <>
          <p className="m-0 mb-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
            {totalCovered.toLocaleString()} t of the {totalRemaining.toLocaleString()} t still
            wanted is already in a hold.
          </p>

          <ul className="m-0 mb-5 list-none space-y-2 p-0">
            {carriers.map((c) => {
              const age = seenAgo(c.seenAt);
              return (
                <li
                  key={c.marketId}
                  className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm text-[var(--color-text-primary)]">
                      {c.name}
                      {c.isSquadron ? (
                        <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-brand-orange)]">
                          squadron
                        </span>
                      ) : null}
                      <span className="ml-2 flex-wrap text-[11px] text-[var(--color-text-secondary)]">
                        {c.systemName ?? 'somewhere we have not seen'}
                      </span>
                      {c.systemName === null ? null : (
                        <CopySystem system={c.systemName} size="small" />
                      )}
                      <span
                        className={
                          age.stale
                            ? 'ml-1.5 font-mono text-[10px] text-[var(--color-semantic-warning)]'
                            : 'ml-1.5 font-mono text-[10px] text-[var(--color-text-dim)]'
                        }
                        title={
                          age.stale
                            ? 'Nobody has reported this carrier’s market recently. It may be somewhere else, and its hold may be empty.'
                            : undefined
                        }
                      >
                        {age.text}
                      </span>
                    </span>

                    <span className="flex items-center gap-3">
                      {/*
                        ★ THE RUN THIS CARRIER IS ACTUALLY ON — SQUADRON OWNER, 2026-08-09 ★

                        A carrier is rarely serving one build. This page can only ever answer "what
                        is aboard for THIS one", and adding that answer up across the builds it
                        serves double-counts the hold — the cargo can only be delivered once.

                        So the combined view is one click from here rather than something a member
                        has to know exists.
                      */}
                      <Link
                        href={`/colonisation/carriers/${encodeURIComponent(c.marketId)}`}
                        className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-brand-orange)] no-underline hover:underline"
                      >
                        Combined run
                      </Link>
                      <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                        {c.totalTonnes.toLocaleString()} t towards this build
                        {/*
                          ★ THE GAP, SAID OUT LOUD — SQUADRON OWNER, 2026-08-05 ★

                          "carrier hold info is not updating properly ... we need this to be way
                          more accurate than it is currently"

                          What we hold is a WITNESS statement: the commodities somebody's app
                          watched move, which in production was one. Printed alone it reads as the
                          whole manifest. `CarrierStats` gives the game's own total, so the line can
                          say how much of the hold nobody has seen instead of implying there is
                          none — and a member reading "of 12,400 t aboard" knows to open carrier
                          management if the rest matters.

                          Shown only when the total is BIGGER than what we watched. Equal means we
                          have seen it all, and "500 of 500" is noise.
                        */}
                        {c.wholeHoldTonnes !== null && c.wholeHoldTonnes > c.totalTonnes ? (
                          <span className="opacity-70">
                            {' '}
                            · of {c.wholeHoldTonnes.toLocaleString()} t aboard
                          </span>
                        ) : null}
                      </span>
                      {canManage || c.addedBy !== null ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={CHIP}
                          onClick={() => void act(() => apiDelete(`${base}/${c.marketId}`))}
                        >
                          Take off
                        </button>
                      ) : null}
                    </span>
                  </div>

                  {c.holds.length === 0 ? (
                    <p className="m-0 mt-1 text-[11px] text-[var(--color-text-dim)]">
                      {/* Distinguished on purpose. "Holding nothing this build wants" is a fact; "we
                          have never seen its market" is our own gap, and they read identically if
                          both render as an empty row. */}
                      {c.seenAt === null
                        ? 'Nobody has reported its market, so we cannot say what is aboard.'
                        : 'Nothing on its market that this build still wants.'}
                    </p>
                  ) : (
                    <ul className="m-0 mt-2 list-none space-y-0.5 p-0">
                      {c.holds.map((h) => (
                        <li
                          key={h.commodity}
                          className="flex items-baseline justify-between gap-4 text-xs text-[var(--color-text-secondary)]"
                        >
                          <span>{h.commodity}</span>
                          <span className="font-mono tabular-nums">
                            {h.tonnes.toLocaleString()} t
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <DeclaredHold
                    projectId={projectId}
                    carrier={c}
                    needs={needs}
                    isCrew={isCrew}
                    busy={busy}
                    act={act}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/*
        ★ FIND IT BY THE ONE NAME ITS OWNER CANNOT CHANGE — SQUADRON OWNER, 2026-08-04 ★

        "can we update this so the input is by the carrier id eg W8K-W1Y and can we do this in a box
        that looks like our 2FA input box ... auto search on completion please!"

        Two controls, because there are two questions and one box was answering them badly. The
        boxed callsign is "where is MY carrier"; the button underneath is "which carriers could help
        at all", which is the search that gets used most and is why the blank box existed.
      */}
      <div className="mt-2 border-t border-[var(--color-border-hairline)] pt-4">
        <CodeInput
          label="Carrier ID"
          value={callsign}
          onChange={setCallsign}
          onComplete={() => void look(formatCallsign(callsign))}
          disabled={busy}
          length={CALLSIGN_LENGTH}
          charset="alnum"
          groupsOf={3}
        />
        <p className="m-0 mt-2 text-[11px] text-[var(--color-text-secondary)]">
          The six-character ID from the carrier&rsquo;s contacts panel, like W8K-W1Y. The search runs
          the moment the sixth character lands.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            className={CHIP}
            onClick={() => {
              setCallsign('');
              void look('');
            }}
          >
            {busy ? 'Looking…' : 'Show who is carrying most'}
          </button>
          <span className="text-[11px] text-[var(--color-text-dim)]">
            Ranks every carrier we hold a market for by how much of this build&rsquo;s list is aboard.
          </span>
        </div>
      </div>

      {matches === null ? null : matches.length === 0 ? (
        <p className="m-0 mt-3 text-sm text-[var(--color-text-secondary)]">
          {/* Two different facts, and they were one sentence before. A callsign that matched nothing
              is "we have no such carrier"; a blank search that matched nothing is "nobody we can see
              is carrying any of this". Telling somebody the second when they meant the first is how
              a real carrier reads as a typo. */}
          {callsign === ''
            ? 'No carrier we hold a market for is carrying anything this build still wants. A hold can be declared by hand once a carrier is attached.'
            : `We hold no fleet carrier with the ID ${formatCallsign(callsign)}. Check it against the carrier’s contacts panel — a carrier reaches us once somebody has flown near it or docked at it.`}
        </p>
      ) : (
        <ul className="m-0 mt-3 list-none space-y-1 p-0">
          {matches.map((m) => {
            const age = seenAgo(m.seenAt);
            return (
              <li
                key={m.marketId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--color-border-hairline)] py-2 text-sm"
              >
                <span>
                  <span className="text-[var(--color-text-primary)]">{m.name}</span>
                  <span className="ml-2 text-[11px] text-[var(--color-text-secondary)]">
                    {m.systemName} · {age.text}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                    {m.matchingTonnes.toLocaleString()} t across {m.matchingCommodities}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    className={CHIP}
                    onClick={() => void act(() => apiPost(base, { marketId: m.marketId }))}
                  >
                    Add
                  </button>
                  {canManage ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={CHIP}
                      title="Add it and mark it as the squadron’s rather than a member’s own."
                      onClick={() =>
                        void act(() => apiPost(base, { marketId: m.marketId, isSquadron: true }))
                      }
                    >
                      Add as squadron
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The declared hold: what the journals watched and what the crew has typed, per carrier.
 *
 * ★ THREE SOURCES, ONE RULE, SAID ON SCREEN ★
 *
 * The mirror rows above are the carrier's public SELL ORDERS. These rows are the other two
 * sources — the owner's own journal (read-only here, with its age) and the crew's hand (editable).
 * The merge the shopping list reads is: manual beats journal beats mirror, and a manual ZERO is a
 * real statement that retires a stale figure.
 *
 * Crew members only: declaring what is aboard is crew work, and the server refuses anybody else —
 * so the pen is only drawn for the crew, rather than teaching everybody else the page is broken.
 */
function DeclaredHold({
  projectId,
  carrier,
  needs,
  isCrew,
  busy,
  act,
}: {
  projectId: string;
  carrier: AttachedCarrier;
  needs: readonly ColonyNeed[];
  isCrew: boolean;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState('');
  const [addTonnes, setAddTonnes] = useState('');

  const cargoUrl = `/v1/logistics/colony/projects/${encodeURIComponent(projectId)}/carriers/${encodeURIComponent(carrier.marketId)}/cargo`;

  const save = (commodity: string, tonnes: number | null): void => {
    void act(() => apiPatch(cargoUrl, { commodity, tonnes }));
  };

  /*
   * ★ cAPI ROWS WERE COUNTED AND NEVER SHOWN — 2026-08-17 ★
   *
   * `declared` gained a third source when the carrier poller landed, and this split still asked for
   * exactly two. A Frontier manifest therefore counted towards `carrierCover` — reducing the buy
   * quantity on the shopping list and staging yellow on the needs bars — while rendering nowhere a
   * member could inspect it. Worse, the "Nothing declared yet" fallback could not fire either,
   * because `declared.length` was not zero: the panel drew a heading with silence under it.
   *
   * A figure that changes what somebody buys must be visible where they can check it. Grouped with
   * the journal rows because both are read-only statements by a machine; the difference is that
   * this one is the WHOLE manifest and the journal is a floor, which the badge says out loud.
   */
  /*
   * ★ ONE ROW PER COMMODITY, THE ONE THAT WINS — SQUADRON OWNER, 2026-08-17 ★
   *
   * "its also listing both frontier and journal entries in the Declared hold section ... this should
   * only show the journal entries where possible"
   *
   * Listing both was showing the same cargo twice under two labels, and inviting a member to add
   * them up. Only ONE of them is ever counted: the merge rule takes whichever spoke most recently,
   * with the journal winning ties — so the panel now shows exactly that one.
   *
   * Frontier's row appears only where the journal has nothing to say, which is precisely the case it
   * exists for: a member on a cloud platform, or cargo loaded before the app was running.
   */
  const machine = (() => {
    const byCommodity = new Map<string, (typeof carrier.declared)[number]>();
    for (const d of carrier.declared) {
      if (d.source === 'manual') continue;
      const held = byCommodity.get(d.commodity);
      if (held === undefined) {
        byCommodity.set(d.commodity, d);
        continue;
      }
      // Journal takes ties, matching the merge rule the shopping maths uses.
      // `updatedAt` arrives as an ISO string over the wire; `new Date` handles both shapes.
      const heldAt = new Date(held.updatedAt).getTime();
      const thisAt = new Date(d.updatedAt).getTime();
      if (thisAt > heldAt || (thisAt === heldAt && d.source === 'journal')) {
        byCommodity.set(d.commodity, d);
      }
    }
    return [...byCommodity.values()];
  })();

  const journal = machine;
  const manual = carrier.declared.filter((d) => d.source === 'manual');
  const manualNames = new Set(manual.map((d) => d.commodity));

  // What the add-control offers: the build's outstanding commodities not already declared by hand.
  const addable = needs
    .filter((n) => n.remaining > 0 && !manualNames.has(n.commodity))
    .map((n) => n.commodity);

  if (!isCrew && carrier.declared.length === 0) return null;

  return (
    <div className="mt-3 border-t border-[var(--color-border-hairline)] pt-2">
      <p className="m-0 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
        Declared hold
      </p>

      {carrier.declared.length === 0 ? (
        <p className="m-0 mt-1 text-[11px] text-[var(--color-text-dim)]">
          Nothing declared yet. The owner&rsquo;s companion app fills this as it watches cargo move;
          anything it missed can be typed in below.
        </p>
      ) : (
        <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
          {journal.map((d) => {
            const age = seenAgo(d.updatedAt);
            const overridden = manualNames.has(d.commodity);
            return (
              <li
                key={`journal-${d.commodity}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-secondary)]"
              >
                <span>
                  {d.commodity}
                    <span
                    className={
                      d.source === 'capi'
                        ? 'ml-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-brand-cyan-bright)]'
                        : 'ml-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]'
                    }
                    title={
                      d.source === 'capi'
                        ? 'Frontier’s own manifest for this carrier — the whole hold, not just what an app watched.'
                        : 'What the owner’s app watched move. A floor: it misses whatever moved while the app was closed.'
                    }
                  >
                    {d.source === 'capi' ? 'frontier' : 'journal'}
                  </span>
                  <span
                    className={
                      age.stale
                        ? 'ml-1.5 font-mono text-[10px] text-[var(--color-semantic-warning)]'
                        : 'ml-1.5 font-mono text-[10px] text-[var(--color-text-dim)]'
                    }
                  >
                    {age.text}
                  </span>
                  {overridden ? (
                    <span
                      className="ml-1.5 font-mono text-[10px] text-[var(--color-text-dim)]"
                      title="A crew member's figure below outranks this one."
                    >
                      overridden
                    </span>
                  ) : null}
                </span>
                {/* Read-only on purpose: this line is the owner's app reporting what it watched,
                    and nobody else's to edit. The correction path is a manual figure below. */}
                <span className={`font-mono tabular-nums ${overridden ? 'line-through opacity-50' : ''}`}>
                  {d.tonnes.toLocaleString()} t
                </span>
              </li>
            );
          })}

          {manual.map((d) => (
            <li
              key={`manual-${d.commodity}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-secondary)]"
            >
              <span>
                {d.commodity}
                <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-brand-orange)]">
                  by hand
                </span>
                {d.updatedBy === null ? null : (
                  <span className="ml-1.5 font-mono text-[10px] text-[var(--color-text-dim)]">
                    {d.updatedBy} · {seenAgo(d.updatedAt).text}
                  </span>
                )}
              </span>
              {isCrew ? (
                <span className="flex items-center gap-1.5">
                  <input
                    value={drafts[d.commodity] ?? String(d.tonnes)}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [d.commodity]: e.target.value }))
                    }
                    inputMode="numeric"
                    aria-label={`Tonnes of ${d.commodity} aboard ${carrier.name}`}
                    className={`${FIELD} w-24 py-1 text-right font-mono tabular-nums`}
                  />
                  <button
                    type="button"
                    disabled={busy || !/^\d+$/.test((drafts[d.commodity] ?? String(d.tonnes)).trim())}
                    className={CHIP}
                    onClick={() => save(d.commodity, Number((drafts[d.commodity] ?? String(d.tonnes)).trim()))}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={CHIP}
                    title="Remove the hand-typed figure. The journal and market readings stand again."
                    onClick={() => save(d.commodity, null)}
                  >
                    Clear
                  </button>
                </span>
              ) : (
                <span className="font-mono tabular-nums">{d.tonnes.toLocaleString()} t</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isCrew ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <select
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            aria-label={`Declare a commodity aboard ${carrier.name}`}
            className={`${FIELD} max-w-[220px] py-1`}
          >
            <option value="">declare a commodity…</option>
            {addable.map((commodity) => (
              <option key={commodity} value={commodity}>
                {commodity}
              </option>
            ))}
          </select>
          <input
            value={addTonnes}
            onChange={(e) => setAddTonnes(e.target.value)}
            inputMode="numeric"
            placeholder="tonnes"
            aria-label="Tonnes aboard"
            className={`${FIELD} w-24 py-1 text-right font-mono tabular-nums`}
          />
          <button
            type="button"
            disabled={busy || adding === '' || !/^\d+$/.test(addTonnes.trim())}
            className={CHIP}
            onClick={() => {
              save(adding, Number(addTonnes.trim()));
              setAdding('');
              setAddTonnes('');
            }}
          >
            Declare
          </button>
          <span className="text-[10px] text-[var(--color-text-dim)]">
            zero is a real figure — it says the hold has none
          </span>
        </div>
      ) : carrier.declared.length > 0 ? (
        <p className="m-0 mt-1.5 text-[10px] text-[var(--color-text-dim)]">
          Join the build&rsquo;s crew to declare or correct these figures.
        </p>
      ) : null}
    </div>
  );
}
