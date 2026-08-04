'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/api-client';
import type {
  NotificationCounts,
  PersonalNotification,
  SquadronNotification,
} from '../lib/api';
import { kindIcon, notificationAge } from './notifications-format';
import { useLiveEvent } from './use-live-event';

/**
 * What lives inside the bell's slide-in panel: two tabs, two read models.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "create a notifications dropdown in a bell icon ... this should also have a badge system with a
 * read all option and should work like standard social media notifications etc!" — approved with
 * the panel as a right-edge slide-in.
 *
 * PERSONAL rows each carry their own readAt, so a row is marked read one at a time, the way every
 * social feed works. The SQUADRON feed is one shared row per event and "read" is the member's own
 * high-water mark — so opening the tab IS the read action, and there is nothing to click per row.
 *
 * ★ THE COUNTS LIVE IN THE SHELL, NOT IN HERE ★
 *
 * The badge on the bell and the pills on the tab labels are the same three numbers, and the bell
 * renders whether or not the panel is open. So `useNotificationCounts` is owned by HubShell and
 * both surfaces read one state — two fetches of `/count` could disagree for a moment, and a badge
 * saying 3 over a panel saying 1 reads as a bug even when both were briefly true.
 */

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type FeedState<T> =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | ({ phase: 'ready' } & Page<T>);

type Tab = 'personal' | 'squadron';

/**
 * The unread numbers behind the badge and the tab pills.
 *
 * Fetched once on mount, refetched whenever the live stream says `notification` — the event
 * deliberately carries NO payload, it only says "ask again" — and refetched again each time the
 * panel opens, so a count that went stale while the tab was backgrounded corrects itself at the
 * moment somebody looks at it.
 *
 * `apply` is for optimistic writes: reading a row, reading everything, opening the squadron tab.
 * Each of those posts fire-and-forget, and the next SSE nudge or open re-syncs with the server's
 * own answer — so a failed write costs a briefly-wrong number, never a stuck one.
 */
