# TEST STRATEGY

Companion to `tdd-policy.md` (the *when*) — this is the *what and where*.

## The shape

```
       ╱ e2e ╲            thin — the critical journeys only
     ╱─────────╲
   ╱ integration ╲        SUBSTANTIAL — deliberately fatter than usual
 ╱─────────────────╲
╱       unit        ╲     broad — all pure logic
```

**The integration layer is deliberately heavy here, and that is not laziness.** The project's primary authorization control lives in the **data layer** (ADR-005, INV-002). A unit test with a mocked database *cannot* prove that a Ring 0 principal is incapable of retrieving a Ring 1 row — it can only prove that the mock returned what the mock was told to return. The security model is verified in integration tests or it is not verified.

## Layers

| Layer | Runs against | Suffix | Speed | What belongs here |
|---|---|---|---|---|
| **unit** | nothing external | `.spec.ts` | ms | Permission maths, ship maths, chunking, parsers, formatters, freshness banding, param-hash normalisation |
| **integration** | ephemeral PG + Redis + Meilisearch | `.int.spec.ts` | seconds | **Every ACL boundary**, repositories, services, migrations, generated columns, partial indexes, the materialised view, queue processors |
| **e2e** | full stack | `.e2e.spec.ts` | tens of seconds | The journeys in `02-domain/user-journeys.md`, and only those |
| **contract** | recorded fixtures | `.contract.spec.ts` | ms | Adapter parsing against captured real responses |
| **live** | the real third party | `.live.spec.ts` | slow | **Explicitly run, never in CI.** Verifies an `@unverified` adapter against reality. |

## Coverage floors

Floors, not goals. **Gaming a floor with assertion-free tests is a review-blocking defect** (`tdd-policy.md`).

| Package / app | Statements | Why this number |
|---|---|---|
| `packages/shared` | **95%** | Permission maths. A gap here is a security gap. |
| `packages/ed-domain` | **90%** | Ship maths members act on; also an AI tool |
| `packages/ed-clients` | 80% | Adapter logic; the network is faked |
| `packages/ai-tools` | 85% | The AI's capability boundary |
| `packages/db` | 75% | Mostly generated; the ACL extension is separately at 95% |
| `apps/api` | 80% | |
| `apps/api/src/auth**`, `src/authz**` | **95%** | Security-critical |
| `apps/worker` | 75% | |
| `apps/eddn-collector` | 85% | Silent corruption risk |
| `apps/bot` | 70% | Much is Discord-side |
| `apps/web` | 60% | Behaviour and a11y matter more than line coverage |
| `apps/gsai` | 80% | |
| **Invariant coverage** | **100%** | **Every INV-nnn has a passing tagged test. Not negotiable.** |

## The must-have test corpus

Tests whose absence is a defect regardless of coverage numbers.

### Authorization — the largest cluster, deliberately
- Every ring boundary, both directions, **at the repository level, bypassing every controller and guard**
- Deny mask beats grant, per permission group
- A gated resource returns **404, not 403** — a 403 confirms existence
- Search returns **zero** hits, zero facet counts and no pagination total for gated content
- **A permission cache busts on every mutating path**: `guildMemberUpdate`, role grant, role mask edit, mapping edit, deny-mask edit
- **A WebSocket subscription drops on demotion** — a long-lived socket keeping Ring 1 channels after a role change is the obvious way to leak
- Ownership predicates: own loadout, own carrier, own application thread, own AI conversation

