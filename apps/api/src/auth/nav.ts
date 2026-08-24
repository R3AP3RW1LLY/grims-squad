import { Permission, hasAnyPermission, type PermissionMask } from '@grims/shared';

/**
 * What a member can actually reach, decided on the SERVER.
 *
 * ★ WHY THE SERVER DECIDES, AND NOT THE BROWSER ★
 *
 * The navigation could be built client-side from a permission mask, and that
 * would be one fewer thing here. It would also mean shipping the whole
 * permission model to every visitor and trusting a bigint comparison in
 * somebody else's browser to decide what an admin link looks like.
 *
 * This is not a security boundary — every route behind these links checks
 * permissions again, and must, because a link is not an authorisation. It is an
 * HONESTY boundary: a member should not see a menu item that will refuse them.
 * Deciding it here means the menu and the guard read the same mask from the
 * same source, and cannot drift.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** A count worth showing beside the entry. Absent when there is nothing to say. */
  readonly badge?: number;
  /** Groups items under a heading in the sidebar. */
  /*
   * ★ 'ai' ADDED 2026-08-01, ON THE OWNER'S INSTRUCTION ★
   *
   * "a new side bar category called GMSD AI." Deliberately NOT folded into `squadron`: what the
   * assistant knows and how members feed it is its own thing, and burying "Help Train the Bot"
   * among the roster and the ops board is how nobody finds it — which for a collection drive is
   * the same as it not existing.
   */
  readonly section: 'squadron' | 'personal' | 'ai' | 'admin';
  /**
   * A collapsible group WITHIN a section. Absent for items that sit directly under the heading.
   *
   * ★ SQUADRON OWNER, 2026-08-01 ★
   *
   * "create the shipyard page under a subcategory in the Squadron category called Shipyard then
   * name the page outfitter please. make this collapsable and make it closed by default."
   *
   * A second level exists because the Shipyard is a PLACE with several things in it — the outfitter
   * today, comparisons and saved builds later — and hanging them all off the Squadron heading would
   * bury the roster and the ops board among tools nobody uses daily.
   *
   * Closed by default, so an unused subcategory costs one line rather than a screenful.
   */
  readonly subsection?: string;
  /** A one-line description, for the dashboard cards. */
  readonly blurb: string;
}

interface NavDefinition extends NavItem {
  /** Any ONE of these is enough. `null` means everybody signed in. */
  readonly requires: PermissionMask | null;
}

/**
 * Every authenticated destination, and what it takes to reach it.
 *
 * Ordered as it is rendered. `requires: null` is deliberate for the personal
 * pages: your own settings are yours regardless of rank, and gating them on a
 * permission would be a bug waiting to happen the first time somebody's roles
 * were rebuilt.
 */
