# RUNBOOK — Secrets rotation

## Inventory

| Secret | Used by | Rotation | Blast radius if leaked |
|---|---|---|---|
| `DATABASE_URL` password | api, worker, bot, eddn | quarterly | **Total.** Every member's data. |
| `REDIS_PASSWORD` | api, worker, bot | quarterly | Sessions, cache, queues |
| `MEILI_MASTER_KEY` | api, worker | quarterly | Search index; **ACL bypass on search** |
| `JWT_SIGNING_KEY` | api | quarterly | **Session forgery — any identity, any permission** |
| `TOKEN_ENCRYPTION_KEY` (AES-256-GCM) | api, worker | **see the special procedure below** | All stored OAuth, cAPI and device tokens |
| `DISCORD_BOT_TOKEN` | bot | quarterly | Full bot permissions in the guild |
| `DISCORD_CLIENT_SECRET` | api | quarterly | OAuth impersonation |
| `FRONTIER_CLIENT_SECRET` | api | quarterly | cAPI client |
| `INARA_API_KEY` | worker | on suspicion | Rate-limit abuse under our name |
| `TURNSTILE_SECRET` | api | quarterly | Spam protection bypass |
| `OBJECT_STORAGE_KEY` | api, worker | quarterly | Uploads, backups |
| `BACKUP_STORAGE_KEY` | backup job | quarterly | **Backups — held in a separate provider with separate credentials** |
| `GSAI_HMAC_KEY` | api, gsai-gateway | quarterly | Forged AI requests |
| mTLS certificates | api ↔ gateway | annually, **alert 30 days before expiry** | Tunnel authentication |
| WireGuard keys | vps ↔ box | annually | Mesh access |
| Cloudflare Access service token | api | quarterly | Edge bypass to the gateway |
| `SENTRY_DSN` | all | on suspicion | Error-report injection |

**None of these live in the repository** (INV-036). `.env.example` holds placeholder values only, and gitleaks runs against the full history on every PR.

## Standard rotation

```
1. Generate the new value in the secret store (decision D6).
2. Add it ALONGSIDE the old one where the consumer supports two.
3. Deploy so consumers accept both.
4. Switch the producer to the new value.
5. Verify.
6. Remove the old value.
7. Record the date in the secret store's metadata.
```

**Steps 2–4 are what makes this zero-downtime.** Skipping them turns a rotation into an outage.

## Per-secret notes

### `JWT_SIGNING_KEY` — dual-key rotation
```
1. Add the new key as a SECONDARY verification key. Keep signing with the old.
2. Deploy. All instances now verify against both.
3. Promote the new key to primary for signing.
4. Deploy.
5. Wait 30 days — the refresh-token lifetime — so no valid session still depends on the old key.
6. Remove the old key.
```
**Rotating in one step invalidates every session immediately.** Acceptable in a compromise, unacceptable as routine maintenance.

### `TOKEN_ENCRYPTION_KEY` — ★ requires re-encryption, not just a swap
This key encrypts stored Discord, Frontier and device tokens (INV-012). **Changing it without re-encrypting makes every stored token permanently unreadable**, forcing every member to re-authorise Discord and re-verify their CMDR.

```
1. Add the new key as key version 2; keep v1 for decryption.
2. Deploy — the code must decrypt with either and encrypt with v2.
3. Run the re-encryption job: read with v1, write with v2, row by row, resumable.
4. Verify no row remains at v1:
     select count(*) from discord_identities where key_version = 1;   -- expect 0
     select count(*) from cmdr_verifications where key_version = 1;   -- expect 0
     select count(*) from device_tokens      where key_version = 1;   -- expect 0
5. Remove v1.
```

**The schema must carry a key version column for this to be possible at all.** If it does not, add it *before* the first rotation is needed — retrofitting it during an incident is not a good time.

### `DISCORD_BOT_TOKEN`
Regenerating **immediately invalidates the old token** — Discord supports no overlap. The bot will disconnect. Deploy the new token in the same window and expect a brief gap in gateway events; **the nightly reconciliation repairs any drift**, which is one of the reasons it exists.

### mTLS certificates
Annual, but **alert 30 days before expiry**. An expired certificate presents as "GSAI offline" and gets triaged as an outage rather than as the calendar event it is (`incident-gsai-offline.md` §A).

### `BACKUP_STORAGE_KEY`
Separate provider, separate credentials, **not stored alongside production secrets**. In a ransomware or malicious-deletion scenario the backups must survive the compromise of everything else (`backup-restore.md`).

---

## ★ Emergency rotation — a secret has leaked

**Order matters. Do not investigate first.**

```
1. ROTATE IMMEDIATELY. Do not wait to determine the impact.
2. Revoke the old value at the provider where possible.
3. THEN investigate: what was exposed, for how long, what could have been reached.
4. Check audit_log for unexpected activity in the window.
5. If member data may have been accessed:
     - Notify the maintainer and officers
     - GDPR breach notification obligations may apply (constraints.md)
     - Document the timeline while it is fresh
6. If JWT_SIGNING_KEY or TOKEN_ENCRYPTION_KEY leaked:
     - Revoke ALL refresh token families — every member re-logs in
     - Force CMDR re-verification
7. If DISCORD_BOT_TOKEN leaked:
     - Regenerate at once. Audit the Discord audit log for unauthorised role changes.
8. Write it up in STATUS.md and improve whatever let it happen.
```

**A secret committed to git is leaked even after the commit is removed.** History is distributed; assume it is public. Rotate.

## Schedule

| Cadence | Task |
|---|---|
| Quarterly | Rotate every secret marked quarterly |
| Annually | mTLS certificates, WireGuard keys |
| 30 days before expiry | mTLS renewal alert |
| Monthly | Verify no secret has appeared in the repository (CI does this per PR; verify the check itself still runs) |
| On any suspicion | Emergency procedure, immediately |
| On maintainer change | **Rotate everything.** Non-negotiable. |

## Verification after any rotation

```bash
curl -s https://<domain>/v1/health | jq                    # all checks ok
curl -s https://<domain>/v1/ai/status | jq '.status'       # gateway HMAC still valid
# Discord: bot online in the guild, a role change still syncs
# A login round-trip completes
# The backup job's next ping arrives
```

- [ ] All health checks green
- [ ] A login round-trip works
- [ ] The bot responds and role sync functions
- [ ] GSAI heartbeat received
- [ ] The backup job succeeded on its next run
- [ ] No secret in the repository
- [ ] Rotation date recorded
