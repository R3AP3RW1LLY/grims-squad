import type { HubThread } from '../../lib/api';
import { Avatar, count, timeAgo } from './identity';

/**
 * One thread, as a row on a board.
 *
 * ★ WHAT A ROW IS FOR ★
 *
 * Squadron owner, 2026-07-30, asked for boards that work like RSI Spectrum. The substance of that
 * is not the colour scheme — it is that a row answers three questions without being opened: what is
 * this, is it still moving, and is it worth my time. So: title and opener on the left, activity on
 * the right, replies and views as separate numbers.
 *
 * Replies and views are deliberately NOT combined into one "activity" figure. A thread with 300
 * views and 2 replies is an announcement people read; 300 replies and 300 views is an argument
 * between six people. Those want opposite reactions from someone deciding where to click, and a
 * single blended number hides the difference.
 *
 * ★ ONE LINK, NOT SEVERAL ★
 *
 * The whole row is a single anchor. Nesting a link to the opener's profile inside the row link is
 * invalid HTML, and browsers resolve it by silently dropping one — usually not the one you meant.
 * The names here are therefore text; the profile is a click away from the thread itself.
 */
export function ThreadRow({
  thread,
  boardSlug,
}: {
  readonly thread: HubThread;
  readonly boardSlug: string;
}) {
  const t = thread;
  const active = t.lastPoster ?? t.author;
  const activeAt = t.lastPostAt ?? t.createdAt;

  return (
    <li>
      <a
        href={`/forum/${boardSlug}/${t.slug}`}
        className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-[var(--color-surface-panel-hover)]"
      >
        <Avatar identity={t.author} size="md" />

        {/* ── what it is ──────────────────────────────────────────────────── */}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {t.isPinned && (
              <span
                title="Pinned"
                aria-label="Pinned"
                className="shrink-0 font-mono text-[10px] tracking-[0.15em] text-[var(--color-brand-cyan-bright)]"
              >
                PINNED
              </span>
            )}
            {t.isLocked && (
              <span
                title="Locked"
                aria-label="Locked"
                className="shrink-0 font-mono text-[10px] tracking-[0.15em] text-[var(--color-text-secondary)]"
              >
                LOCKED
              </span>
            )}
            <span className="truncate text-[var(--color-text-primary)]">{t.title}</span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
            {t.author.displayName} · {timeAgo(t.createdAt)}
          </span>
        </span>

        {/* ── is it moving ────────────────────────────────────────────────── */}
        <span className="hidden shrink-0 gap-6 text-right sm:flex">
          <Stat label="replies" value={count(Math.max(0, t.postCount - 1))} />
          <Stat label="views" value={count(t.viewCount)} />
        </span>

        {/* ── who touched it last ─────────────────────────────────────────── */}
        <span className="hidden w-40 shrink-0 items-center gap-2 md:flex">
          <Avatar identity={active} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-xs text-[var(--color-text-primary)]">
              {active.displayName}
            </span>
            <span className="block font-mono text-[10px] text-[var(--color-text-secondary)]">
              {timeAgo(activeAt)}
            </span>
          </span>
        </span>

        {/*
          On a phone the two stat columns above are hidden — three columns of numbers in 360px is
          unreadable. The reply count still matters most, so it survives alone rather than the row
          collapsing to a bare title.
        */}
        <span className="shrink-0 font-mono text-xs text-[var(--color-text-secondary)] sm:hidden">
          {count(Math.max(0, t.postCount - 1))}
        </span>
      </a>
    </li>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="w-14">
      <span className="block font-mono text-sm text-[var(--color-text-primary)]">{value}</span>
      <span className="block font-mono text-[10px] tracking-[0.15em] text-[var(--color-text-secondary)]">
        {label.toUpperCase()}
      </span>
    </span>
  );
}