const NAV: readonly NavDefinition[] = [
// ---- squadron ------------------------------------------------------------
  {
    href: '/dashboard',
    label: 'Dashboard',
    section: 'squadron',
    blurb: 'Where you stand, and what needs doing.',
    requires: null,
  },
  {
    href: '/fleet',
    label: 'Fleet',
    section: 'squadron',
    blurb: 'Ships, builds, and what the doctrine asks for.',
    requires: Permission.FLEET_VIEW,
  },
  {
    /*
     * ★ SQUADRON OWNER, 2026-08-04 ★
     *
     * "create a new page under squadrons called Data bounty's and create a list of all stations
     * and systems we need to dock at to shore up market data ... turn this into our first offical
     * Data Runner Leaderboard please!"
     *
     * Gated on TRADE_QUERY like the market pages it feeds: the board is market metadata, and one
     * mask governing both means taking the market away takes the bounty hunt with it.
     */
    /*
     * ★ ANSWER THE CALL — SQUADRON OWNER, 2026-08-04 ★
     *
     * "Put the data bounties nav link under a new category called Answer the Call please ...
     * it should be placed under the Colonization category." A group appears where its first
     * member appears, so this entry sitting after the Colonisation block IS the placement.
     * One entry today; the category exists because more calls to answer are coming.
     */
    href: '/bounties',
    label: 'Data Bounties',
    section: 'squadron',
    subsection: 'Answer the Call',
    blurb: 'Stations whose market data has gone dark. Dock, open the market, collect the points.',
    requires: Permission.TRADE_QUERY,
  },
  {
    /*
     * Mining sits under "Answer the Call" beside Data Bounties because it asks the same thing of a
     * member: go somewhere and come back with something the squadron did not have. The rings page
     * is built entirely from members' own prospector limpets — it is worth nothing until people fly
     * it, and worth more than any single-player tool once they do.
     */
    href: '/mining',
    label: 'Mining',
    section: 'squadron',
    subsection: 'Answer the Call',
    blurb: 'Which rings the squadron has actually been finding worth mining, this fortnight.',
    // Its own bit since 2026-08-06. It rode on TRADE_QUERY for a day, which meant taking the
    // market away from somebody took mining with it.
    requires: Permission.MINING_VIEW,
  },
  /*
   * Colonisation, under the same subcategory. Gated on COLONY_VIEW, which guests do NOT hold —
   * unlike the two above. Squadron owner, 2026-08-02: "Squadron projects members-only, personal
   * projects publishable by choice", and a project board says who is building what and where.
   *
   * A published personal project is reachable without a session, but on a TOKEN rather than through
   * this entry — the same shape as a shared ship build.
   */
  /*
   * ★ ITS OWN GROUP, NOT A LINE UNDER LOGISTICS — SQUADRON OWNER, 2026-08-02 ★
   *
   * "remove colonization from the Logistics and Trade subcategory and create a colonization category
   * that matches up with the companion app please!"
   *
   * The companion app's sidebar has a collapsible Colonisation group with exactly these three
   * destinations, in exactly this order — New project first, then squadron above members. A member
   * who learns one of the two apps should not have to learn the other, and a subsection exists here
   * purely because several entries share a `subsection` string, so this is the whole mechanism.
   *
   * Definition order is sidebar order, and a group renders where its first member appears — so
   * these three sitting together, after the Logistics & Trade entries, is what puts the group in
   * the right place.
   */
  /*
   * ★ THE CATALOGUE COMES FIRST — SQUADRON OWNER, 2026-08-03 ★
   *
   * "move the build types link in the navbar to be above New Project."
   *
   * Which is the right order for how the feature is actually used: you look up what a build costs
   * BEFORE you commit to posting one, and a member who has never done this needs the reference more
   * than they need the form.
   */
  /*
   * ★ PLANNING — SQUADRON OWNER, 2026-08-03 ★
   *
   * "add a new page to colonization called Planning."
   *
   * First in the group, because it is where a system starts: you lay one out before you fly there
   * to post the first construction site, and the two boards below are what that plan becomes.
   */
  /*
   * ★ SCOUT — SQUADRON OWNER, 2026-08-07 ★
   *
   * "can we build a tool ... that literally does what we just did here for this planning and
   * research and system selection?"
   *
   * Above Planning because it is the step BEFORE it: planning lays out a system already chosen,
   * scouting is the choosing.
   */
  {
    href: '/colonisation/scout',
    label: 'Scout',
    section: 'squadron',
    subsection: 'Colonisation',
    blurb: 'Find the next system worth claiming, and where its permit is bought.',
    requires: Permission.COLONY_VIEW,
  },
  {
    href: '/colonisation/planning',
    label: 'Planning',
    section: 'squadron',
    subsection: 'Colonisation',
    blurb: 'Lay out a whole system before you build any of it.',
    requires: Permission.COLONY_VIEW,
  },
  {
    href: '/colonisation/build-types',
    label: 'Build types',
    section: 'squadron',
    subsection: 'Colonisation',
    blurb: 'What every kind of construction site costs to build.',
    requires: Permission.COLONY_VIEW,
  },
  {
    href: '/colonisation/new',
    // "Start New Project", not "New project": a verb says it is something you DO, where a noun
    // reads as a place that lists them.
    label: 'Start New Project',
    section: 'squadron',
    subsection: 'Colonisation',
    blurb: 'Post a construction site so the squadron can help build it.',
    requires: Permission.COLONY_VIEW,
  },
  {
    href: '/colonisation/squadron',
    label: 'Squadron projects',
    section: 'squadron',
    subsection: 'Colonisation',
    blurb: 'What the squadron is building, and what it still needs hauled.',
    requires: Permission.COLONY_VIEW,
  },
  {
    href: '/colonisation/members',
    label: 'Members’ projects',
    section: 'squadron',
    subsection: 'Colonisation',
    blurb: 'Builds members have asked the squadron for help with.',
    requires: Permission.COLONY_VIEW,
  },
  {
    href: '/colonisation/owed',
    label: 'What you owe',
    section: 'squadron',
    subsection: 'Colonisation',
    blurb: 'Every commodity still outstanding across the builds you have joined, added up.',
    /*
     * ★ SQUADRON OWNER, 2026-08-23 ★
     *
     * "SrvSurvey will then show cargo items needed only for the primary or all projects."
     *
     * Sits with the two boards rather than after them by accident: those answer "what is the
     * squadron building", and this answers "what do I still owe" — the question somebody has open
     * while deciding what to fill a hold with, which is the most common reason to open this group
     * at all.
     */
    requires: Permission.COLONY_VIEW,
  },
  {
    href: '/colonisation/ownership',
    label: 'Station ownership',
    section: 'squadron',
    subsection: 'Colonisation',
    blurb: 'Which stations count as ours when the platform picks where to shop.',
    /*
     * ★ LAST, AND OFFICER-ONLY ★
     *
     * COLONY_MANAGE rather than COLONY_VIEW: a claim changes where the WHOLE squadron is sent to
     * buy, and the list names which officer said what — an officers' conversation either way.
     *
     * At the END of the subsection because it is a setting, not a destination. The five above are
     * places a member goes during an evening's play; this is opened when something is wrong with
     * how the shopping list ranks, which is rare and deliberate. Putting it fourth, between Build
     * types and Start New Project, sat an administrative page in the middle of the daily run.
     */
    requires: Permission.COLONY_MANAGE,
  },
  /*
   * ★ LOGISTICS & TRADE — SQUADRON OWNER, 2026-08-02 ★
   *
   * "create another subcategory under Squadron called Logistics & Trade please. the first thing i
   * want to build is a realt time commodities market ... this market will also be the basis for our
   * version of a trade route planner ... put that under the new subcategory too."
   *
   * The planner's name is the owner's pick from a shortlist: the Freight Office. It reads as a
   * PLACE you go to get hauling work, which is the same shape as Shipyard → Outfitter above.
   *
   * Both are gated on TRADE_QUERY, which guests now hold — "this will also be available to the
   * public for use". Sitting under `squadron` is not a contradiction: the section is where the
   * pages LIVE in the sidebar, and the permission is what decides who may open them. The Outfitter
   * has been exactly this since 2026-08-01.
   */
  {
    href: '/logistics/commodities',
    label: 'Commodities',
    section: 'squadron',
    subsection: 'Logistics & Trade',
    blurb: 'What every commodity is worth, where to buy it, and which way the price is moving.',
    requires: Permission.TRADE_QUERY,
  },
  {
    href: '/logistics/freight-office',
    label: 'Freight Office',
    section: 'squadron',
    subsection: 'Logistics & Trade',
    blurb: 'Plan a run: pick the cargo, the hull and the range, and get the route.',
    requires: Permission.TRADE_QUERY,
  },
  {
    href: '/ops',
    label: 'Operations',
    section: 'squadron',
    subsection: 'Command',
    blurb: 'Wings forming up, and what they need.',
    requires: Permission.OPS_VIEW,
  },
  {
    href: '/bgs',
    label: 'BGS',
    section: 'squadron',
    subsection: 'Command',
    blurb: 'The faction, its systems, and this week’s orders.',
    requires: Permission.BGS_VIEW,
  },
  /*
   * ★ THE SHIPYARD — SQUADRON OWNER, 2026-08-01 ★
   *
   * "a page under squadron called Shipyard that operates like the signature builder, 2 options
   * build my own or AI Assisted build" — and, refined: a subcategory called Shipyard with the page
   * named Outfitter.
   *
   * ★ GATED ON SHIPYARD_VIEW SINCE 2026-08-01 ★
   *
   * This shipped ungated, on the reasoning that working out what to save for is not a privileged
   * act and the data behind it is Frontier's own.
   *
   * That is an argument about the DATA, and the owner's instruction — "create the permissions for
   * the Shipyard category ... make them work the same as all other categories" — is about the
   * FEATURE. Being able to hold a page back from a rank while it is being tuned, or take it away
   * from one that is abusing it, is an operational control rather than a privacy one. Every member
   * holds SHIPYARD_VIEW in the preset, so nothing changes for anybody today.
   */
  {
    href: '/shipyard',
    label: 'Outfitter',
    section: 'squadron',
    subsection: 'Shipyard',
    blurb: 'Outfit any hull in the game, or let the assistant fit one to a budget.',
    requires: Permission.SHIPYARD_VIEW,
  },
  {
    href: '/shipyard/squadron',
    label: 'Squadron builds',
    section: 'squadron',
    subsection: 'Shipyard',
    blurb: 'What people here are flying, and how they fitted it.',
    requires: Permission.SHIPYARD_VIEW,
  },
  {
    href: '/shipyard/public',
    label: 'Public builds',
    section: 'squadron',
    subsection: 'Shipyard',
    blurb: 'Ships the squadron has published for anyone to use.',
    requires: Permission.SHIPYARD_VIEW,
  },
  /*
   * ★ LEADERBOARDS — SQUADRON OWNER, 2026-08-04 ★
   *
   * "make a new category called leaderboards ... gamify the colonization leaderboard, make badges
   * ect the same way were doing it for databounties ... then we also need to make a leaderboard and
   * gamify it for Trade routes make this work like the other ones too."
   *
   * One subsection, three boards, directly after the Data Bounties entry — the bounty hunt is what
   * feeds the first of them, and a group renders where its FIRST member appears (see the
   * Colonisation note above), so sitting here is what keeps the boards beside the game that scores
   * them.
   *
   * The three entries share one gate, TRADE_QUERY, and that is deliberate rather than lazy: the
   * boards are standings computed from market claims, colony deliveries and trade profit — squadron
   * activity data of the same sensitivity as the bounty board and the market pages, and one mask
   * governing all of it means taking the market away takes the scoreboards with it. Per-board
   * VISIBILITY of a member is their own choice, made in Commander Management, not here.
   */
  {
    href: '/leaderboards/bounties',
    label: 'Data Runners',
    section: 'squadron',
    subsection: 'Leaderboards',
    blurb: 'Who has been lighting up dark stations — staler pays more, jackpots pay double.',
    requires: Permission.TRADE_QUERY,
  },
  {
    href: '/leaderboards/colony',
    label: 'Colony Builders',
    section: 'squadron',
    subsection: 'Leaderboards',
    blurb: 'Who has hauled the most to colonisation projects, tonne by delivered tonne.',
    requires: Permission.TRADE_QUERY,
  },
  {
    href: '/leaderboards/trade',
    label: 'Trade Barons',
    section: 'squadron',
    subsection: 'Leaderboards',
    blurb: 'Who has banked the most realized trading profit — earned credits, not moved cargo.',
    requires: Permission.TRADE_QUERY,
  },
  {
    href: '/leaderboards/mining',
    label: 'Deep Core',
    section: 'squadron',
    subsection: 'Leaderboards',
    blurb: 'Who has refined the most — scored on what came out of the refinery, not what it sold for.',
    requires: Permission.MINING_VIEW,
  },
  {
    href: '/leaderboards/recruit',
    label: 'The Welcome',
    section: 'squadron',
    subsection: 'Leaderboards',
    blurb: 'Who brought people in — and whose recruits are still flying with us.',
    requires: Permission.RECRUIT_VIEW,
  },
  {
    href: '/leaderboards/bgs',
    label: 'Faction Hands',
    section: 'squadron',
    subsection: 'Leaderboards',
    blurb: 'Who has moved influence where the orders asked — and only where the orders asked.',
    requires: Permission.BGS_VIEW,
  },
  {
    href: '/forum',
    label: 'Forum',
    section: 'squadron',
    blurb: 'The boards. Where the squadron talks when it is not in Discord.',
    /*
     * FORUM_VIEW_MEMBER, not null.
     *
     * Squadron owner, 2026-07-29: "all forum users must be in our discord." The
     * nav entry follows the same rule as the content — somebody who cannot see a
     * single category should not be shown a door that opens onto nothing.
     *
     * Per-category `viewPerm` still governs what is behind it, so a future
     * public-readable category is a data change rather than a code one.
     */
    requires: Permission.FORUM_VIEW_MEMBER,
  },
  {
    href: '/roster',
    label: 'Roster',
    section: 'squadron',
    blurb: 'Who flies with the squadron.',
    requires: null,
  },
  /*
   * ★ THE CHANGELOG — EVERY MEMBER, NO GATE ★
   *
   * `requires: null` is deliberate: everything on this page is a description
   * of features members can already see by using the site, so a permission
   * here would refuse through one door what every other door gives away. The
   * one privileged thing on the page — the preview of a build that has NOT
   * deployed yet — is gated by the API (SITE_CONFIG on /v1/changelog/pending),
   * not by hiding the page.
   *
   * Under `squadron` and last in the section: it is about the platform the
   * squadron shares, but it is reference rather than a daily destination, and
   * placing it above the roster or the ops board would cost them attention
   * they earn every day.
   */
  /*
   * ★ THE ROADMAP — EVERY MEMBER, NO GATE ★
   *
   * The changelog's forward-looking sibling, and gated identically (`requires: null`) for the
   * same reason: the board describes what is being built for the platform the whole squadron
   * shares, and it exists to be READ by the people whose votes feed it — a suggestion published
   * to Feature Requests is voted on by members, and this is where those votes are seen to land.
   * The board's MANAGEMENT is a SITE_CONFIG-gated tab on the admin console; this entry is the
   * read-only window.
   *
   * Directly above the changelog, deliberately: "what is coming" reads best beside "what
   * changed", and both are reference rather than daily destinations, so they sit at the end of
   * the section where they cost the roster and the ops board nothing.
   */
  {
    href: '/roadmap',
    label: 'Roadmap',
    section: 'squadron',
    subsection: 'About',
    blurb: 'What is being built for the platform — from members’ ideas, through your votes, to shipped.',
    requires: null,
  },
  {
    href: '/changelog',
    label: 'Changelog',
    section: 'squadron',
    subsection: 'About',
    blurb: 'What each deploy changed — on the website, in the companion app, and behind the scenes.',
    requires: null,
  },


  // ---- personal ------------------------------------------------------------
  {
    href: '/settings/commander',
    label: 'Commander Mgmt',
    section: 'personal',
    blurb: 'Your name, verification, privacy, security and account.',
    requires: null,
  },
  {
    href: '/settings/devices',
    label: 'Companion app',
    section: 'personal',
    blurb: 'Pair a device and choose what it sends.',
    requires: null,
  },
  /*
   * ★ PRIVACY, SECURITY AND ACCOUNT ARE TABS NOW ★
   *
   * They were three more entries here and three more routes. Answering "how is
   * my account set up" took four page loads, and each of those pages carried a
   * "Related" panel whose only job was hopping between them.
   *
   * The companion app stays: it is not a setting, it is software somebody
   * downloads, and burying it three tabs deep is how nobody finds it.
   */

  // ---- GMSD AI -------------------------------------------------------------
  {
    href: '/gmsd-ai/ask',
    label: 'Ask GMSD AI',
    section: 'ai',
    blurb: 'Prices, systems, ships and our own guides — answered from squadron data.',
    /*
     * ★ AI_CHAT — squadron owner, 2026-08-01 ★
     *
     * "does the Ask GMSD AI page have controls in the permissions page ... so we can show and hide
     * the page when we need too?"
     *
     * It does now. This shipped with `requires: null` on the reasoning that everything the
     * assistant can reach is already visible to any signed-in member, so gating it would refuse
     * through one door what another door gives away.
     *
     * That was an argument about the DATA and the owner's question is about the FEATURE. The model
     * runs on the squadron's own card, alongside post screening and artwork; being able to take it
     * away from a rank — or hold it back while it is being tuned — is an operational control, not a
     * privacy one. `AI_CHAT` already existed for exactly this: "Converse with GMSD AI at all.
     * Without it, the panel is not offered."
     *
     * ★ CHECKED AGAINST THE REAL ROLE TABLE, NOT THE CONSTANT ★
     *
     * `AI_CHAT` is in the MEMBER mask in this file, but what governs access is `roles.perm_mask` in
     * the database, and the two are not the same thing — an earlier draft of this comment claimed
     * SQUADRON_STANDING_PERMISSIONS, which is false: that constant is only the two officer forum
     * bits.
     *
     * Verified: every role that grants ANY permission also grants AI_CHAT. The roles that do not
     * have it hold an empty mask, so those members cannot reach the forum, ops or fleet either —
     * gating this changes nothing for anybody who can currently reach a members' page.
     *
     * Worth re-checking after any role reshuffle. A permission that everybody happens to hold is
     * indistinguishable from one nobody needs, right up until somebody edits a mask.
     */
    requires: Permission.AI_CHAT,
  },
  {
    href: '/gmsd-ai/train',
    label: 'Help Train the Bot',
    section: 'ai',
    blurb: 'Send screenshots that teach GMSD AI to draw Elite.',
    /*
     * Gated on being able to SUBMIT, not on holding AI_TRAINING. A page whose only action is
     * refused is worse than no page — it advertises a feature and then says no.
     */
    requires: Permission.AI_TRAIN_SUBMIT,
  },

  // ---- admin ---------------------------------------------------------------
  {
    href: '/app',
    label: 'Admin console',
    section: 'admin',
    blurb: 'Members, roles and the state of the platform.',
    requires:
      Permission.MEMBER_MANAGE |
      Permission.ROLE_MANAGE |
      Permission.SITE_CONFIG |
      Permission.AUDIT_VIEW,
  },
  /*
   * ★ `/app/members` AND `/app/audit` ARE GONE — squadron owner, 2026-07-29 ★
   *
   * Neither page ever existed. Both were nav entries pointing at routes with no
   * `page.tsx` behind them, so every officer who clicked either one got a 404
   * from their own admin sidebar.
   *
   * The work lives in the console's TABS: members and their promotion standing
   * under `/app?tab=activity`, the log under `/app?tab=audit`. `/app` is
   * already in this list and already requires one of the four admin
   * permissions, so nothing became unreachable by removing these.
   *
   * `/app/roles` stays. It IS a real page — it has its own tabs now, and it is
   * the only surface that can edit a permission mask.
   */
  /*
   * ★ `/app/members` IS BACK, AND THIS TIME THE PAGE EXISTS ★
   *
   * The note above records why it was removed: it was a nav entry pointing at a route with no
   * `page.tsx`, so every officer who clicked it got a 404 from their own sidebar.
   *
   * Squadron owner, 2026-08-01: "we need to create a full on member roster that shows every member
   * in our discord with full administrative tools for them, kick, ban, timeout blah blah blah.
   * create a new Squad Members page in the administration category".
   *
   * `apps/web/src/app/(hub)/app/members/page.tsx` was written in the same change as this line. The
   * lesson from last time is not "never add a nav entry" — it is that the entry and the page ship
   * together or neither does.
   */
  {
    href: '/app/members',
    label: 'Squad members',
    section: 'admin',
    blurb: 'Everybody in the Discord server, and the tools to moderate them.',
    requires: Permission.MEMBER_MANAGE,
  },
  {
    href: '/app/roles',
    label: 'Roles',
    section: 'admin',
    blurb: 'Who holds what, and what each role grants.',
    requires: Permission.ROLE_MANAGE,
  },
  /*
   * ★ ITS OWN PAGE, NOT A TAB — squadron owner, 2026-07-30 ★
   *
   * "include the AI training page in the Administration Category as a new page,
   * show the ingestion categories, if it has been trained, if it is training,
   * and when the next ingestion cycle will be in hours."
   *
   * The admin console's tabs are all about MEMBERS. This is about what the
   * assistant knows and when it last learned it, which is a different question
   * asked by different people — and it is the surface that answers "why did the
   * AI not know that", which otherwise has no answer anybody can look up.
   */
  {
    href: '/app/training',
    label: 'AI training',
    section: 'admin',
    blurb: 'What GMSD AI has learned, what it is learning, and when it next will.',
    requires: Permission.AI_TRAINING,
  },
  {
    href: '/app/conversations',
    label: 'AI conversations',
    section: 'admin',
    blurb: 'What members asked GMSD AI, and what it answered.',
    /*
     * ★ AI_REVIEW, WHICH THE WEBMASTER ALWAYS HAS ★
     *
     * Squadron owner: the log "need[s] to be visible to the webmaster role! this is non-negotiable
     * as the webmaster is the AI developer." That override lives in `effectiveMask`, so using the
     * ordinary permission satisfies it — a separate webmaster check here would be a second answer
     * to a question that already has one, and the two could drift.
     */
    requires: Permission.AI_REVIEW,
  },
];

