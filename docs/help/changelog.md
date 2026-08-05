---
title: Reading the changelog and version numbers
surface: both
route: /changelog
---
The Changelog page, at the bottom of the Squadron section of the sidebar, records every deploy the moment it goes live: what changed on the website, what changed in the companion app, and what changed in the platform behind them — in the words of the people who built it, newest first. It is readable without signing in.

Each release card is headed by its version ("v0.5.0 —") and the deploy time in both your local time and UTC. Changes are grouped under three headings — "Website", "Companion App", "Platform" — and a change touching two surfaces appears under both. Empty groups are omitted.

The website and the companion app share one version number. You will find it in the website sidebar's footer as a "v{version}" link straight to this page, and in the companion app's own window.

When a companion release is newer than what one of your paired devices is running, two things tell you:

- The "Companion app" row on Commander Mgmt reads "v{yours} — v{latest} available". Its other states are "Not installed", "Waiting for the app" (paired, but the app has not reported its version yet — it checks in every five minutes), or simply your version when you are current.
- A site banner appears when a device of yours has reported an older version and the release is under 14 days old. Dismissing it dismisses that version only; the next release brings it back. The app also keeps itself current on its own — it checks hourly and installs updates while Elite is closed — so the banner mostly marks time until that happens.

Officers holding site configuration permission additionally see a "Pending — built, not yet deployed" panel previewing the release that is built but not yet live, with its version.

Related: managing-devices, companion-settings, commander-management
