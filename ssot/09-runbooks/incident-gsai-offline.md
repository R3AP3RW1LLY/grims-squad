# INCIDENT — GSAI offline

**Alert:** `GSAI offline > 15 min` in `#site-alerts`

**Impact on the site: none.** This is by design (INV-030, ADR-010). The AI panel reports `OFFLINE` honestly, read queries fall back to templated non-LLM responses, chat queues for Discord DM delivery, and scheduled AI jobs roll over.

**Severity: low.** Treat it as a chore, not an emergency.

> **If any non-AI feature is degraded, that is a separate and much more serious incident — an INV-030 violation.** Check that first: `curl -s https://<domain>/v1/health`. If the site is unhealthy while only GSAI is down, stop working this runbook and file a blocking defect.

---

## Expected offline states — not incidents

| Situation | Expected |
|---|---|
| The maintainer's box is off | Yes. It is a personal machine. |
| The maintainer is playing Elite | **Instance B only.** Instance A should still serve. If both are down, the arbiter is misconfigured. |
| The box is rebooting | Brief. Should self-recover. |
| Kill switch engaged | Deliberate. Check `site_config`. |

**Do not build alerting that treats an ordinary evening as an outage.** If the alert is noisy, the threshold is wrong.

---

## Triage

### 1. Is the box reachable at all?
```bash
ping -c3 <box-wireguard-ip>
ssh box 'uptime'
```
Unreachable → the box is off or the network is down. **Nothing to do remotely.** Confirm with the maintainer; the site is fine.

### 2. Is the kill switch on?
```bash
curl -s https://<domain>/v1/admin/config | jq '.ai'
```
`ai.disabled: true` → deliberate. Check the audit log for who and why before re-enabling.

### 3. Gateway
```bash
ssh box 'systemctl status gsai-gateway || docker ps --filter name=gsai'
ssh box 'curl -s localhost:8443/health'
```
| Finding | Go to |
|---|---|
| Gateway down | §A |
| Gateway up but the API sees no heartbeat | §B |
| Gateway up, Ollama down | §C |
| Everything up but requests fail | §D |

---

## §A — Gateway down

```bash
ssh box 'journalctl -u gsai-gateway -n 200 --no-pager'
ssh box 'systemctl restart gsai-gateway'
ssh box 'curl -s localhost:8443/health'
```

| Cause | Fix |
|---|---|
| Crash on start | Read the log. Usually a config or certificate problem after a change. |
| Port in use | Something else took 8443. |
| mTLS certificate expired | Reissue (`secrets-rotation.md`). **Predictable and preventable — alert on expiry, do not discover it here.** |
| Out of memory | The box is a gaming PC. Check what else is running. |

## §B — Gateway up, no heartbeat at the API

The tunnel is the suspect.

```bash
# WireGuard
ssh box 'wg show'                       # handshake should be recent
ssh vps 'wg show'
ssh vps 'ping -c3 10.44.0.2'            # VPS → box over the mesh

# Cloudflare Tunnel, if in use
ssh box 'systemctl status cloudflared'
ssh box 'journalctl -u cloudflared -n 100 --no-pager'
```

| Cause | Fix |
|---|---|
| WireGuard handshake stale | Restart `wg-quick@wg0` on both ends. Check `PersistentKeepalive = 25` is set — without it, NAT drops the mapping. |
| Home IP changed | Expected on a residential connection. Keepalive should re-establish. If it does not, the peer config is pinned to an address it should not be. |
| Cloudflare Access token expired | Reissue and update the VPS. |
| Firewall change | Check the last infra commit. |

**A replayed or unsigned request being rejected is correct behaviour, not a fault** — verify you are not chasing a working security control (INV-016, P8.3).

## §C — Ollama down

```bash
ssh box 'systemctl status ollama-interactive ollama-heavy'
ssh box 'ollama ps'
ssh box 'OLLAMA_HOST=127.0.0.1:11435 ollama ps'
ssh box 'nvidia-smi'
```

| Symptom | Cause | Fix |
|---|---|---|
| Instance A not running | Service stopped | `systemctl restart ollama-interactive` |
| **`size_vram` < `size`** | **Partially CPU-offloaded — it will crawl, and may look like a hang** | Reduce `num_ctx`, or free VRAM. See `06-ai/models.md`. |
| Instance B unavailable while the game is running | **Correct behaviour.** The arbiter yielded. | Nothing. Instance A serves. |
| Both GPUs missing from `nvidia-smi` | Driver problem after an update | Reinstall the driver. **580+ required.** |
| Model evicted | `KEEP_ALIVE` misconfigured on instance A | Instance A must be `KEEP_ALIVE=-1`. That is the entire point of it being primary. |
| GPU temperature > 83 °C | Thermal | The arbiter should already have shed to DEGRADED. Check airflow — the 3060 likely breathes the 5070 Ti's exhaust. |

## §D — Everything up, requests still fail

```bash
ssh box 'docker logs gsai-agent --tail 200'
curl -s https://<domain>/v1/ai/status | jq
```

| Cause | Fix |
|---|---|
| Signature or nonce rejection | Clock skew between VPS and box. **Check NTP on both** — a 60-second window is unforgiving of drift. |
| Egress allowlist blocking a legitimate API | An adapter's host changed. Update the allowlist deliberately; do not widen it to "any". |
| Concurrency semaphore exhausted | Stuck requests. Check for a tool call with no timeout — every tool must have one. |
| Tool calls timing out | The **API** is slow, not the agent. Check the VPS. |
| Model returning malformed tool calls | Reliability regression. **Re-run the P8.2 benchmark.** Below 75%, change model or quantisation. |

---

## Recovery verification

```bash
curl -s https://<domain>/v1/ai/status | jq
# expect: status "online", instances.interactive "available"
# instances.heavy may legitimately be "gaming"
```

Then:
- [ ] A test question returns an answer
- [ ] **Queued offline messages are delivered by Discord DM**
- [ ] Rolled-over scheduled jobs (briefing, digest) either ran or are rescheduled
- [ ] `ollama ps` shows `size_vram == size` on both instances

## After recovery

- [ ] Update `STATUS.md` if the outage was long or unusual
- [ ] **If any non-AI feature was affected, file a blocking INV-030 defect** — that is the finding that matters
- [ ] If the queue-and-DM fallback did not work, that is a real defect (P8.13)
- [ ] If the alert fired for an ordinary evening, fix the threshold rather than tolerating noise
- [ ] Improve this runbook in the same session if it did not help

## Prevention

| Control | Where |
|---|---|
| Heartbeat every 15 s; three misses → OFFLINE | gateway |
| Templated non-LLM fallback for read queries | API |
| Chat queued and delivered by Discord DM | worker |
| Scheduled jobs roll over rather than failing | worker |
| `KEEP_ALIVE=-1` on instance A | systemd |
| Arbiter yields instance B to the game automatically | arbiter |
| Thermal guard sheds above 83 °C | arbiter |
| NTP on both ends | host config |
| Certificate expiry alerting | monitoring |
| UPS on the box | hardware |