/**
 * The destinations this mask can reach, in render order.
 *
 * ★ THE FIELDS ARE LISTED, NOT SPREAD — AND THAT COSTS SOMETHING ★
 *
 * Rebuilding each item by name is deliberate: `requires` is a permission mask and must not travel
 * to the browser, and `...rest` would have shipped it the moment anybody added a field.
 *
 * The cost is that a NEW display field is silently dropped unless it is added here. That is not
 * hypothetical — `subsection` was added to the interface, set on the Shipyard entry, and rendered
 * by a sidebar that handled it correctly, and the feature was still dead: this function never
 * copied it, so no member would ever have seen the subcategory. `nav-shape.spec.ts` now fails if
 * any displayable field goes missing here.
 */
/**
 * Counts to show beside sidebar entries, keyed by href.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we also need to add this notification/badge to the web site too" — the companion has carried
 * these since colonisation shipped and the website never has.
 *
 * Passed in rather than computed here, because this function is pure and has no database. It is
 * also what keeps the badge from becoming a side channel: the filter below runs FIRST, so a count
 * for a page a member cannot reach is simply never rendered (INV-002).
 */
export type NavBadges = Readonly<Record<string, number>>;

/**
 * The governed destinations this mask CANNOT reach.
 *
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "why are the operations and BGS panels are not being protected by the roles and permissions... we
 * literally have these rules in place but those pages are still appearing for everyone"
 *
 * The rules were in place and they were being applied to exactly one of the two things that need
 * them. `navFor` hides the sidebar link, and the API refuses the data with a cloak-404 — so no
 * squadron information ever leaked. What nothing checked was the PAGE. Typing `/ops` served the
 * whole shell to any signed-in member, and because the API then refused the fetch, what they saw
 * was "could not load the operations board" — a page that looks broken rather than one that is not
 * theirs.
 *
 * ★ WHY THE DENIAL LIST AND NOT A SECOND PERMISSION CHECK IN THE WEB APP ★
 *
 * A page guard written separately from the sidebar is a second copy of the same rule, and the two
 * would drift the first time a permission changed — with the drift invisible, because a page that
 * wrongly allows looks identical to one that correctly allows. Derived from the same `requires`
 * that builds the sidebar, they cannot disagree: a page is reachable exactly when its link is.
 *
 * Hrefs only. The mask itself must not travel to the browser, for the same reason `navFor` lists
 * its fields rather than spreading them.
 */
