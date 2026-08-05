---
title: Setting up and managing two-factor
surface: website
route: /settings/commander
---
Signing in to the hub takes one step — your Discord account. A second factor is required only to open the admin console, because those accounts can grant roles and change how the site works. The "Security" tab in Commander Mgmt is where the authenticator is managed.

To enrol:

1. Press "Set up two-factor". Any authenticator app works — Aegis, Ente Auth, 1Password, Google Authenticator.
2. Step 1: scan the QR code with your app. The "Can't scan it?" disclosure reveals the manual key, and a link opens it in an authenticator on the same device.
3. Step 2: enter the "Six-digit code" your authenticator shows. It confirms as soon as the sixth digit lands.
4. Save the recovery codes shown next — they are shown once. "Copy codes" copies them.

Once enrolled, the tab reads "Two-factor is on." and you will be asked for a code when you open the admin console. Two buttons manage it:

- "Move to a new authenticator" — changing phones? This removes the old one and sets the new one up in a single step, and gives you fresh recovery codes.
- "Remove it" — removes the authenticator.

Both ask for a code from the authenticator you are leaving, right then — a stepped-up session from earlier does not stand in for it. If the authenticator is gone, the "I have lost my authenticator — use a recovery code" link switches the field to "Recovery code".

If your account can open the admin console, removing your authenticator closes the console until you set one up again; everything else on the site keeps working. Removal never touches your roles or permissions.

Accounts with elevated permissions are taken through enrolment during onboarding, before anything else.

Related: commander-management, sessions-and-your-data, commander-onboarding
