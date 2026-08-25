'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { PLATFORM_VERSION } from '@grims/shared/version';
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
  BellIcon,
  XMarkIcon,
  HomeIcon,
  UsersIcon,
  RocketLaunchIcon,
  ArrowsRightLeftIcon,
  GlobeAltIcon,
  ChatBubbleLeftRightIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  ComputerDesktopIcon,
  LockClosedIcon,
  Cog6ToothIcon,
  KeyIcon,
  AcademicCapIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  TruckIcon,
  BuildingOffice2Icon,
  TrophyIcon,
  MegaphoneIcon,
  NewspaperIcon,
  MapIcon,
  ViewfinderCircleIcon,
  // Added 2026-08-06, when every nav link got its own icon. Chosen for what the page DOES rather
  // than what it is called: a build list is a clipboard, a hauling run is a truck, a board is a
  // trophy — and two links sharing an icon is two links with no icon.
  CubeIcon,
  ScaleIcon,
  ClipboardDocumentListIcon,
  PlusCircleIcon,
  QueueListIcon,
  UserGroupIcon,
  BanknotesIcon,
  SignalIcon,
  StarIcon,
  FlagIcon,
  BookOpenIcon,
  InboxStackIcon,
  IdentificationIcon,
  TicketIcon,
} from '@heroicons/react/24/outline';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { ViewAsBanner } from './view-as-banner';
import {
  NAV_STORAGE_KEY,
  SUBSECTION_STORAGE_KEY,
  openSections,
  openSubsections,
  orderedEntries,
  parseStored,
  parseStoredSubsections,
  sectionOf,
  subsectionOf,
  toggleSection,
  toggleSubsection,
  type Section,
} from './nav-sections';
import type { MeResponse, NavItem } from '../lib/api';
import { Avatar } from './account-menu';
import { NotificationsPanel, useNotificationCounts } from './notifications-panel';

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
 * ★ WHAT WAS DELIBERATELY LEFT OUT — AND WHAT HAS SINCE GONE IN ★
 *
 * The reference carries a search box and a notification bell. The search box is
 * still out: Meilisearch is wired for a health check and nothing else, and a
 * dead affordance in the most prominent strip of the page teaches people to
 * stop trusting the rest of it. The bell went in on 2026-08-04, when the
 * notifications system behind it landed — which is the bargain the original
 * note struck: they go in when the features behind them do.
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
  '/forum': ChatBubbleLeftRightIcon,
  '/settings/commander': UserCircleIcon,
  '/settings/devices': ComputerDesktopIcon,
  '/settings/security': LockClosedIcon,
  '/settings/account': Cog6ToothIcon,
  '/app': ShieldCheckIcon,
  '/app/roles': KeyIcon,
  '/app/training': AcademicCapIcon,
  '/gmsd-ai/ask': ChatBubbleLeftRightIcon,
  '/gmsd-ai/train': SparklesIcon,
  // Stations gone dark on the map, which is what a runner is fixing. This entry was missing and
  // the board fell back to HomeIcon — two "home" entries in one section, neither of them home.
  '/bounties': MapIcon,
  // Release notes read like news, and a newspaper is what news looks like.
  '/changelog': NewspaperIcon,

  /*
   * ★ EVERY LINK, NOT MOST OF THEM — SQUADRON OWNER, 2026-08-06 ★
   *
   * "ensure every category and nav link in the website and companion app have appropriate icons"
   *
   * Nineteen links had none and fell through to the default, which put the same glyph beside
   * unrelated pages — and an icon that does not distinguish is worse than no icon, because the eye
   * learns to stop using it.
   */
  '/recruit': TicketIcon,
  '/mining': CubeIcon,
  '/colonisation/new': PlusCircleIcon,
  // A reticle: scouting is picking a target before anything is built.
  '/colonisation/scout': ViewfinderCircleIcon,
  '/colonisation/planning': ClipboardDocumentListIcon,
  // Two arrows passing: the nexus is about what flies BETWEEN our systems, not about any one of them.
  '/colonisation/nexus': ArrowsRightLeftIcon,
  '/colonisation/build-types': QueueListIcon,
  '/colonisation/squadron': BuildingOffice2Icon,
  '/colonisation/members': UserGroupIcon,
  '/colonisation/owed': InboxStackIcon,
  '/colonisation/ownership': BuildingOffice2Icon,
  '/logistics/commodities': ScaleIcon,
  '/logistics/freight-office': TruckIcon,
  '/shipyard': WrenchScrewdriverIcon,
  '/shipyard/squadron': ShieldCheckIcon,
  '/shipyard/public': GlobeAltIcon,
  // The five boards share a family deliberately — they ARE one thing five times — but each keeps
  // its own glyph so a member scanning the group can find theirs without reading.
  '/leaderboards/bounties': SignalIcon,
  '/leaderboards/colony': BuildingOffice2Icon,
  '/leaderboards/trade': BanknotesIcon,
  '/leaderboards/mining': CubeIcon,
  '/leaderboards/bgs': FlagIcon,
  // The Welcome — a recruiter hands out the ticket that gets somebody through the door.
  '/leaderboards/recruit': TicketIcon,
  '/roadmap': MapIcon,
  '/app/members': IdentificationIcon,
  '/app/conversations': InboxStackIcon,
};

