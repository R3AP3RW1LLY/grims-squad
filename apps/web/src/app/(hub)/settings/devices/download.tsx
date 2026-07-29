import type { ReleaseAsset } from '../../../../lib/api';

/**
 * Downloading the companion app.
 *
 * ★ FROM HERE, NOT FROM GITHUB ★
 *
 * Squadron owner's decision, 2026-07-28. A releases page asks a member to pick
 * the right file out of a list that also holds blockmaps, checksums and source
 * archives, and puts a developer-facing site in the middle of somebody's first
 * five minutes.
 *
 * The build is uploaded to object storage by CI and streamed back through our
 * own API, so the bucket never has to be world-readable and the download is
 * members-only — the app pairs to a squadron account, and there is no reason
 * for it to be passed around outside.
 */

/**
 * Platform marks, drawn inline.
 *
 * ★ SVG PATHS, NOT AN ICON PACKAGE AND NOT AN IMAGE ★
 *
 * A remote image is a request that can fail and a layout that shifts when it
 * does; an icon package is a dependency for three shapes. These are the
 * official marks, simplified, and they inherit `currentColor` so they follow
 * the theme without a second colour to keep in step.
 */
function PlatformIcon({ platform }: { platform: ReleaseAsset['platform'] }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true } as const;

  if (platform === 'windows') {
    // The four-pane flag. Microsoft's own mark since Windows 8.
    return (
      <svg {...common}>
        <path d="M3 5.5 10.2 4.5v6.9H3V5.5Zm0 13 7.2 1v-6.8H3v5.8Zm8.3 1.2L21 21V12.6h-9.7v7.1Zm0-15.4v7.1H21V3l-9.7 1.3Z" />
      </svg>
    );
  }

  if (platform === 'macos') {
    return (
      <svg {...common}>
        <path d="M16.4 12.8c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.5-.2-2.8.8-3.6.8-.7 0-1.9-.8-3.1-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3.1-.7 1.4 0 1.8.7 3.1.7 1.3 0 2.1-1.1 2.9-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.4-1-2.4-3.7ZM14 5.9c.7-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3Z" />
      </svg>
    );
  }

  // Tux, reduced to a silhouette that reads at 22px.
  return (
    <svg {...common}>
      <path d="M12 2c-2.2 0-3.6 1.7-3.6 4.2 0 1.4.2 2.3-.3 3.3-.7 1.4-2.6 3.6-3.2 5.6-.4 1.4.2 2 .9 2 .3 1 1 1.7 2 2 .3.6 1.4 1.9 4.2 1.9s3.9-1.3 4.2-1.9c1-.3 1.7-1 2-2 .7 0 1.3-.6.9-2-.6-2-2.5-4.2-3.2-5.6-.5-1-.3-1.9-.3-3.3C15.6 3.7 14.2 2 12 2Zm-1.4 3.1c.4 0 .8.5.8 1.1s-.4 1.1-.8 1.1-.8-.5-.8-1.1.4-1.1.8-1.1Zm2.8 0c.4 0 .8.5.8 1.1s-.4 1.1-.8 1.1-.8-.5-.8-1.1.4-1.1.8-1.1ZM12 8.3c.9 0 2 .6 2 1 0 .5-1.1 1.3-2 1.3s-2-.8-2-1.3c0-.4 1.1-1 2-1Z" />
    </svg>
  );
}

const PLATFORM: Record<ReleaseAsset['platform'], { label: string; note: string }> = {
  windows: { label: 'Windows', note: 'Windows 10 or 11, 64-bit' },
  macos: {
    label: 'macOS',
    // Not a disclaimer — an explanation. A Mac player who sees "macOS" on a
    // page about an Elite tool reasonably wonders how, given the game has no
    // Mac client, and an unanswered question reads as a mistake.
    note: 'Reads journals from CrossOver or Whisky',
  },
  linux: { label: 'Linux', note: 'AppImage; reads journals from Proton' },
};

/** `104857600` -> `100 MB`. Nobody wants the exact byte count. */
function size(bytes: number): string {
  const mb = bytes / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function CompanionDownload({ assets }: { assets: ReleaseAsset[] }) {
  if (assets.length === 0) {
    /*
     * ★ AN HONEST EMPTY STATE, NOT A DEAD BUTTON ★
     *
     * A "Download" that 404s wastes somebody's time and makes the site look
     * broken. Saying it is not ready sets an expectation instead, and this is
     * the real state whenever nothing has been published — not an error.
     */
    return (
      <p className="rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        No build published yet. It will be announced in Discord when there is one worth installing,
        and it will appear here — you will not need to go anywhere else for it.
      </p>
    );
  }

  // The newest version present. CI keeps exactly one in the bucket, but a
  // failed prune must not put two version numbers on the page.
  const version = assets[0]?.version ?? null;

  return (
    <div>
      {/*
        ★ THE GRID FILLS THE CONTAINER ★

        `sm:grid-cols-3` with one build produced a card a third of the width
        floating in an empty row, which reads as a broken layout rather than as
        one download. `auto-fit` with a minimum instead: one build spans the
        full width, two split it, three sit in a row.
      */}
      <ul
        className="m-0 grid list-none gap-3 p-0"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
      >
        {assets.map((a) => (
          <li key={a.file}>
            <a
              href={`/v1/companion/download/${encodeURIComponent(a.file)}`}
              className="flex h-full flex-col rounded border border-[var(--color-brand-cyan-bright)] p-4 transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_10%,transparent)]"
            >
              <span className="flex items-center gap-2.5 text-[var(--color-brand-cyan-bright)]">
                <PlatformIcon platform={a.platform} />
                <span className="font-mono text-[12px] uppercase tracking-[0.24em]">
                  Download for {PLATFORM[a.platform].label}
                </span>
              </span>
              <span className="mt-2 text-sm text-[var(--color-text-primary)]">
                {PLATFORM[a.platform].note}
              </span>
              {/*
                The size, so nobody starts a hundred-megabyte download on a
                phone tether without knowing.
              */}
              <span className="mt-auto pt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
                {size(a.sizeBytes)}
                {a.version !== null && ` · v${a.version}`}
              </span>
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {/*
          ★ SAY THIS BEFORE THEY MEET IT ★

          The build is not code-signed yet, so Windows SmartScreen and macOS
          Gatekeeper both warn. A member who hits that dialog with no warning
          concludes the file is malware — which is the correct instinct, and
          exactly why it has to be explained here rather than in a support
          message afterwards.
        */}
        Not code-signed yet, so Windows and macOS will both warn the first time you run it. On
        Windows choose <strong>More info → Run anyway</strong>; on macOS right-click the app and
        choose <strong>Open</strong>. Signing certificates are on the list.
        {version !== null && (
          <>
            {' '}
            Current version <span className="font-mono">v{version}</span>.
          </>
        )}
      </p>
    </div>
  );
}
