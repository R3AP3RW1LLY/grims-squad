import { NoSaveImage } from './no-save-image';

/**
 * The screen a squadron page wears before it exists.
 *
 * ★ WHY THESE PAGES NEEDED ANYTHING AT ALL ★
 *
 * `/ops`, `/bgs` and `/fleet` have been in the sidebar since the navigation was
 * written, and none of them had a route. Clicking one gave a raw 404 — the
 * generic "this page could not be found", with no shell, no branding and no
 * indication of whether the squadron hub was broken or simply unfinished.
 *
 * An unfinished feature is a perfectly respectable thing for a page to say. A
 * 404 says something else entirely, and says it badly.
 *
 * ★ THE PAGE OWNS THE HEADER, THIS OWNS THE BODY ★
 *
 * The first version rendered its own centred title and no `PageHeader`, and a
 * test caught it: `hub-page.spec.tsx` holds every rendering hub page to the
 * shared header. The test was right and the design was wrong — "keep the brand
 * and theme the same as the rest of the website" IS that header: the eyebrow,
 * the display-font title in squadron orange, and the glow rule beneath.
 *
 * The second version moved `PageHeader` in here, which rendered correctly and
 * still failed — the guard reads each PAGE file, and a page that delegates its
 * header to a component looks identical to one that has no header at all.
 *
 * So the pages render `PageHeader` themselves, exactly as the roster and the
 * admin console do, and this file provides the body and the status chip. Three
 * lines of header per page is a fair price for a page that is visibly the same
 * kind of thing as every other one.
 *
 * ★ THE TONE ★
 *
 * Squadron owner's brief: witty, lightly sarcastic. The joke is always aimed at
 * US — at the thing not being built yet — and never at the member for clicking,
 * or at how the squadron currently manages without it. Somebody who came here
 * looking for the wing board should leave amused at the developers, not feeling
 * silly for having looked.
 *
 * Each page says what it WILL do. Nothing here frames a feature as optional or
 * negotiable, and nothing invents a date — a date on this screen is a date
 * somebody will hold us to, and the honest answer is that it is being built.
 */
export interface ComingSoonCopy {
  /** Small caps above the title, matching every other hub page. */
  readonly eyebrow: string;
  readonly title: string;
  /** The joke. One or two sentences, aimed at us. */
  readonly quip: string;
  /** What the page will actually be for, said plainly. */
  readonly promise: string;
  /** Three things it will hold. Concrete, not a feature list. */
  readonly bullets: readonly string[];
  /** How the squadron does this today, without it. Warm, never mocking. */
  readonly meanwhile: string;
}

/**
 * The status chip, for the header's `action` slot.
 *
 * That slot is where every other hub page puts its tabs, so the one thing a
 * member came here to find out sits exactly where their eye already goes.
 */
export function UnderConstruction() {
  return (
    <span className="inline-flex items-center gap-2 rounded border border-[var(--color-brand-cyan-bright)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
      {/*
        A glyph as well as the words. It reads as an instrument light rather
        than a warning, which is the difference between "being built" and
        "something went wrong".
      */}
      <span aria-hidden="true">◆</span>
      Under construction
    </span>
  );
}

export function ComingSoonBody({ copy }: { copy: ComingSoonCopy }) {
  return (
    <>
      <div className="mx-auto flex max-w-[62ch] flex-col items-center px-4 pb-12 text-center">
        {/*
          ★ THE FULL LOGO, ON THE SQUADRON OWNER'S INSTRUCTION ★

          Rendered through `NoSaveImage`, which takes away right-click, drag and
          long-press saving. Read the comment in that file before assuming that
          makes it un-downloadable — it does not, and cannot.

          `priority` is deliberately off. This is a placeholder page; preloading
          a large logo ahead of the shell's own assets would make the unfinished
          page the fastest thing on the site.

          The intrinsic size is the file's own 1536x1024 so Next can pick a
          sensible source, and `sizes` caps what is actually served — at 320px
          wide there is no reason to ship the full-resolution original.
        */}
        <NoSaveImage
          src="/brand/full-logo.png"
          alt="Grim's Squad"
          width={1536}
          height={1024}
          sizes="(max-width: 640px) 70vw, 280px"
          className="h-auto w-[min(280px,70vw)] select-none"
        />

        <p className="mt-8 text-lg leading-relaxed text-[var(--color-text-primary)]">{copy.quip}</p>

        <p className="mt-4 leading-relaxed text-[var(--color-text-secondary)]">{copy.promise}</p>

        {/*
          What it will hold. Left-aligned inside a centred column, because three
          centred bullets are harder to read than three ragged-right ones and
          this is the part somebody actually scans.
        */}
        <ul className="mt-8 w-full space-y-2.5 border-t border-[var(--color-border-hairline)] pt-8 text-left">
          {copy.bullets.map((line) => (
            <li key={line} className="flex items-start gap-3 text-sm leading-relaxed">
              <span
                aria-hidden="true"
                className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-[var(--color-brand-orange)]"
              />
              <span className="text-[var(--color-text-secondary)]">{line}</span>
            </li>
          ))}
        </ul>

        {/*
          How it is done today. This is the line that stops the page being a
          dead end — somebody who needed the thing now leaves knowing where to
          go.
        */}
        <p className="mt-8 max-w-[54ch] border-t border-[var(--color-border-hairline)] pt-8 text-sm leading-relaxed text-[var(--color-text-dim)]">
          {copy.meanwhile}
        </p>
      </div>
    </>
  );
}
