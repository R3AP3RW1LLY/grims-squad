# ADR-010 — Public edge on a cheap VPS; AI at home behind a tunnel

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §3.1, §9 (assumptions A2, A8)

## Context

Two hosting resources exist: a gaming PC with two GPUs at home, and a budget of roughly $30/month. The AI must run at home — the GPUs are there and cloud inference would break the budget. The question is where everything *else* runs.

A community site that goes down when its maintainer reboots their gaming rig, launches a game, or loses power for ten minutes will not be trusted, and untrusted sites are not visited.

## Decision

**Public services on a cheap VPS. AI at home. The edge never depends on the home box.**

| Location | Runs | Availability contract |
|---|---|---|
| **VPS** (4 vCPU / 8 GB / 160 GB NVMe, ~$8–15/mo) | `caddy`, `web`, `api`, `bot`, `worker`, `eddn-collector`, `postgres`, `redis`, `meilisearch`, `coriolis` | 24/7. This is the product. |
| **Home box** | `gsai-gateway`, `gsai-agent`, two Ollama instances, optional STT/TTS | Best-effort. May be off, gaming, or rebooting. |
| **Cloudflare** | DNS, TLS, CDN, WAF, Turnstile, Access, Tunnel | Free tier |

**The availability contract, which is INV-019 and non-negotiable:**
- Home box off → the site is fully functional. The AI panel reports `OFFLINE` honestly; read-only queries fall back to templated, non-LLM responses; chat requests queue and are delivered by Discord DM on reconnect; scheduled AI jobs roll over.
- No page load, no API request, and no background job outside the GSAI subsystem may block on the home box.

**Connectivity — layered, and both are used:**
- **WireGuard mesh for the API ↔ GSAI control plane.** End-to-end encrypted, no third party terminating TLS, lowest latency, nothing exposed to the public internet. The gateway binds only to the mesh interface.
- **Cloudflare Tunnel** (`cloudflared`, outbound-only) available for anything we ever want to expose directly, fronted by **Cloudflare Access with a service token issued only to the VPS**.
- Beneath whichever transport: **mTLS, plus HMAC request signing with a single-use nonce and a 60-second timestamp window.** Three independent layers; any one failing does not expose the agent.
- **No inbound ports on the home router. The home IP is never published.** A gaming community site is a plausible DDoS target and a residential connection must not be the address on file.
- **Egress allowlist on the agent container:** Ollama on localhost, our API, the whitelisted ED APIs, nothing else. No route from the container to the home LAN.

## Consequences

**Positive**
- The site's uptime is a VPS's uptime, not a gaming PC's.
- AI inference costs $0 and no member data leaves our control.
- The GPUs stay available for their other job — playing the game the site is about.
- Total spend stays inside the ~$30/month ceiling.

**Negative / accepted costs**
- **Two deployment targets, two runbooks, and a network boundary between them.** Real operational complexity, accepted because the alternative is a fragile site.
- GSAI has a genuinely lower availability tier than the rest of the product. The design leans into this rather than hiding it — the status is shown to users honestly, never faked.
- The tunnel is a security surface in its own right; hence the threat model in `05-integrations/` and the layered controls above.
- VPS resources are shared by Postgres, Redis, Meilisearch and the EDDN collector on 8 GB. Sizing and the EDDN prefilter are load-bearing.
- Latency on every AI tool call that reads squadron data: gateway → tunnel → API → database and back. Accepted deliberately, because it is what makes the API's authorization the single enforcement point (ADR-015).

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Host everything at home** | Requires a UPS, a hardened backup story, and acceptance that a power cut, ISP outage or reboot takes the squadron site down. Residential upload becomes the ceiling, and many ISPs' terms prohibit hosting outright. |
| **Host everything in the cloud, including AI** | GPU instances break the budget by an order of magnitude, and the hardware we already own sits idle. |
| **Cloud LLM API instead of local inference** | Per-token cost against a $30/month ceiling, and member data — forum content, locations, finances — leaving our control. Kept only as a feature-flagged, off-by-default fallback (`scope.md`). |
| **Port-forward to the home box** | Publishes the home IP, opens inbound ports on a residential connection, and makes a gaming rig a DDoS target. |
| **Reverse SSH tunnel with autossh** | Works and costs nothing, but it is brittle and needs babysitting. Acceptable as an emergency fallback, not as the design. |
| **Cloudflare Tunnel alone, without mTLS and signing** | Traffic is decrypted at Cloudflare's edge on the free tier. The tunnel is transport, not trust. |
| **Making any page load depend on the home box** | Would convert a best-effort component into a single point of failure for the whole product. INV-019 exists to forbid exactly this. |
