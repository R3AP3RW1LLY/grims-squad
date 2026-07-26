# ADR-006 — Build the forum, don't SSO into Discourse

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §7.2 (assumption A6), §15.5

## Context

The forum is the core social object of the site and the phase whose exit criterion is literally "real members are using it". Two viable routes: build it, or run Discourse and act as its SSO provider, mapping permission masks to Discourse groups.

Discourse is mature, battle-tested, and free. Building a forum is a well-understood but non-trivial 4–6 sessions of work. The argument turns entirely on two capabilities that Discourse cannot provide.

## Decision

**Build the forum natively in the application.**

The two decisive capabilities:

1. **ED-native embeds.** Paste a Coriolis or EDSY URL and get a live build card with jump range, DPS, shield HP and cost. Write `[[Sol]]` and get a hover card with allegiance, economy, distance from home and station list. Mention a commodity and get its current best buy/sell *with a freshness badge*. These require the forum renderer to sit inside the application, with access to `packages/ed-domain` and our own market data. In Discourse they would be a plugin maintained against someone else's upgrade cycle, in a different language, without our data.
2. **One unified, ACL-correct RAG index.** GSAI must search forum posts, wiki pages, doctrine builds and AARs as one corpus, with `knowledge_chunks.visibility` mirroring each source's ACL (ADR-015). With Discourse, forum content lives in a separate database behind a separate permission model, and reconciling the two ACLs into one vector index is precisely the kind of seam where leaks happen.

Also decided here:

- **Nested categories with per-category `viewPerm` / `postPerm` masks**, enforced through the ADR-005 data layer. A Ring 0 user must not be able to see, count, or infer the existence of a Ring 1 category.
- **Search is Meilisearch, ACL-filtered at query time from the caller's mask** — filtered *in* the query, not after retrieval. Post-filtering leaks through result counts and pagination.
- **The Discord bridge is thread-level only.** Site → Discord posts an embed with a jump link; Discord → site provides a `/thread` slash command. **Message-level bidirectional mirroring is explicitly rejected** (below).
- Markdown stored plus a pre-rendered, server-side-sanitized HTML column. DOMPurify server-side, strict CSP with nonces.

## Consequences

**Positive**
- Embeds and unified AI search are what make this "the hub" rather than "a forum next to some tools".
- One permission model, one database, one deployment, one backup.
- Post kinds can be first-class domain objects: an `ops` thread creates an operation record; an `application` thread drives the recruitment pipeline; a `question` thread has an accepted answer.

**Negative / accepted costs**
- **We now own forum software**, including moderation tooling, spam handling, notification fan-out, draft autosave and edit history. This is the single largest build in the project outside GSAI.
- We will miss features Discourse users take for granted. Accepted: the category tree in `02-domain/rings-and-roles.md` is deliberately modest.
- XSS is now our problem. Mitigated by a mandatory XSS test suite at P2.2 covering script tags, event handlers, `javascript:` URLs and SVG payloads, and by CSP with nonces.
- Uploads are our problem: EXIF stripping, image re-encoding to neutralise polyglots, and serving from a separate origin.
- Reputation stays deliberately light (post count, accepted solutions, reactions). Heavy gamification breeds noise.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Discourse with our API as SSO provider** | Loses ED-native embeds and the unified AI index — the two things that justify a site at all. Adds a second database, a second permission model, a second upgrade cycle, and a Ruby runtime to a TypeScript-everywhere project (ADR-001). |
| **Discourse plugin to add the embeds** | Plugin maintained in Ruby against upstream's release cadence, with no access to our market data or `ed-domain`. All the cost of building, none of the ownership. |
| **Use Discord threads/forums as the forum** | No ACL granularity beyond channel permissions, no search we can ACL-filter, no long-form structure, nothing to index for RAG, and content is unrecoverable if the server is lost. Discord stays the *interface*, not the substrate. |
| **NodeBB or Flarum** | Same seam problems as Discourse with a smaller ecosystem. |
| **Message-level bidirectional Discord ↔ forum mirroring** | Sounds excellent, is a permanent support burden: identity mapping, edit/delete propagation, attachment duplication, loop prevention, formatting mismatches, and a moderation model that has to work in both directions. Explicitly rejected in `scope.md`. |
| **Filtering search results after retrieval** | Leaks existence through result counts, facet counts and pagination. Filter in the query. |
