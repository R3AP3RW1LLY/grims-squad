'use client';

import { useCallback, useRef, useState } from 'react';
import type { BannerSpec } from '@grims/shared/forum-signature';
import { apiPost } from '../../../../lib/api-client';
import { BannerRender, type BannerIdentity } from '../../../../components/forum/banner-render';

/**
 * Designing a signature with GMSD AI.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "generate signature with GMSD AI which should be a prompt based and Q&A based signature
 * generator ... 5 options to choose from", "let the AI generate images for the backplate", and
 * "make the signatures and the images for the backplates wildly unique to what the end user wants".
 *
 * ★ THE DESIGNS ARRIVE FIRST AND THE ARTWORK CATCHES UP ★
 *
 * A backplate takes about fifty seconds. Five is four minutes, and somebody who presses Generate
 * and sees nothing for four minutes has already decided the feature is broken.
 *
 * So the five designs land in about six seconds on their gradients, and artwork is fetched one at a
 * time behind them, replacing each gradient as it arrives. Every option is choosable from the first
 * paint — nobody is ever waiting for permission to continue.
 *
 * ★ NOTHING IS UPLOADED UNTIL IT IS CHOSEN ★
 *
 * A generated backplate is previewed straight from the bytes, as a data URI handed to
 * `BannerRender`'s own `imageHref` prop. Uploading all five would put four discarded images in the
 * media library on every press of a button people will press repeatedly.
 *
 * The upload happens on Use or Tweak, for the one they picked.
 */

/** How the five options should be backed. The member decides — see the note on BACKPLATE_CHOICES. */
type BackplateChoice = 'artwork' | 'gradient' | 'mix';

/**
 * ★ ARTWORK BY DEFAULT, GRADIENTS WITHOUT A WAIT ★
 *
 * Owner: "some may want gradients". Generated artwork is the impressive path and it costs four
 * minutes of a shared card; a member who wants clean gradients should not pay that to find out
 * they did not want the pictures. So the choice is explicit and artwork is the default.
 */
const BACKPLATE_CHOICES: ReadonlyArray<{ value: BackplateChoice; label: string; note: string }> = [
  { value: 'artwork', label: 'Generated artwork', note: 'A unique image per design. Takes a few minutes to fill in.' },
  { value: 'gradient', label: 'Plain gradients', note: 'Clean colour, ready immediately.' },
  { value: 'mix', label: 'A mix', note: 'Artwork on the first three, gradients on the rest.' },
];

/** How many designs get artwork, for each choice. */
function artworkCount(choice: BackplateChoice, total: number): number {
  if (choice === 'gradient') return 0;
  if (choice === 'mix') return Math.min(3, total);
  return total;
}

interface DesignOption {
  name: string;
  spec: BannerSpec;
  imageryPrompt: string;
  /** The generated backplate, as a data URI, once it has arrived. Preview only. */
  art?: string;
}

const QUESTIONS = [
  {
    key: 'activity' as const,
    label: 'What do you mostly do out there?',
    hint: 'Mining, bounty hunting, exploring, trading, hauling for the squadron…',
    placeholder: 'Deep core mining, mostly void opals',
  },
  {
    key: 'ship' as const,
    label: 'What do you fly?',
    hint: 'The one you would want on a banner.',
    placeholder: 'Krait Mk II',
  },
  {
    key: 'vibe' as const,
    label: 'Any colours or a feel you want?',
    hint: 'Name a colour and every option will use it.',
    placeholder: 'Gold and black, heavy and expensive',
  },
  {
    key: 'prompt' as const,
    label: 'What should the background show?',
    hint: 'A galaxy, a planet surface, a ringed gas giant, your ship over an asteroid field — anything.',
    placeholder: 'My Krait over a green nebula, close to a neutron star',
  },
];

type Answers = Record<(typeof QUESTIONS)[number]['key'], string>;