export function navDeniedFor(mask: PermissionMask): string[] {
  return NAV.filter(
    (item) => item.requires !== null && !hasAnyPermission(mask, item.requires),
  ).map((item) => item.href);
}

export function navFor(mask: PermissionMask, badges: NavBadges = {}): NavItem[] {
  return NAV.filter((item) => item.requires === null || hasAnyPermission(mask, item.requires)).map(
    ({ href, label, section, subsection, blurb }) => ({
      href,
      label,
      section,
      blurb,
      /*
       * Zero is deliberately NO badge rather than a "0". A grey nought beside every link is clutter
       * that teaches members to stop reading the numbers at all, and "nothing to say" is what the
       * sidebar should look like most of the time.
       */
      ...(typeof badges[href] === 'number' && badges[href] > 0 ? { badge: badges[href] } : {}),
      // Conditional, not `subsection: subsection` — `exactOptionalPropertyTypes` forbids assigning
      // undefined to an optional field, and an explicit `"subsection": undefined` in the JSON is a
      // different shape from its absence.
      ...(subsection === undefined ? {} : { subsection }),
    }),
  );
}

/** Does this member have an admin area to go to at all? */
export function hasAdminArea(mask: PermissionMask): boolean {
  return navFor(mask).some((item) => item.section === 'admin');
}
