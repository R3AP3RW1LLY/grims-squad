# MISSION

## What this is

One application that replaces the scattered toolchain a squadron juggles today — Discord + an Inara page + Coriolis links + Spansh bookmarks + a Google Sheet — with a single hub that knows who you are, what the galaxy looks like right now, and what the squadron needs tonight.

## Who it serves

| Audience | Ring | What they come for | Their failure mode if we get it wrong |
|---|---|---|---|
| Prospective recruit | 0 | Does this squadron look alive and worth joining? | Bounces off a dead-looking page; we never hear from them |
| Applicant | 0.5 | Where is my application, what happens next? | Silence; drifts away before approval |
| Member | 1 | What should I do tonight; where do I make credits; what's our BGS state; where's the carrier | Opens Discord instead, and the site dies of disuse |
| Wing lead | 1.5 | Who is available, who has the right ship, can I fill this op | Runs ops from a spreadsheet |
| Officer | 2 | Set direction, moderate, review applications, see the truth about member activity | Makes decisions on vibes |
| Squadron leader / sysadmin | 2+ | Is the whole thing healthy, is it costing me my evenings | Burnout; project dies with a single maintainer |

## Success criteria

Ordered. Each is measurable and each must hold before the next matters.

| # | Criterion | Measure | Gate |
|---|---|---|---|
| S1 | Members can log in and see exactly what their Discord role entitles them to, with no manual account admin | Discord role change visible on site within 5 s; zero manual role edits needed in a month | P1 exit |
| S2 | The community actually moves in | ≥60% of active members post or react in the forum within 30 days of P2 exit | P2 exit |
| S3 | The site knows what CMDRs are doing without anyone typing it in | ≥3 members running the EDMC plugin, telemetry arriving, EDDN collector stable 24 h+ | P3 exit |
| S4 | A member opens the site to find out what to do tonight | BGS orders board viewed by ≥50% of active members in the week after a tick | P4 exit |
| S5 | Ops run through the site rather than through pinned Discord messages | One real op scheduled, filled, run and AAR'd end-to-end on the site | P5 exit |
| S6 | "Where do I make credits tonight" is answered here | Route query <2 s on a populated DB, spot-checked accurate in-game | P6 exit |
| S7 | Squadron ship doctrine is written down and checkable | Doctrine builds published per role; fleet query returns correct matches | P7 exit |
| S8 | GSAI is useful, not a demo | ≥75% tool-call reliability; fast path serves ≥60% of queries with no LLM; ACL leak test passes | P8 exit |
| S9 | It survives its maintainer | Restore test passes monthly; a second admin holds credentials; every runbook current | standing |

## What "good" looks like on any given evening

A member opens the dashboard. It says: tonight's BGS priority is Ross 128 (push, priority 1, "run massacre missions for us, not bounties"), there's a mining op at 20:00 UTC needing two more prospectors and their Python qualifies, the carrier is 8,000 t of tritium short of Saturday's jump, and Tritium is selling at 51,200 Cr/t at a station 14 ly away with data 3 hours old. They act on it, and the site records that they did — without them filling in a single form.

## Non-goals

Stated here so they are never re-litigated as features. The full list is in `scope.md`.

- Not a replacement for Discord. Discord stays the interface; this is the substrate. Every notification, order, and AI answer appears in Discord with a link back.
- Not a commercial product. No paid tiers, no ads, no selling access (`constraints.md`, ADR-009).
- Not a general ED wiki, galaxy map, or Inara clone. Where the community already does something well, we link to it and spend our effort on the squadron-specific value that nobody else can provide.