### Sessions
- **Replaying a used refresh token revokes the entire family** (mandatory, P1.2)
- A revoked family's tokens are refused before natural expiry
- CSRF rejection on every state-changing route
- Cookie attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`

### Data integrity
- An out-of-order EDDN message **does not overwrite** fresher data (INV-017)
- **Three reports of one tick produce exactly one snapshot** (INV-019)
- A replayed journal event is idempotent
- BigInt round-trips above 2^53 exactly (INV-021)
- An ambiguous system name returns **candidates**, never a pick (INV-018)
- A dump seed never overwrites fresher EDDN data
- Kill the collector mid-batch, restart: no loss, no duplicate (INV-034)

### AI boundary
- **The ACL leak test — answer empty AND retrieval zero rows** (INV-003, mandatory)
- The same, after a category move, in **both** directions
- Tools filtered before serialisation; a forged tool name refused and audited (INV-011)
- Every mutating tool refuses without a confirmation token (INV-014)
- Prompt injection in indexed content cannot escalate (INV-015)
- The agent runtime has no database URL; the egress allowlist refuses an arbitrary host (INV-016)
- A content type with no registered re-index handler fails the enumeration test

### Content safety
- XSS: script tags, event handlers, `javascript:` and `data:` URLs, SVG payloads, nested encodings (INV-035)
- Upload: GPS EXIF stripped, polyglot neutralised by re-encoding, MIME sniffed from content

### Freshness and truth
- **Every market-derived response carries `dataAgeHours`** (INV-004)
- An all-stale result returns `DATA_TOO_STALE`, not silent stale data
- An empty route result names the **binding constraint**
- Carriers excluded by default; a 200,000 Ls station absent under default filters (INV-026)

### Privacy
- A private field is **absent** from the public response, not null (INV-027)
- A non-consented telemetry category is **rejected**, not ignored (INV-013)
- Tokens are unreadable as plaintext in their columns (INV-012)
- Data export contains every category held

### Availability
- **With the gateway unreachable, every non-AI feature works** (INV-030)
- Redis down → `/v1/health` reports `degraded` with HTTP 200, not a 500
- An adapter circuit opening degrades rather than throwing to a user

## Fixtures

Deterministic, seeded PRNG, from `03-data/seed-plan.md`. **The ACL fixture set — including the Ring 2 thread containing a unique nonsense token — loads for every authorization test**, so a new endpoint is tested against the same boundary corpus as every existing one.

**Real system names and coordinates** (Sol, Shinrarta Dezhra, Colonia, Deciat). Fake coordinates make spatial queries untestable, and fake system names train everyone to ignore wrong ones — which is exactly the habit INV-018 exists to prevent.

## Isolation

- **Transaction rollback per test** where possible.
- **Truncate and reseed** where committed data is needed — triggers, generated columns, the materialised view.
- **Never a shared long-lived test database.** Cross-test pollution produces failures that reproduce only in CI, which is the worst kind to debug.
- Each CI run gets a fresh ephemeral database.

## External services

**Tests never touch the network.** Every adapter has a fake (ADR-013), and the ability to swap it in with zero application changes is the proof the abstraction is real.

**Contract tests** run adapter parsing against *recorded real responses*, captured during live verification and committed as fixtures. This is how a shape change is caught without a network call.

**Live tests** (`.live.spec.ts`) hit the real service. Explicitly run, never in CI, used to move an adapter from `@unverified` to `@verified` in `STATUS.md`. **A phase cannot exit with `@unverified` adapters in its scope.**

## Performance assertions

Where a number is an acceptance criterion, it is asserted:

| Assertion | Where |
|---|---|
| Trade route query < 2 s on a populated database | P6.3 |
| Telemetry endpoint p99 < 500 ms | P3.7 |
| Fast path < 200 ms | P8.6 |
| Landing page < 1.5 s | P1.9 |
| Role change reflected within 5 s | P1.4 |
| EDDN lag < 60 s | P3.4 |

Run against a realistically-sized dataset. **A route query is fast on 100 rows and useless as evidence.**

## Accessibility

- axe-core in the e2e suite, blocking
- Lighthouse a11y ≥ 95 on key screens
- `tools/contrast-check.ts` against `tokens.json`, blocking
- Keyboard-only walkthrough per phase exit (manual)
- Screen-reader pass at P9 (manual)

## Naming

```ts
describe('ForumSearchService', () => {
  describe('when the caller is Ring 0', () => {
    it('@INV-024 returns zero hits for a term appearing only in a Ring 2 post', ...)
    it('@INV-024 does not disclose gated matches through facet counts', ...)
  });
});
```

The name states the **behaviour**, not the implementation. A failure should be diagnosable from the test name alone, without opening the file.
