# Decisions

## D25 — the members' area lives at `/app` on the apex, not on a subdomain
**Decided 2026-07-27.**

Considered `app.grims-squad.com`. sslip.io and Let's Encrypt both support it, so
it was technically free — but a subdomain is a different ORIGIN, and the session
cookie uses the `__Host-` prefix, which forbids a `Domain` attribute entirely.
Sharing the session across apex and subdomain would mean dropping `__Host-` and
setting `Domain=.grims-squad.com`, which hands the session to every subdomain
that will ever exist.

Same origin keeps `__Host-`, needs no second certificate, and avoids CORS on
every API call. The path costs nothing that the subdomain would have bought.

## D26 — game-activity checks FAIL OPEN
**Decided 2026-07-27.**

When Inara or EDSM cannot be reached, the month counts as qualifying. Our outage
must not cost a member a promotion.

The safeguard is provenance, not refusal: a month counted this way is stored as
`assumed`, never `observed`. The audit row and the admin dashboard both show
which it was, so a promotion granted on an assumption is never mistaken for one
earned on evidence — and a run of `assumed` months is a visible signal that the
integration is broken rather than that everyone suddenly became active.

A member with NO linked CMDR name is a separate case and is NOT eligible:
that is missing configuration, not an outage, and it is surfaced on the
dashboard so an officer can fix the cause.

## D27 — the companion app is Electron, and it is OPTIONAL

**Human instruction, 2026-07-27: Electron, non-negotiable.** Tauri was proposed
on binary-size and memory grounds and rejected. Recorded so the trade reads as
deliberate rather than overlooked — Electron carries a Chromium runtime, so
installers are ~100MB rather than a few, in exchange for the most widely
understood desktop stack in the ecosystem and packaging paths that are already
trodden flat.

The app collects JOURNAL data, which is what replaces Frontier cAPI. It is not
a market client: market prices come from EDDN, which thousands of players
already feed and which `apps/eddn-collector` consumes, so whether our members
run any particular tool barely affects our coverage.

**Optional, permanently.** The website stays complete on its own and anyone who
will not install a binary is verified by an officer and holds a full rank. The
moment the app becomes a prerequisite we have excluded people for the
convenience of automation.

See ADR-022.

## D28 — a refresh token replayed within 30 seconds is a RACE, not a theft
**Decided 2026-07-29** (options put to the squadron owner, who chose the grace window).

Strict rotation treated the second presentation of a refresh token as theft and
revoked the family. Correct when the two uses are minutes apart; wrong when they
are milliseconds apart — and milliseconds apart is the ordinary case. Two tabs
both noticing an expired access token, a retried request whose first attempt did
reach the server, the companion app and the website refreshing at once. Every one
of those signed a member out and told them their session ended "for security
reasons", which was alarming and untrue.

Outside the window nothing changed: a replay still revokes the family and still
raises the alarm. A family already revoked is never revived, and the absolute
fourteen-day deadline is unaffected.

**The grace does NOT return the token the first call produced, and cannot.** Only
the SHA-256 of a refresh token is stored — the plaintext is returned once and
forgotten. Keeping a copy to replay would mean holding a live credential in the
clear, which is worse than the problem. The racing caller gets a NEW token from
the same family; both tabs end up working, which is the outcome that was wanted.

Rejected: a longer access-token TTL. It makes the race rarer rather than correct,
and lengthens how long a stolen token is useful.

## D29 — a live event that reaches everybody may never name anybody
**Decided 2026-07-29.**

A verification is not only news to the member it happened to: the roster shows a
verified badge for every member, the admin console has a CMDR verified column,
and the dashboard's title IS the verification state. A member-scoped event
reaches only that member's own tabs, so the squadron went on seeing them
unverified until somebody reloaded.

Two events are published. A `verification` event carrying the member's id, to
their own tabs; and an anonymous `roster` event carrying `userId: null`, to
everybody.

The distinction is the whole point. "The roster changed" is not "this person just
proved their commander name", and the second would be a disclosure to a hundred
browsers. Pages re-read through the normal endpoints with the normal permission
checks, so nothing is revealed that the viewer could not already have fetched.
The bridge refuses an event with a MISSING userId rather than treating it as
squadron-wide — "everybody" and "we forgot to say who" must not be one message.

## D30 — the update notice is keyed to a VERSION MISMATCH, never to a recent release
**Decided 2026-07-29**, after the squadron owner reported members being nagged
after every rebuild.

Three causes, all ours. The banner fired on the ABSENCE of evidence, so a member
with no app installed — or whose app had not yet reported — was told to update
software they might not have. The app was told the newest version by sorting
version STRINGS, so `0.10.0` would have sorted below `0.9.0` and updates would
have stopped being announced from the tenth release, silently. And the website
took the most recently BUILT installer, so a rebuild at the same version moved
the release date and restarted the fortnight-long banner for people who were
already current.

