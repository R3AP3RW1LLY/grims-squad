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
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
        {assets.map((a) => (
          <li key={a.file}>
            <a
              href={`/v1/companion/download/${encodeURIComponent(a.file)}`}
              className="flex h-full flex-col rounded border border-[var(--color-brand-cyan-bright)] p-4 transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_10%,transparent)]"
            >
              <span className="font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
                {PLATFORM[a.platform].label}
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
