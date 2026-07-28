# ADR-023 — The companion app becomes the full desktop client

**Status:** Accepted · **Date:** 2026-07-27 · **Supersedes part of:** ADR-022

## Decision

The Electron companion is not a journal uploader with a settings window. It is
**the desktop version of Grim's Squad HQ**, offering everything the website
offers, plus the things only a native app can do.

This is a standing direction rather than a single piece of work: every feature
added to the web app from here is added to the desktop app too, in the same
pass, and "web only" is a decision that needs a reason.

## Why

The journal watcher already has to run in the background on a member's PC. Once
a program is installed and running, asking somebody to open a browser to see the
roster, read the forum or check their rank is asking them to use two things
where one would do — and the one they already have open is the one that knows
they are playing right now.

There is also something the website structurally cannot do: the app knows what
is happening in the game *as it happens*. A jump, a docking, a squadron message
arriving while somebody is in the middle of a fight. That is the difference
between a website you visit and a client you fly with.

## How, without maintaining everything twice

★ **THE APP HOSTS THE WEB UI. IT DOES NOT REIMPLEMENT IT.** ★

The desktop client loads the real site in a `BrowserView` with the member's
session, wrapped in native chrome — tray, notifications, deep links, the journal
watcher, and a status bar that knows whether the game is running.

The alternative is a second front end: every page written twice, every fix
applied twice, and a desktop app that is permanently three features behind the
website. That is how companion apps die. One UI, two shells.

Native-only surfaces — pairing, the journal folder, what gets sent, the preview
of a real batch — stay local HTML, because they are about the app itself and
must work before anybody has signed in.

### Consequences

- The app needs an authenticated session. It gets one the same way a browser
  does: the member signs in through Discord in a real window they can inspect.
  The device token stays what it is — `telemetry:write` and nothing more — and
  is **not** widened into a session credential.
- The hosted view must be pinned to our own origin. A `BrowserView` that will
  follow any link is a browser with no address bar, which is the worst possible
  thing to hand somebody. External links open in the real browser.
- Offline is a state the website never has to think about and the app does. A
  page that cannot load must say so, not show an empty roster.

## What this does not change

The app remains **entirely optional**. Everything the squadron does works from a
browser, on a phone, with no install. A member who never runs it is a member in
good standing — the app is a better way in, not a gate.
