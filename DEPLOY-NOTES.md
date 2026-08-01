# Deploy notes — 2026-08-01

Written overnight, for the owner. **Nothing has been deployed.** The branch is
`feat/p2-rich-editor-and-remaining`, 105 commits ahead of `main`, working tree
clean, full gate green.

Deploy was deliberately not run unattended: the galaxy dump path, the disk
headroom and the migrations all want a human watching them the first time.

---

## The four deploy items are done

| Item | State |
|---|---|
| AI chat assistant | `/gmsd-ai/ask` + officer conversation review at `/app/conversations` |
| Companion Discord login, no key generator, onboarding step | Done, plus the app redesign |
| Signature builder AI generation with Q&A | Two-path stepper, five designs, generated backplates |
| Fonts / `forum_post_count` / weapons chart | All three done — see below |

---

## Things that need a decision or a hand before deploy

### 1. `KNOWLEDGE_GALAXY_FILE` and disk

The galaxy ingest now downloads the Spansh dump itself instead of reading a file
somebody placed by hand. Production needs:

- `KNOWLEDGE_GALAXY_FILE=/srv/grims/knowledge/galaxy_populated.json.gz` in
  `/srv/grims/.env` (any writable Linux path)
- **~9 GB free**: 4.26 GB for the dump, and the same again while a new one
  downloads beside the old one

Without the variable the ingest fails **loudly** now rather than silently doing
nothing, which is the fix — but it will fail.

### 2. Migrations to apply

Five, all applied to the dev database and verified there:

```
20260801210000_station_market_id_idx   marketId lookup: 2,696ms -> 0.115ms
20260801220000_ai_call_thread          groups assistant turns into conversations
20260801230000_device_links            the companion sign-in handshake
20260801240000_companion_prompted      the onboarding companion step
20260801250000_font_prefs              default font + reader override
20260801260000_onfoot_category         adds 'onfoot' to the TelemetryCategory enum
```

Remember the standing rule: **hand-check any generated migration** — the
generator proposes dropping the pgvector HNSW, cube GiST and tsvector indexes.
The six above are hand-written and do not.

### 3. New container: `eddn-collector`

`infra/docker/compose.prod.yml` gained an `eddn-collector` service. It needs
building on first deploy. Exactly one instance — the advisory lock enforces it,
but `deploy.replicas: 1` states the intent.

### 4. The companion installer

`apps/companion/release/Grims Squad Companion Setup 0.4.0.exe` — 98 MB, built
tonight, ProductVersion 0.4.0, embedded icon verified. `release/` is gitignored,
so **this file is only on this machine**. It and `latest.yml` need uploading to
the release bucket; the auto-updater fetches `latest.yml` from
`https://45-63-35-93.sslip.io/v1/companion/download`.

The stale `Setup 0.1.0.exe` from 27 July has been deleted — it predated the
`.ico` entirely and had no proper icon.

### 5. Galaxy embedding is still 0 of 448,676

The assistant reaches galaxy data through name, spatial and market lookups, so
it works today. Semantic questions ("somewhere quiet with good mining and a large
pad") will not until this runs — about 72 minutes at the measured 104/s.

---

## Things worth knowing about what changed

**Forum posting counted towards nothing.** `forum_post_count` was read by the
dashboard, the activity table and the promotion check, and written by nothing —
0 of 52 monthly rows carried a count against 16 real posts. Both the ongoing
write and a backfill tool are in. **Run the backfill on production once:**

```
docker compose ... run --rm worker node apps/worker/dist/backfill-forum-counts.js --dry
docker compose ... run --rm worker node apps/worker/dist/backfill-forum-counts.js
```

It sets absolute values and zeroes first, so it is safe to run twice.

**`SuitLoadout` is now collected.** It was not in the journal registry, so every
one ever sent was discarded. It is a new, optional, separately-refusable category
(`onfoot`) and appears in the app's "What the squadron keeps" panel. This is the
one change that widens what is held about members — flagged deliberately.

**The signature generator does not let the model choose colours.** Asked for hex
values it returned five near-identical greys for a member who wrote "gold and
black", through two rounds of prompt rules. Palettes are a curated table now; the
model keeps the name, tagline and imagery, which it does well.

---

## Not done

- **Deploy itself.**
- `default_font_id` has a column and a contract but no editor picker writing it,
  so nothing reads it yet. The reader override is complete and working.
- The 2FA screens, the companion sign-in browser flow and the signature stepper
  have been compiled, logic-tested and exercised at the HTTP level, but not
  clicked through — they sit behind Discord OAuth.
