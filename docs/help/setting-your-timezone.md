---
title: Setting your timezone
surface: website
route: /settings/commander
---
Discord does not tell the site where in the world you are, so your timezone is the one thing it has to ask for. You pick it once during onboarding, and can change it any time.

1. Open Commander Mgmt (the "Commander settings" tab).
2. In "Times and dates", pick from the "Your timezone" select. A live clock renders underneath so you can confirm the choice is right.
3. There is no save button — the change saves the moment you pick, and the page shows "Saved."

What it affects: every time on the site renders in this zone — when a device last uploaded, when you were verified, when an operation starts. The colonisation delivery chart cuts its daily buckets in your zone, so a delivery at 21:00 your time lands on the right day's bar, and the delivery ledger captions itself "Times in {your zone}". The one exception is the audit log, which is always UTC so officers in different countries can compare the same event without converting anything.

On the roster, dates you read (like when somebody last flew) use your zone, while each member's card also shows their own timezone with a live local clock — that is a fact about them, not about you.

Until you set one, the site uses UTC. The picker only accepts real IANA timezones; anything else is refused with "That is not a timezone we recognise. Pick one from the list."

Related: commander-onboarding, deliveries-and-the-delivery-chart, the-roster