The rule now requires evidence of being BEHIND: a version the app has actually
reported, that is genuinely older than the highest published one. The fourteen
days is an upper bound on nagging, never the reason for it.

This is why the companion reports its own version at all — see D31.

## D31 — the app reports its version on a poll it already makes
**Decided 2026-07-29.**

The website cannot stop offering an update to somebody who has installed it
without knowing what they are running, and nothing recorded that. The release
bucket knew the newest version; the account knew nothing about the installed one.

Reported on the five-minute settings poll rather than a new endpoint: no extra
request, no second credential, and it self-corrects within minutes of an update.
Stored per DEVICE, because somebody with a desktop and a laptop can have updated
one and not the other.

The value is validated before storage — it is written by a client we do not
control and is displayed back to the member. `undefined` and `null` are
deliberately different: a route that does not send the header leaves the stored
value alone rather than wiping it.

## D32 — "not downloadable" is a bar, not a seal, and the code says so
**Decided 2026-07-29.** The squadron owner asked that the logo assets not be
downloadable from the website at all.

That is not achievable and pretending otherwise would be worse than declining. A
browser cannot paint an image it has not received: by the time anybody sees the
logo the bytes are in their cache, their network panel and their page source.
Developer tools get the file and a screenshot needs no tools.

What is enforced: right-click save, drag-to-desktop and iOS long-press are taken
away on the element; a request for `/brand/...` that is a NAVIGATION
(`Sec-Fetch-Dest: document`) or CROSS-SITE is answered 404.

Requests carrying no fetch metadata are deliberately ALLOWED. The first version
refused them and broke every brand image on the site — `_next/image` fetches the
source over HTTP from the server to itself and sends none, so the optimiser
answered "not a valid image" while the markup still held the right URL. Refusing
them also only stops `curl` with no arguments, which one header defeats.

Recorded as a decision because a protection believed to be absolute is one
somebody later relies on absolutely.

## D33 — a backup is not a backup until the BUCKET confirms it
**Decided 2026-07-29**, after five consecutive zero-byte backups.

Between 27 and 28 July the vault bucket accumulated five objects of zero bytes
while the log recorded a successful upload with a real byte count for each. The
cause was a shared bucket variable, fixed separately. The reason nobody noticed
for two days is that every check the script made — size, decryptability, table
count, completion marker — interrogated the LOCAL file, and it then logged that
local size as though it described the object in the bucket.

`aws s3 cp` exiting 0 is the storage provider's opinion. The script now reads the
object back with `head-object` and compares; anything but an exact match is fatal.

The general rule: a job that reports success must verify the thing it claims to
have produced, at the place it claims to have produced it.

## D34 — every forum user must be in the squadron's Discord
**Squadron owner's decision, 2026-07-29**, after weighing public posting and a custom captcha.

Considered: letting the general public post behind a captcha, with a bespoke
captcha built in-house. Both were declined in favour of Discord membership as the
requirement, and the reasoning is worth keeping because it will be asked again.

**It is enforced structurally, not by a check.** `ForumThread.authorId` and
`ForumPost.authorId` are NOT NULL with a required relation to `users`, and the only
way to hold a user row is Discord OAuth against the guild. There is no
representation for an anonymous author, so there is no code path that could forget
to guard one. Anonymous posting would have needed a schema change — a nullable
author or a synthetic guest — and with it a second answer for moderation,
notifications and the ACL.

**Why not the custom captcha.** Turnstile is already the decided mechanism, in
ADR-010, `00-charter/constraints.md`, `02-domain/user-journeys.md`,
`04-contracts/openapi.yaml` and P2.7's acceptance — five places, and it protects
the PUBLIC APPLICATION FORM, which is how a member of the public is already
designed to reach us. A home-rolled captcha would replace a working decision with
one that commodity vision models defeat, and would carry the accessibility burden
that Turnstile already solves.

**The safeguarding reason, which outranks the rest.** The squadron includes minors
(D15), and `00-charter/constraints.md` makes protective defaults binding rather
than advisory. Anonymous posting into a space shared with minors is precisely what
those defaults exist to prevent.

**What the public CAN still do.** Apply, through the Turnstile-protected form that
creates an application thread (P2.7) — the designed public entry point. And read
any category whose `viewPerm` is null. That capability is retained deliberately:
the schema has always supported a public-readable category, and removing it would
be a schema change made on an inference rather than an instruction. Every category
seeded today requires `FORUM_VIEW_MEMBER`, so the board is members-only in
practice while a public board remains one row away.
