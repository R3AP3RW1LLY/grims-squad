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
