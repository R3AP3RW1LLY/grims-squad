'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  TransitionChild,
} from '@headlessui/react';
import {
  Bars3Icon,
  XMarkIcon,
  HomeIcon,
  UsersIcon,
  RocketLaunchIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  ComputerDesktopIcon,
  LockClosedIcon,
  EyeSlashIcon,
  Cog6ToothIcon,
  ClipboardDocumentListIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import type { MeResponse, NavItem } from '../lib/api';
import { Avatar } from './account-menu';

/**
 * The members' area shell — sidebar, mobile drawer, top bar.
 *
 * ★ ADAPTED FROM THE TAILWIND PLUS SIDEBAR LAYOUT ★
 *
 * The structure is theirs and it is a good structure: a fixed sidebar on
 * desktop, the same sidebar as a Headless UI dialog on mobile, and a sticky top
 * bar carrying the drawer toggle and the account menu.
 *
 * The styling is entirely ours. The reference is a grey-on-white admin panel;
 * this is a dark cockpit, and every colour comes from the design tokens rather
 * than from Tailwind's grey scale — so a change in ssot/07-design/tokens.json
 * still moves this the way it moves everything else.
 *
 * ★ WHAT WAS DELIBERATELY LEFT OUT ★
 *
 * The reference carries a search box and a notification bell. We have neither:
 * Meilisearch is wired for a health check and nothing else, and there is no
 * notification model yet. Shipping the controls anyway would have put two dead
 * affordances in the most prominent strip of the page — an interface that
 * offers things it cannot do teaches people to stop trusting the rest of it.
 * They go in when the features behind them do.
 */

/**
 * An icon per destination.
 *
 * Keyed by href rather than carried in the nav payload, because the API has no
 * business knowing what a Heroicon is — that is a decision about this
 * interface, and a second client would make a different one.
 */
const ICONS: Record<string, typeof HomeIcon> = {
  '/dashboard': HomeIcon,
  '/roster': UsersIcon,
  '/ops': RocketLaunchIcon,
  '/bgs': GlobeAltIcon,
  '/fleet': ShieldCheckIcon,
  '/settings/commander': UserCircleIcon,
  '/settings/devices': ComputerDesktopIcon,
  '/settings/privacy': EyeSlashIcon,
  '/settings/security': LockClosedIcon,
  '/settings/account': Cog6ToothIcon,
  '/app': ShieldCheckIcon,
  '/app/members': UsersIcon,
  '/app/roles': KeyIcon,
  '/app/audit': ClipboardDocumentListIcon,
};

const SECTION_LABELS: Record<NavItem['section'], string> = {
  squadron: 'Squadron',
  personal: 'Your account',
  admin: 'Administration',
};

const ORDER: NavItem['section'][] = ['squadron', 'personal', 'admin'];

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

function SidebarContents({ me, current }: { me: MeResponse; current: string }) {
  const sections = ORDER.map((section) => ({
    section,
    items: me.nav.filter((i) => i.section === section),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="flex grow flex-col gap-y-5 overflow-y-auto border-r border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-panel)_92%,transparent)] px-5 pb-4 backdrop-blur-md">
      <a href="/dashboard" className="flex h-[var(--nav-h)] shrink-0 items-center gap-3">
        {/* A plain <img>: a fixed-size local PNG needs no optimiser. */}
        <img src="/brand/badge-128.png" alt="" width={36} height={36} className="h-9 w-9" />
        <span
          className="text-[13px] tracking-[0.2em] text-[var(--color-brand-orange-bright)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          GRIM&rsquo;S SQUAD
        </span>
      </a>

      <nav className="flex flex-1 flex-col">
        <ul role="list" className="flex flex-1 list-none flex-col gap-y-7 p-0">
          {sections.map(({ section, items }) => (
            <li key={section}>
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-text-secondary)]">
                {SECTION_LABELS[section]}
              </div>
              <ul role="list" className="mt-2 -mx-2 list-none space-y-1 p-0">
                {items.map((item) => {
                  const Icon = ICONS[item.href] ?? HomeIcon;
                  const active = current === item.href;
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'group flex gap-x-3 rounded p-2 text-sm/6 transition-colors',
                          active
                            ? 'bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)] text-[var(--color-brand-orange-bright)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)]',
                        )}
                      >
                        <Icon aria-hidden="true" className="size-5 shrink-0" />
                        {item.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}

          {/*
            Back to the public site, pinned to the bottom.

            Without it the hub is a one-way door: every link in here goes deeper
            in, and a member who wants to look at the squadron the way a visitor
            sees it has only the browser's back button.
          */}
          <li className="mt-auto">
            <a
              href="/"
              className="group -mx-2 flex gap-x-3 rounded p-2 text-sm/6 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)]"
            >
              <GlobeAltIcon aria-hidden="true" className="size-5 shrink-0" />
              Back to the site
            </a>

            {/*
              ★ THE POLICIES HAVE TO BE REACHABLE FROM IN HERE TOO ★

              They used to be, when every page shared the public footer. Splitting
              the site into `(site)` and `(hub)` route groups gave the hub its own
              chrome and quietly took the footer — and with it the only link to
              the privacy policy and terms — away from every signed-in page.

              Nothing broke visibly, which is exactly the problem: a member
              spends their whole session in here, and "where is your privacy
              policy" had no answer that did not involve typing a URL.

              Small and at the bottom, because they are reference material rather
              than navigation. Present is what matters.
            */}
            <p className="mt-3 flex gap-x-3 border-t border-[var(--color-border-hairline)] px-2 pt-3 text-xs text-[var(--color-text-secondary)]">
              <a href="/privacy" className="hover:text-[var(--color-text-primary)]">
                Privacy
              </a>
              <a href="/terms" className="hover:text-[var(--color-text-primary)]">
                Terms
              </a>
            </p>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function HubShell({
  me,
  current,
  children,
}: {
  me: MeResponse;
  current: string;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = me.user;
  const personal = me.nav.filter((i) => i.section === 'personal');

  async function signOut() {
    try {
      // POST with CSRF, never a link: a GET /logout can be fired by an <img>
      // on any page on the internet, which turns "sign me out" into something
      // strangers can do to you.
      await fetch('/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': readCsrf() },
      });
    } catch {
      // Go anyway — see the note in account-menu.tsx.
    }
    window.location.href = '/';
  }

  return (
    <div>
      {/* ---------------------------------------------------- mobile drawer */}
      <Dialog open={sidebarOpen} onClose={setSidebarOpen} className="relative z-50 lg:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-surface-void)_85%,transparent)] transition-opacity duration-300 ease-linear data-closed:opacity-0"
        />

        <div className="fixed inset-0 flex">
          <DialogPanel
            transition
            className="relative mr-16 flex w-full max-w-xs flex-1 transform transition duration-300 ease-in-out data-closed:-translate-x-full"
          >
            <TransitionChild>
              <div className="absolute top-0 left-full flex w-16 justify-center pt-5 duration-300 ease-in-out data-closed:opacity-0">
                <button type="button" onClick={() => setSidebarOpen(false)} className="-m-2.5 p-2.5">
                  <span className="sr-only">Close sidebar</span>
                  <XMarkIcon
                    aria-hidden="true"
                    className="size-6 text-[var(--color-text-primary)]"
                  />
                </button>
              </div>
            </TransitionChild>

            <SidebarContents me={me} current={current} />
          </DialogPanel>
        </div>
      </Dialog>

      {/* --------------------------------------------------- desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
        <SidebarContents me={me} current={current} />
      </div>

      <div className="lg:pl-64">
        {/* ------------------------------------------------------- top bar */}
        <div className="sticky top-0 z-40 flex h-[var(--nav-h)] shrink-0 items-center gap-x-4 border-b border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-void)_78%,transparent)] px-4 backdrop-blur-md sm:gap-x-6 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="-m-2.5 p-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] lg:hidden"
          >
            <span className="sr-only">Open sidebar</span>
            <Bars3Icon aria-hidden="true" className="size-6" />
          </button>

          <div
            aria-hidden="true"
            className="h-6 w-px bg-[var(--color-border-hairline)] lg:hidden"
          />

          <div className="flex flex-1 items-center justify-end gap-x-4 lg:gap-x-6">
            {/*
              The admin console is a separate button rather than another nav
              link: it is a different mode with different consequences, and one
              of the few places worth making somebody notice they are switching
              into it.

              Hidden while the account is unsecured, because the guard refuses
              them anyway and an offered-but-locked door teaches people the
              interface lies.
            */}
            {me.isAdmin && !me.mustSecureAccount && (
              <a
                href="/app"
                className="hidden rounded border border-[var(--color-brand-cyan-bright)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)] sm:block"
              >
                Admin
              </a>
            )}

            {user !== null && (
              <Menu as="div" className="relative">
                <MenuButton className="relative flex items-center gap-x-3">
                  <span className="sr-only">Open user menu</span>
                  <Avatar user={user} size={32} />
                  <span className="hidden lg:flex lg:items-center">
                    <span
                      aria-hidden="true"
                      className="text-sm/6 text-[var(--color-text-primary)]"
                    >
                      {user.displayName}
                    </span>
                    <ChevronDownIcon
                      aria-hidden="true"
                      className="ml-1.5 size-5 text-[var(--color-text-secondary)]"
                    />
                  </span>
                </MenuButton>

                <MenuItems
                  transition
                  className="absolute right-0 z-10 mt-2.5 w-56 origin-top-right overflow-hidden rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-raised)] py-1 shadow-xl transition data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
                >
                  <div className="border-b border-[var(--color-border-hairline)] px-4 py-2.5">
                    <p className="truncate text-sm text-[var(--color-text-primary)]">
                      {user.displayName}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
                      {user.rank ?? 'Commander'}
                    </p>
                  </div>

                  {personal.map((item) => (
                    <MenuItem key={item.href}>
                      <a
                        href={item.href}
                        className="block px-4 py-2 text-sm text-[var(--color-text-secondary)] data-focus:bg-[var(--color-surface-panel-hover)] data-focus:text-[var(--color-text-primary)] data-focus:outline-hidden"
                      >
                        {item.label}
                      </a>
                    </MenuItem>
                  ))}

                  <MenuItem>
                    <button
                      type="button"
                      onClick={() => void signOut()}
                      className="block w-full border-t border-[var(--color-border-hairline)] px-4 py-2 text-left text-sm text-[var(--color-text-secondary)] data-focus:bg-[var(--color-surface-panel-hover)] data-focus:text-[var(--color-text-primary)] data-focus:outline-hidden"
                    >
                      Sign out
                    </button>
                  </MenuItem>
                </MenuItems>
              </Menu>
            )}
          </div>
        </div>

        <main id="main" className="py-10">
          <div className="px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

function readCsrf(): string {
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}