export function useNotificationCounts(): {
  counts: NotificationCounts | null;
  refetch: () => void;
  apply: (mutate: (prev: NotificationCounts) => NotificationCounts) => void;
} {
  const [counts, setCounts] = useState<NotificationCounts | null>(null);

  const refetch = useCallback(() => {
    apiGet<NotificationCounts>('/v1/notifications/count')
      .then(setCounts)
      .catch(() => {
        /* The badge is decoration on the bell. A failed count keeps the last number rather than
           surfacing an error nobody can act on. */
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useLiveEvent('notification', refetch);

  const apply = useCallback((mutate: (prev: NotificationCounts) => NotificationCounts) => {
    // Before the first fetch lands there is nothing to mutate, and inventing zeros to mutate
    // would let an optimistic write conjure a badge out of nowhere.
    setCounts((prev) => (prev === null ? prev : mutate(prev)));
  }, []);

  return { counts, refetch, apply };
}

export function NotificationsPanel({
  open,
  counts,
  refetchCounts,
  applyCounts,
}: {
  open: boolean;
  counts: NotificationCounts | null;
  refetchCounts: () => void;
  applyCounts: (mutate: (prev: NotificationCounts) => NotificationCounts) => void;
}) {
  const uid = useId();
  const [tab, setTab] = useState<Tab>('personal');
  const [personal, setPersonal] = useState<FeedState<PersonalNotification>>({ phase: 'loading' });
  const [squadron, setSquadron] = useState<FeedState<SquadronNotification>>({ phase: 'loading' });
  /** A page of history on its way. One flag, because only the visible tab can be paging. */
  const [paging, setPaging] = useState(false);

  const loadPersonal = useCallback(async () => {
    setPersonal({ phase: 'loading' });
    try {
      const page = await apiGet<Page<PersonalNotification>>('/v1/notifications?tab=personal');
      setPersonal({ phase: 'ready', ...page });
    } catch {
      setPersonal({ phase: 'failed' });
    }
  }, []);

  const loadSquadron = useCallback(async () => {
    setSquadron({ phase: 'loading' });
    try {
      const page = await apiGet<Page<SquadronNotification>>('/v1/notifications?tab=squadron');
      setSquadron({ phase: 'ready', ...page });
    } catch {
      setSquadron({ phase: 'failed' });
    }
  }, []);

  /*
   * Opening the squadron tab IS reading it — the API advances the member's seen marker, and the
   * pill zeroes optimistically so the number does not outlive the list it counts. Anything that
   * happens AFTER this moment bumps the count again through the live stream, which is exactly
   * right: it happened while the member was looking, and it is still news.
   */
  const markSquadronSeen = useCallback(() => {
    applyCounts((c) => ({ ...c, squadron: 0, total: c.personal }));
    apiPost('/v1/notifications/squadron-seen').catch(() => {
      /* The marker did not advance, so the next /count re-raises the pill. Nothing to repair. */
    });
  }, [applyCounts]);

  /*
   * Every OPEN starts the visible tab fresh and re-asks for the counts. A panel that showed the
   * list from twenty minutes ago under a badge that just said "3 new" would be answering a
   * different question from the one the click asked.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      refetchCounts();
      if (tab === 'personal') {
        void loadPersonal();
      } else {
        void loadSquadron();
        markSquadronSeen();
      }
    }
    wasOpen.current = open;
  }, [open, tab, refetchCounts, loadPersonal, loadSquadron, markSquadronSeen]);

  const selectTab = (next: Tab): void => {
    setTab(next);
    // Reloaded on every switch rather than cached: the list is one page of thirty and the other
    // tab may have aged while this one was on screen.
    if (next === 'personal') {
      void loadPersonal();
    } else {
      void loadSquadron();
      markSquadronSeen();
    }
  };

  const markAllRead = (): void => {
    // Optimistic on all three surfaces at once — the badge, the pills, and every loaded row —
    // because "Mark all read" that leaves accent bars behind looks like it half-worked.
    applyCounts(() => ({ personal: 0, squadron: 0, total: 0 }));
    const now = new Date().toISOString();
    setPersonal((prev) =>
      prev.phase === 'ready'
        ? {
            ...prev,
            items: prev.items.map((i) => (i.readAt === null ? { ...i, readAt: now } : i)),
          }
        : prev,
    );
    apiPost('/v1/notifications/read-all').catch(() => {
      // The server never heard it, so the optimistic zero is now a lie — re-ask for the truth.
      refetchCounts();
    });
  };

  /** Marks one personal row read. Resolves either way, so navigation never waits on a failure. */
  const readOne = (item: PersonalNotification): Promise<void> => {
    if (item.readAt !== null) return Promise.resolve();
    const now = new Date().toISOString();
    setPersonal((prev) =>
      prev.phase === 'ready'
        ? { ...prev, items: prev.items.map((i) => (i.id === item.id ? { ...i, readAt: now } : i)) }
        : prev,
    );
    applyCounts((c) => ({
      ...c,
      personal: Math.max(0, c.personal - 1),
      total: Math.max(0, c.total - 1),
    }));
    return apiPost(`/v1/notifications/${encodeURIComponent(item.id)}/read`)
      .then(() => undefined)
      .catch(() => {
        /* The row will come back unread on the next open, which is the honest outcome. */
      });
  };

  const showOlder = async (): Promise<void> => {
    if (paging) return;
    const feed = tab === 'personal' ? personal : squadron;
    if (feed.phase !== 'ready' || feed.nextCursor === null) return;
    const cursor = encodeURIComponent(feed.nextCursor);

    setPaging(true);
    try {
      if (tab === 'personal') {
        const page = await apiGet<Page<PersonalNotification>>(
          `/v1/notifications?tab=personal&cursor=${cursor}`,
        );
        setPersonal((prev) =>
          prev.phase === 'ready'
            ? { phase: 'ready', items: [...prev.items, ...page.items], nextCursor: page.nextCursor }
            : prev,
        );
      } else {
        const page = await apiGet<Page<SquadronNotification>>(
          `/v1/notifications?tab=squadron&cursor=${cursor}`,
        );
        setSquadron((prev) =>
          prev.phase === 'ready'
            ? { phase: 'ready', items: [...prev.items, ...page.items], nextCursor: page.nextCursor }
            : prev,
        );
      }
    } catch {
      /* The button stays; pressing it again is the retry. */
    } finally {
      setPaging(false);
    }
  };

  const tabId = (t: Tab): string => `${uid}-tab-${t}`;
  const paneId = (t: Tab): string => `${uid}-pane-${t}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-end justify-between gap-4 border-b border-[var(--color-border-hairline)] px-4 pt-3">
        {/*
          The same lightweight tablist the leaderboards use: buttons with aria-selected, state in
          React. Not PageTabs — those are ANCHORS, because a page tab should survive a refresh,
          and a panel that closes on navigation has no state worth a URL.
        */}
        <div role="tablist" aria-label="Notification feeds" className="flex gap-5">
          <TabButton
            id={tabId('personal')}
            controls={paneId('personal')}
            selected={tab === 'personal'}
            onSelect={() => selectTab('personal')}
            label="Personal"
            count={counts?.personal ?? 0}
          />
          <TabButton
            id={tabId('squadron')}
            controls={paneId('squadron')}
            selected={tab === 'squadron'}
            onSelect={() => selectTab('squadron')}
            label="Squadron"
            count={counts?.squadron ?? 0}
          />
        </div>

        <button
          type="button"
          onClick={markAllRead}
          className="pb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-brand-cyan-bright)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Mark all read
        </button>
      </div>

      <div
        role="tabpanel"
        id={paneId(tab)}
        aria-labelledby={tabId(tab)}
        className="flex-1 overflow-y-auto"
      >
        {tab === 'personal' ? (
          <PersonalFeed
            feed={personal}
            paging={paging}
            onRetry={() => void loadPersonal()}
            onShowOlder={() => void showOlder()}
            onRead={readOne}
          />
        ) : (
          <SquadronFeed
            feed={squadron}
            paging={paging}
            onRetry={() => void loadSquadron()}
            onShowOlder={() => void showOlder()}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  id,
  controls,
  selected,
  onSelect,
  label,
  count,
}: {
  id: string;
  controls: string;
  selected: boolean;
  onSelect: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={controls}
      onClick={onSelect}
      className={`flex items-center gap-1.5 border-b-2 px-0.5 pb-2 text-sm transition-colors ${
        selected
          ? 'border-[var(--color-brand-orange)] text-[var(--color-text-primary)]'
          : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {label}
      {count > 0 && (
        <span className="min-w-4 rounded-full bg-[var(--color-brand-orange)] px-1 text-center font-mono text-[9px] leading-4 text-[var(--color-text-on-accent)]">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

/**
 * The layout every row shares: icon, title, optional body, and the meta line.
 *
 * The unread treatment — a left accent bar plus the brighter title — is on the PERSONAL rows
 * only. Squadron rows have no per-row read state to draw, so drawing one would be a lie about a
 * distinction the data does not hold.
 */
function RowBody({
  icon,
  title,
  body,
  meta,
  unread,
}: {
  icon: string;
  title: string;
  body: string | null;
  meta: string;
  unread: boolean;
}) {
  return (
    <>
      <span aria-hidden="true" className="shrink-0 text-base leading-5">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-sm leading-5 ${
            unread ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {title}
        </span>
        {body !== null && body !== '' && (
          <span className="mt-0.5 block truncate text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {body}
          </span>
        )}
        <span className="mt-1 block font-mono text-[10px] tracking-wide text-[var(--color-text-dim)]">
          {meta}
        </span>
      </span>
      {unread && <span className="sr-only">Unread.</span>}
    </>
  );
}

const ROW_BASE =
  'flex w-full items-start gap-3 px-4 py-3 text-left no-underline transition-colors hover:bg-[var(--color-surface-panel-hover)]';
const ROW_UNREAD =
  'border-l-2 border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_6%,transparent)]';
const ROW_READ = 'border-l-2 border-transparent';

function ShowOlder({ paging, onShowOlder }: { paging: boolean; onShowOlder: () => void }) {
  /*
   * A button rather than an IntersectionObserver. The panel keeps history behind a deliberate
   * act the same way the audit log and the AI conversation list do — and a feed that loads more
   * whenever the scrollbar nears the bottom makes "have I seen everything" unanswerable.
   */
  return (
    <button
      type="button"
      onClick={onShowOlder}
      disabled={paging}
      className="w-full border-t border-[var(--color-border-hairline)] px-4 py-3 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-60"
    >
      {paging ? 'Loading…' : 'Show older'}
    </button>
  );
}

function FeedProblem({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-4 py-6">
      <p className="m-0 text-sm leading-relaxed text-[var(--color-text-primary)]">
        We could not load notifications just now.
      </p>
      <p className="m-0 mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        You are still signed in — this is our end, not yours.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded border border-[var(--color-border-hairline)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        Try again
      </button>
    </div>
  );
}

function FeedLoading() {
  return <p className="m-0 px-4 py-6 text-sm text-[var(--color-text-secondary)]">Loading…</p>;
}

function PersonalFeed({
  feed,
  paging,
  onRetry,
  onShowOlder,
  onRead,
}: {
  feed: FeedState<PersonalNotification>;
  paging: boolean;
  onRetry: () => void;
  onShowOlder: () => void;
  onRead: (item: PersonalNotification) => Promise<void>;
}) {
  if (feed.phase === 'loading') return <FeedLoading />;
  if (feed.phase === 'failed') return <FeedProblem onRetry={onRetry} />;

  if (feed.items.length === 0) {
    return (
      <p className="m-0 px-4 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Nothing has arrived for you yet. Replies to your posts, mentions of your name and badges
        you earn land in this tab.
      </p>
    );
  }

  return (
    <>
      <ul className="m-0 list-none divide-y divide-[var(--color-border-subtle)] p-0">
        {feed.items.map((item) => {
          const unread = item.readAt === null;
          const link = item.link;
          const body = (
            <RowBody
              icon={kindIcon(item.kind)}
              title={item.title}
              body={item.body}
              meta={notificationAge(item.createdAt)}
              unread={unread}
            />
          );

          return (
            <li key={item.id}>
              {link === null ? (
                // No destination, so the click's only meaning is "seen". A read row keeps the
                // button — clicking it again is a harmless no-op, and swapping elements by read
                // state would move focus out from under a keyboard user mid-list.
                <button
                  type="button"
                  onClick={() => void onRead(item)}
                  className={`${ROW_BASE} ${unread ? ROW_UNREAD : ROW_READ}`}
                >
                  {body}
                </button>
              ) : (
                <a
                  href={link}
                  onClick={(e) => {
                    /*
                     * A modified click means "open in a new tab" — let the browser have it and
                     * only record the read. A plain click waits for the read to land before
                     * navigating, because a fetch abandoned by navigation may never arrive and
                     * the row would come back unread on a page it was already seen on.
                     */
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                      void onRead(item);
                      return;
                    }
                    e.preventDefault();
                    void onRead(item).then(() => {
                      window.location.assign(link);
                    });
                  }}
                  className={`${ROW_BASE} ${unread ? ROW_UNREAD : ROW_READ}`}
                >
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {feed.nextCursor !== null && <ShowOlder paging={paging} onShowOlder={onShowOlder} />}
    </>
  );
}

function SquadronFeed({
  feed,
  paging,
  onRetry,
  onShowOlder,
}: {
  feed: FeedState<SquadronNotification>;
  paging: boolean;
  onRetry: () => void;
  onShowOlder: () => void;
}) {
  if (feed.phase === 'loading') return <FeedLoading />;
  if (feed.phase === 'failed') return <FeedProblem onRetry={onRetry} />;

  if (feed.items.length === 0) {
    return (
      <p className="m-0 px-4 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        The squadron feed is empty for now. What members post, build and claim appears here as it
        happens.
      </p>
    );
  }

  return (
    <>
      <ul className="m-0 list-none divide-y divide-[var(--color-border-subtle)] p-0">
        {feed.items.map((item) => {
          const meta =
            item.actor === null
              ? notificationAge(item.createdAt)
              : `${item.actor.displayName} · ${notificationAge(item.createdAt)}`;
          const body = (
            <RowBody
              icon={kindIcon(item.kind)}
              title={item.title}
              body={item.body}
              meta={meta}
              unread={false}
            />
          );

          return (
            <li key={item.id}>
              {item.link === null ? (
                <div className={`${ROW_BASE} ${ROW_READ}`}>{body}</div>
              ) : (
                <a href={item.link} className={`${ROW_BASE} ${ROW_READ}`}>
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {feed.nextCursor !== null && <ShowOlder paging={paging} onShowOlder={onShowOlder} />}
    </>
  );
}