export function AiDesigner({
  who,
  onUse,
  onTweak,
  onBack,
}: {
  who: BannerIdentity;
  /** Save this design and finish. Given a media id when the design carries artwork. */
  onUse: (spec: BannerSpec) => void | Promise<void>;
  /** Open this design in the builder. */
  onTweak: (spec: BannerSpec) => void;
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Answers>({ activity: '', ship: '', vibe: '', prompt: '' });
  const [backplate, setBackplate] = useState<BackplateChoice>('artwork');
  const [options, setOptions] = useState<DesignOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<number | null>(null);
  /** Bumped on every generate, so a superseded artwork run drops its results. */
  const run = useRef(0);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOptions(null);
    const mine = run.current + 1;
    run.current = mine;

    try {
      const r = await apiPost<{ options: DesignOption[] }>(
        '/v1/forum/signature/design',
        answers,
        'GMSD AI could not design anything just now.',
      );
      setOptions(r.options);
      setBusy(false);

      const wanted = artworkCount(backplate, r.options.length);

      /*
       * ★ ONE AT A TIME, AND ABANDONED IF THEY GENERATE AGAIN ★
       *
       * Sequential because generation is sequential on a single card anyway — five parallel
       * requests would queue on the server and arrive in the same total time, having also held
       * five connections open. The run counter drops a batch nobody is looking at any more.
       */
      for (let i = 0; i < wanted; i += 1) {
        if (run.current !== mine) return;
        setDrawing(i);
        try {
          const art = await apiPost<{ options: Array<{ png: string }> }>('/v1/ai/artwork', {
            prompt: r.options[i]?.imageryPrompt ?? '',
            // One per design. The choosing happened a step ago; this needs a backplate, not a
            // choice of three. See the `count` note on the artwork endpoint.
            count: 1,
          });
          const png = art.options[0]?.png;
          if (png === undefined || run.current !== mine) continue;

          setOptions((prev) =>
            prev === null
              ? prev
              : prev.map((o, j) => (j === i ? { ...o, art: `data:image/png;base64,${png}` } : o)),
          );
        } catch {
          // One backplate failing leaves that option on its gradient, which is still a design.
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    } finally {
      if (run.current === mine) setDrawing(null);
    }
  }, [answers, backplate]);

  /**
   * Turns a chosen option into a spec that will still render tomorrow.
   *
   * The preview draws from a data URI held in memory. A saved banner cannot, so the bytes are
   * uploaded here — for the one design they picked, and only when they pick it.
   */
  const commit = useCallback(async (option: DesignOption): Promise<BannerSpec> => {
    if (option.art === undefined) return option.spec;

    const blob = await (await fetch(option.art)).blob();
    const res = await fetch('/v1/media/uploads', {
      method: 'POST',
      body: blob,
      headers: { 'content-type': 'image/png', 'x-csrf-token': readCsrf() },
      credentials: 'same-origin',
    });
    const json = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok || typeof json.id !== 'string') {
      throw new Error(json.error?.message ?? 'The artwork did not upload.');
    }

    // `dim` matches what the designer uses for an image backplate — text over undimmed artwork is
    // the commonest way a generated banner comes out unreadable.
    return { ...option.spec, background: 'image', imageMediaId: json.id, dim: 45 };
  }, []);

  const choose = useCallback(
    async (index: number, then: 'use' | 'tweak') => {
      const option = options?.[index];
      if (option === undefined) return;
      setChoosing(index);
      setError(null);
      try {
        const spec = await commit(option);
        if (then === 'use') await onUse(spec);
        else onTweak(spec);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setChoosing(null);
      }
    },
    [options, commit, onUse, onTweak],
  );

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        {QUESTIONS.map((q) => (
          <div key={q.key}>
            <label
              htmlFor={`q-${q.key}`}
              className="block font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]"
            >
              {q.label}
            </label>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{q.hint}</p>
            <input
              id={`q-${q.key}`}
              value={answers[q.key]}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.currentTarget.value }))}
              placeholder={q.placeholder}
              maxLength={400}
              disabled={busy}
              className="mt-2 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-4 py-3 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-cyan-bright)] disabled:opacity-50"
            />
          </div>
        ))}

        <fieldset>
          <legend className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            Backplates
          </legend>
          <div className="mt-3 space-y-2">
            {BACKPLATE_CHOICES.map((c) => (
              <label
                key={c.value}
                className="flex cursor-pointer items-start gap-3 rounded border border-[var(--color-border-hairline)] p-3 text-sm"
              >
                <input
                  type="radio"
                  name="backplate"
                  checked={backplate === c.value}
                  onChange={() => setBackplate(c.value)}
                  disabled={busy}
                  className="mt-1"
                />
                <span>
                  <span className="block text-[var(--color-text-primary)]">{c.label}</span>
                  <span className="block text-[var(--color-text-secondary)]">{c.note}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="rounded border border-[var(--color-brand-orange)] bg-[var(--color-brand-orange)]/5 px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="rounded border border-[var(--color-brand-cyan-bright)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {busy ? 'Designing…' : options === null ? 'Design five for me' : 'Try five more'}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-[var(--color-border-hairline)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Build it myself instead
        </button>
      </div>

      {busy && (
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          Reading what you wrote and designing five signatures…
        </p>
      )}

      {options !== null && (
        <div className="space-y-5">
          <p className="text-[var(--color-text-primary)]">
            Five designs. Use one as it is, or open it in the builder and change anything.
            {drawing !== null && (
              <span className="block pt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                Drawing artwork for {drawing + 1} of {artworkCount(backplate, options.length)} — you
                can choose at any time.
              </span>
            )}
          </p>

          {options.map((o, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
                  {o.name}
                </p>
                {drawing === i && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                    Drawing artwork…
                  </p>
                )}
              </div>

              {/*
                The real renderer, fed the real spec — the same component the forum uses, so what
                they choose here is what appears under their posts. The generated artwork rides in
                on `imageHref`, which is how the builder previews an unsaved background too.
              */}
              <div className="mt-3 overflow-hidden rounded">
                <BannerRender
                  spec={o.art === undefined ? o.spec : { ...o.spec, background: 'image', dim: 45 }}
                  who={who}
                  {...(o.art === undefined ? {} : { imageHref: o.art })}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void choose(i, 'use')}
                  disabled={choosing !== null}
                  className="rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] hover:opacity-80 disabled:opacity-40"
                >
                  {choosing === i ? 'Saving…' : 'Use this'}
                </button>
                <button
                  type="button"
                  onClick={() => void choose(i, 'tweak')}
                  disabled={choosing !== null}
                  className="rounded border border-[var(--color-border-hairline)] px-5 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
                >
                  Tweak this
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Reads the CSRF cookie. The name is `gs_csrf`, not `csrf` — see `image-uploader`. */
function readCsrf(): string {
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  return '';
}
