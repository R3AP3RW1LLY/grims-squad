---
title: Reading the companion app's Status page
surface: companion
route: Status
---
"Status" is the app's front page: what it is doing, right now and over its lifetime.

The "Uplink" section shows three lifetime counters — "Events sent", "Already held" (events the squadron had before you sent them; harmless, and expected after a re-pair), and "Journals read". The button beside the heading reads "Pause sending" while the app is sending and "Start sending" while it is paused; the tray menu carries the same control.

Under the counters is the game line: "Elite is running." or "Elite is not running." The app decides this from the game process plus two signals: fresh journal writes, and the game's own Status.json heartbeat. The heartbeat is what keeps you counted as in-game during the quiet stretches — outfitting, the galaxy map, a long supercruise — when the journal goes silent. Sitting in the main menu does not count as running.

"Recent activity" lists the last dozen things the app did, newest first: lines like "{n} events from your journal", "{n} events the squadron already had", "{n} new journals picked up", "Elite Dangerous is running — watching for new entries", and "Discarded, because you switched these off: …" when your telemetry settings refused something. Quiet passes log nothing.

How sending works underneath: the app checks your journal folder every 20 seconds and reads only the bytes added since last time. An upload that fails is retried — the same window is re-read and re-sent, so nothing is lost — and repeated refusals back off gradually, with the activity line saying when it will try again. If you see "This device is no longer paired. Pair it again from the website.", the device was removed on the website; press "Sign in" to pair again.

Related: installing-and-pairing-the-companion-app, companion-settings, what-the-companion-app-uploads