/**
 * An icon per subcategory.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "find better icons for the Shipyard, Logistics & Trade and Colonization categories."
 *
 * They were all a wrench — the subcategory heading rendered `WrenchScrewdriverIcon` hardcoded,
 * whatever the subcategory was. Three groups with the same icon is three groups with no icon: the
 * only thing distinguishing them was the text, which is what the icon is there to save you reading.
 *
 * Keyed on the label rather than carried in the nav payload, for the same reason the route icons
 * are: the API has no business knowing what a Heroicon is. An unlisted subcategory falls back to
 * the wrench, so adding one is never a crash.
 */
const SUBSECTION_ICONS: Record<string, typeof HomeIcon> = {
  // Outfitting and building ships. The wrench genuinely belongs to this one.
  Shipyard: WrenchScrewdriverIcon,
  // Commodities and the Freight Office — both about moving cargo for profit.
  'Logistics & Trade': TruckIcon,
  // Construction sites, which is what the whole category is about building.
  Colonisation: BuildingOffice2Icon,
  // Standings and the badges they pay out. A trophy is the one thing all three boards award.
  Leaderboards: TrophyIcon,
  // The call going out — the category is a summons, and a megaphone is what a summons looks like.
  'Answer the Call': MegaphoneIcon,
  /*
   * Added with the two new categories on 2026-08-06. Command holds the officer-directed work —
   * operations and the background simulation — and About holds the things that are about the site
   * rather than about the squadron, which is why they no longer sit loose at the bottom.
   */
  Command: StarIcon,
  About: BookOpenIcon,
};

const SECTION_LABELS: Record<NavItem['section'], string> = {
  squadron: 'Squadron',
  personal: 'Your account',
  ai: 'GMSD AI',
  admin: 'Administration',
};

/*
 * ★ ORDER SET BY THE SQUADRON OWNER, 2026-08-01 ★
 *
 * "move the GMSD AI Category above the Your Account Category, and move Your Account category under
 * Administraion Category."
 *
 * Squadron, then GMSD AI, then Administration, then Your account.
 *
 * It puts the member's OWN settings last, which reads as odd until you look at how the sidebar is
 * actually used: squadron pages are daily, GMSD AI is something the owner wants people to see and
 * use, administration is a job, and your own account is a place you visit twice a year. Frequency
 * of use, descending — with the thing being promoted second, where it cannot be missed.
 */
const ORDER: NavItem['section'][] = ['squadron', 'ai', 'admin', 'personal'];

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

