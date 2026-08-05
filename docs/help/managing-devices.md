---
title: Managing paired companion devices
surface: website
route: /settings/devices
---
The "Companion app" page in your personal sidebar section is where paired devices are listed, telemetry choices are made, and the app itself is downloaded.

"Paired devices" lists each machine running the companion app: its name, and either "Never used — it has not sent anything yet." or when it last sent, in your timezone. The "Remove" button unpairs a device immediately — the app on that machine loses its access and would need to sign in again.

Pairing starts in the app, not on this page. There is no code to type here: open the companion app, choose "Sign in with Discord", and approve it in the browser window it opens. That window is the "CONNECT THE APP" page, which names the machine asking so you can see what you are approving. Nothing to copy and no key to keep safe. The empty state on this page says exactly that: "No devices yet. Open the companion app and choose Sign in with Discord — it will bring you back here to confirm."

The "Download" section carries builds for Windows, macOS and Linux, served from the squadron's own API. Each card reads "Download for Windows" / "Download for macOS" / "Download for Linux" with its size and version. Elite has had no native Mac client since 2015 and none on Linux, so those builds read journals from CrossOver, Whisky or Proton. The builds are not code-signed yet, so Windows and macOS both warn the first time you run one: on Windows choose "More info" then "Run anyway"; on macOS right-click the app and choose "Open".

The rail's "Status" panel shows your paired-device count, "Last upload", and "Switched off" — how many telemetry categories and events you have turned off in the "What is collected" section below.

Related: installing-and-pairing-the-companion-app, what-the-companion-app-uploads, companion-settings
