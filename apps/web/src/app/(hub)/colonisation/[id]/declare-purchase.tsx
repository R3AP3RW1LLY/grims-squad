'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '../../../../lib/api-client';
import { SystemPicker } from '../../../../components/system-picker';

/**
 * Telling the squadron where you found something.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "a way to declare what station a commander purchased various materials from ... so that all
 * materials that have been found and delivered can be easily procurred without having to go hunt
 * them down"
 *
 * ★ WHY THIS EXISTS WHEN THE JOURNAL ALREADY WATCHES ★
 *
 * The automatic half covers the twelve members running the app with trade telemetry on. This covers
 * the other seven, everything bought before the app was installed, and the one thing no journal can
 * ever say: "there is thirty thousand tonnes sitting here RIGHT NOW". A purchase is proof somebody
 * took some away; a declaration is a claim about what is still there, which is the more useful
 * statement and the only one a person can make.
 *
 * It is also the only way to say a listing is GONE — re-declare at zero, and the hand beats the
 * journal, exactly as it does for carrier holds.
 *
 * ★ THE SYSTEM IS A PICKER, NOT A TEXT BOX ★
 *
 * Station names repeat across the galaxy and system names are procedurally generated. A typo here
 * produces a catalogue entry that sends somebody to the wrong side of the bubble, so the system
 * comes from the same picker the rest of the site uses, with its pins and recents.
 */
export function DeclarePurchase({ projectId }: { projectId: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [commodity, setCommodity] = useState('');
  const [stationName, setStationName] = useState('');
  const [stationSystem, setStationSystem] = useState('');
  const [tonnes, setTonnes] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const FIELD =
    'rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
    'px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ' +
    'focus:border-[var(--color-border-subtle)]';

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const num = (v: string): number | undefined => {
        const n = Number(v.replace(/[, ]/g, ''));
        return v.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : Math.trunc(n);
      };

      await apiPost(`/v1/logistics/colony/projects/${encodeURIComponent(projectId)}/purchases`, {
        commodity,
        stationName,
        stationSystem,
        ...(num(tonnes) === undefined ? {} : { tonnes: num(tonnes) }),
        ...(num(price) === undefined ? {} : { price: num(price) }),
        ...(note.trim() === '' ? {} : { note }),
      });

      setError(null);
      setCommodity('');
      setStationName('');
      setTonnes('');
      setPrice('');
      setNote('');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--color-border-hairline)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-subtle)]"
      >
        Add a station you bought from
      </button>
    );
  }

  const ready = commodity.trim() !== '' && stationName.trim() !== '' && stationSystem.trim() !== '';

  return (
    <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3">
      <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
        Anyone building in this system will see it. Leave the tonnage out if you did not check —
        &ldquo;it is here&rdquo; is still worth saying.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className={FIELD}
          placeholder="Commodity — Steel"
          value={commodity}
          onChange={(e) => setCommodity(e.currentTarget.value)}
          aria-label="Commodity"
        />
        <input
          className={FIELD}
          placeholder="Station — Armstrong Legacy"
          value={stationName}
          onChange={(e) => setStationName(e.currentTarget.value)}
          aria-label="Station name"
        />
        <div className="sm:col-span-2">
          {/* Picked, not typed: a mistyped system is a catalogue entry that sends somebody to the
              wrong side of the bubble. */}
          <SystemPicker
            name="stationSystem"
            value={stationSystem}
            onValueChange={setStationSystem}
            placeholder="System the station is in"
          />
        </div>
        <input
          className={FIELD}
          placeholder="Tonnes seen (optional)"
          inputMode="numeric"
          value={tonnes}
          onChange={(e) => setTonnes(e.currentTarget.value)}
          aria-label="Tonnes"
        />
        <input
          className={FIELD}
          placeholder="Credits per tonne (optional)"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.currentTarget.value)}
          aria-label="Price per tonne"
        />
        <input
          className={`${FIELD} sm:col-span-2`}
          placeholder="Anything the next person should know (optional)"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          aria-label="Note"
        />
      </div>

      {error === null ? null : (
        <p className="m-0 mt-2 text-sm text-[var(--color-semantic-warning)]">{error}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => void submit()}
          className="rounded-md border border-[var(--color-border-hairline)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] disabled:opacity-50 hover:border-[var(--color-border-subtle)]"
        >
          {busy ? 'Saving…' : 'Add it'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-sm text-[var(--color-text-secondary)] hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