function SidebarContents({ me, current }: { me: MeResponse; current: string }) {
  const sections = ORDER.map((section) => ({
    section,
    items: me.nav.filter((i) => i.section === section),
  })).filter((s) => s.items.length > 0);

  /*
   * ★ COLLAPSIBLE CATEGORIES ★
   *
   * Squadron owner, 2026-08-01: "make all sidebar categories collapsable, by default the only
   * categories that should be expanded is Squadron and Administration".
   *
   * ★ THE DEFAULTS RENDER FIRST, THE STORED CHOICE ARRIVES AFTER ★
   *
   * Local storage does not exist on the server. Reading it during render would put one set of open
   * sections in the HTML and another at hydration — React replaces the markup and logs a mismatch.
   * So the first paint is always the defaults and the effect applies what was saved, which is one
   * frame later and only differs for somebody who has changed it.
   *
   * The section holding the current page is forced open either way. See `openSections`.
   */
  /*
   * ★ THE MOBILE DRAWER AND THE DESKTOP SIDEBAR ARE BOTH IN THE DOM ★
   *
   * One is hidden by a media query, not unmounted, so this component renders twice on every page. A
   * literal `nav-section-admin` would therefore appear twice — invalid HTML, and `aria-controls`
   * resolves to whichever came first, so a screen reader operating the drawer would be told about
   * the desktop sidebar's list.
   */
  const uid = useId();
  const here = sectionOf(me.nav, current);
  const hereSub = subsectionOf(me.nav, current);

  const [open, setOpen] = useState<Set<Section>>(() => openSections(null, here));
  /*
   * ★ SUBCATEGORIES START CLOSED — SQUADRON OWNER, 2026-08-01 ★
   *
   * "make this collapsable and make it closed by default please!"
   *
   * Separate state and a separate key from the sections. They are the same control with opposite
   * defaults, and one stored set could not express both: an absent entry means "use the open list"
   * for a section and "closed" for a subcategory.
   */
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => openSubsections(null, hereSub));

  useEffect(() => {
    setOpen(openSections(parseStored(window.localStorage.getItem(NAV_STORAGE_KEY)), here));
    setOpenSubs(
      openSubsections(
        parseStoredSubsections(window.localStorage.getItem(SUBSECTION_STORAGE_KEY)),
        hereSub,
      ),
    );
  }, [here, hereSub]);

  const toggleSub = (name: string) => {
    const next = toggleSubsection(openSubs, name);
    setOpenSubs(openSubsections([...next], hereSub));
    try {
      window.localStorage.setItem(SUBSECTION_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* the preference is not worth an error */
    }
  };

  const toggle = (section: Section) => {
    const next = toggleSection(open, section);
    setOpen(openSections([...next], here));
    // Best effort. Private browsing and a full quota both throw here, and neither is a reason to
    // stop the sidebar from opening.
    try {
      window.localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* the preference is not worth an error */
    }
  };

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
          {sections.map(({ section, items }) => {
            const expanded = open.has(section);
            const panelId = `${uid}-${section}`;

            return (
            <li key={section}>
              {/*
                A button, not a heading with a click handler. It is operated by keyboard and
                announced as expandable for free, and `aria-expanded` is the only thing telling a
                screen reader that the links below appeared because of this control.
              */}
              <button
                type="button"
                onClick={() => toggle(section)}
                aria-expanded={expanded}
                aria-controls={panelId}
                className="flex w-full items-center justify-between gap-2 rounded py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                <span>{SECTION_LABELS[section]}</span>
                {/*
                  The chevron points down when open and right when closed — the direction the
                  content is, not an abstract state. Rotated rather than swapped so it turns.
                */}
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cx(
                    'size-3.5 shrink-0 transition-transform duration-150',
                    expanded ? 'rotate-0' : '-rotate-90',
                  )}
                />
              </button>
              <ul
                id={panelId}
                role="list"
                hidden={!expanded}
                className="mt-2 -mx-2 list-none space-y-1 p-0"
              >
                {/*
                  ★ RENDERED IN DEFINITION ORDER ★

                  Squadron owner, 2026-08-01: "move the shipyard category so its below the roster
                  please in the sidenav."

                  This used to render every loose link first and push subcategories to the bottom,
                  which made a subcategory's position in `nav.ts` meaningless — it could only ever
                  land last. Now a group appears where its FIRST member appears, so ordering the
                  sidebar is done by ordering the definitions, which is where somebody looking to
                  reorder it would go first.

                  The original worry stands: a group heading between two plain links can read as
                  though the links below belong to it. Indentation and the smaller type carry that
                  now, which is the honest fix — the old one solved a legibility problem by taking
                  away control over the order.
                */}
                {orderedEntries(items).map((entry) => {
                  if (entry.kind === 'item') {
                    const item = entry.item;
                    const Icon = ICONS[item.href] ?? HomeIcon;
                    const active = current === item.href;
                    return (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cx(
                            'group flex gap-x-3 rounded px-2 py-1.5 text-xs/5 transition-colors',
                            active
                              ? 'bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)] text-[var(--color-brand-orange-bright)]'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)]',
                          )}
                        >
                          <Icon aria-hidden="true" className="size-4 shrink-0" />
                          {item.label}
                        </a>
                      </li>
                    );
                  }

                  const sub = entry.name;
                  const subOpen = openSubs.has(sub);
                  const subId = `${uid}-${section}-${sub.replace(/\s+/g, '-')}`;

                  return (
                    /*
                      One size everywhere, and it is the SMALL one. The owner asked for uniformity
                      on 2026-08-04 and the first attempt enlarged the sub-rows to match the links
                      — "this looks really bad" — so the links came down instead: every row in the
                      sidebar now sits at the category-heading size, and only the inset and the
                      border say "a level down".
                    */
                    <li key={sub} className="mt-1 ml-2">
                      <button
                        type="button"
                        onClick={() => toggleSub(sub)}
                        aria-expanded={subOpen}
                        aria-controls={subId}
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-xs/5 font-medium tracking-wide text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)]"
                      >
                        <span className="flex items-center gap-x-2.5">
                          {(() => {
                            const SubIcon = SUBSECTION_ICONS[sub] ?? WrenchScrewdriverIcon;
                            return <SubIcon aria-hidden="true" className="size-4 shrink-0" />;
                          })()}
                          {sub}
                        </span>
                        <ChevronDownIcon
                          aria-hidden="true"
                          className={cx(
                            'size-3 shrink-0 transition-transform duration-150',
                            subOpen ? 'rotate-0' : '-rotate-90',
                          )}
                        />
                      </button>

                      {/*
                        Indented by a border rather than by padding alone: a vertical line makes the
                        nesting readable at a glance, where indentation alone reads as an accident
                        on a narrow sidebar.
                      */}
                      <ul
                        id={subId}
                        role="list"
                        hidden={!subOpen}
                        className="ml-3.5 mt-0.5 list-none space-y-0.5 border-l border-[var(--color-border-hairline)] p-0 pl-2.5"
                      >
                        {entry.items.map((item) => {
                          const active = current === item.href;
                          return (
                            <li key={item.href}>
                              <a
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cx(
                                  'group flex gap-x-3 rounded px-2 py-1.5 text-xs/5 transition-colors',
                                  active
                                    ? 'bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)] text-[var(--color-brand-orange-bright)]'
                                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)]',
                                )}
                              >
                                {item.label}
                                {/*
                                  ★ SQUADRON OWNER, 2026-08-06 ★

                                  "we also need to add this notification/badge to the web site
                                  too" — the companion has shown these counts since colonisation
                                  shipped and the website never has, so a member saw a number in
                                  one place and a bare link in the other.

                                  The API decides the number and omits it entirely at zero, so
                                  there is no grey nought beside every link teaching people to
                                  stop reading them.
                                */}
                                {item.badge === undefined ? null : (
                                  <span
                                    className="ml-auto rounded-full bg-[color-mix(in_srgb,var(--color-brand-cyan)_18%,transparent)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--color-brand-cyan-bright)]"
                                    aria-label={`${item.badge} still needing hauling`}
                                  >
                                    {item.badge}
                                  </span>
                                )}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </li>
            );
          })}

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
              {/*
                ★ ONE VERSION, BOTH SURFACES — SQUADRON OWNER, 2026-08-04 ★
                The same PLATFORM_VERSION the companion app prints; the version-sync spec keeps
                the two equal, the changelog stamps it on every release, and it links there
                because "what is this version" is exactly what the changelog answers.
              */}
              <a
                href="/changelog"
                className="ml-auto font-mono text-[10px] tracking-[0.18em] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
              >
                v{PLATFORM_VERSION}
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

  /*
   * ★ THE BELL'S STATE LIVES HERE, NOT IN THE PANEL ★
   *
   * The badge renders whether or not the panel is open, and the tab pills inside the panel are
   * the same three numbers. One hook instance in the shell means both surfaces read one state —
   * a badge saying 3 over a panel saying 1 reads as a bug even in the moment both are true.
   *
   * The shell is also the one component on every hub page, which makes it the right owner of the
   * badge's live stream: pages that refresh themselves keep their own LiveRefresh subscription,
   * and the two do not fight over what an event means.
   */
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const notificationsRef = useRef<HTMLElement>(null);
  const { counts, refetch, apply } = useNotificationCounts();

  /*
   * Escape closes the panel and puts focus back on the bell that opened it — the mobile-nav
   * idiom. Without the return, a keyboard user is dumped at the top of the document and has to
   * tab all the way back to where they were.
   */
  useEffect(() => {
    if (!notificationsOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setNotificationsOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [notificationsOpen]);

  /*
   * A click anywhere else dismisses it. The bell is excluded because its own click already
   * toggles — without the exclusion, clicking the bell while open would close-then-reopen.
   */
  useEffect(() => {
    if (!notificationsOpen) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (!notificationsRef.current?.contains(t) && !bellRef.current?.contains(t)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [notificationsOpen]);

  /*
   * Focus moves INTO the panel as it opens, so the next Tab press lands on the first tab button
   * rather than wherever the pointer happened to leave it. The panel is `inert` while closed, so
   * this cannot run early — the effect fires after the attribute is gone.
   */
  useEffect(() => {
    if (notificationsOpen) notificationsRef.current?.focus();
  }, [notificationsOpen]);

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
        {/*
          ★ THE PREVIEW BANNER SITS ABOVE EVERYTHING ★

          A rank preview makes the site behave as that rank's does — the admin section leaves the
          sidebar, pages refuse, buttons vanish. All correct, and all exactly what somebody would
          report as "I have lost my permissions" if nothing accounted for it.

          Above the top bar rather than inside it: a preview is a state the whole page is in, not a
          control that lives in the chrome.
        */}
        {/*
          `!= null`, catching undefined as well as null.
          
          `!== null` alone crashes the entire shell on a response that omits the field — an older
          cached client, or any error path that builds a partial `me`. The banner is chrome; it must
          never be the reason a page fails to render.
        */}
        {me.viewingAs != null && <ViewAsBanner roleName={me.viewingAs.name} />}

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

            {/*
              ★ THE BELL — SQUADRON OWNER, 2026-08-04 ★

              "create a notifications dropdown in a bell icon at the top right of the site ...
              this should also have a badge system with a read all option". Immediately left of
              the account menu, because that corner is where every site keeps it and a bell
              anywhere else is a bell people search for.

              The badge is the TOTAL across both feeds, capped at 99+ — three digits on a pill
              this size stop being a number and start being noise — and hidden entirely at zero,
              because a grey "0" is a control begging to be clicked with nothing behind it. It
              updates live: the counts hook refetches on every `notification` SSE event, and
              again each time the panel opens.

              Signed-in only, same condition as the account menu beside it: the endpoints need a
              session, and a bell for nobody would 401 on arrival.
            */}
            {user !== null && (
              <button
                ref={bellRef}
                type="button"
                onClick={() => setNotificationsOpen((v) => !v)}
                aria-expanded={notificationsOpen}
                aria-controls="notifications-panel"
                className="relative -m-1.5 p-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                <span className="sr-only">
                  {counts !== null && counts.total > 0
                    ? `Notifications, ${counts.total} unread`
                    : 'Notifications'}
                </span>
                <BellIcon aria-hidden="true" className="size-6" />
                {counts !== null && counts.total > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-[var(--color-brand-orange)] px-1 text-center font-mono text-[9px] leading-4 text-[var(--color-text-on-accent)]"
                  >
                    {counts.total > 99 ? '99+' : counts.total}
                  </span>
                )}
              </button>
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

        {/*
          ★ THE NOTIFICATIONS PANEL — THE OWNER'S EXACT SHAPE ★

          It slides in from the RIGHT EDGE and runs exactly from the base of the navbar to the
          bottom of the viewport. `top-[var(--nav-h)]` with `bottom-0` IS that spec: the top bar
          above is `sticky top-0` with `h-[var(--nav-h)]`, so its base sits exactly --nav-h from
          the viewport top at BOTH values the token takes (4rem, and 4.5rem from `sm` up — see
          globals.css). A hard-coded h-16 twin would have drifted on the first screen wider than
          640px.

          ★ A SIBLING OF THE TOP BAR, NEVER A CHILD ★

          The top bar carries backdrop-blur, and a backdrop-filter establishes a containing block
          — `fixed` inside it would measure from the BAR rather than the viewport, and the panel
          would pin itself inside a 4rem strip.

          z-30 on the shell's ladder: under the top bar (z-40) and the sidebars (z-50) so the
          chrome stays in charge, over everything the page renders. Width is 400px against the
          right edge, full-width below `sm` where 400px IS the viewport.

          The transition is transform-only — right-to-left translate, 200ms — so it composites on
          the GPU, and the global prefers-reduced-motion rule in globals.css collapses it to an
          instant show/hide. The panel must still APPEAR; disabling motion cannot disable
          notifications. `inert` while closed keeps its buttons out of the tab order the same way
          the mobile nav's links are kept out.
        */}
        <aside
          id="notifications-panel"
          ref={notificationsRef}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          inert={!notificationsOpen}
          className={`fixed top-[var(--nav-h)] right-0 bottom-0 z-30 w-full border-l border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-panel)_92%,transparent)] shadow-xl backdrop-blur-md outline-hidden transition-transform duration-200 ease-out sm:w-[400px] ${
            notificationsOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <NotificationsPanel
            open={notificationsOpen}
            counts={counts}
            refetchCounts={refetch}
            applyCounts={apply}
          />
        </aside>

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
