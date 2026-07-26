# MODELS & GPU CONFIGURATION

Decision and rationale: ADR-011. This file is the operational configuration.

## Hardware

| | Instance A — RTX 3060 | Instance B — RTX 5070 Ti |
|---|---|---|
| Architecture / CC | Ampere GA106 / **8.6** | Blackwell GB203 / **12.0** |
| VRAM | **12 GB** — confirmed 2026-07-26 | 16 GB |
| Memory bandwidth | 360 GB/s | 896 GB/s |
| TGP | 170 W | 300 W |
| Role | **Interactive, resident 24/7, never contended** | Batch/overflow, **yields to the game** |
| Port | `127.0.0.1:11434` | `127.0.0.1:11435` |

The 3060 variant is **confirmed 12 GB**, so the 12 GB column below is operative. Still run this at P8.1 — it is also how the **GPU UUIDs** for pinning are obtained, and numeric indices reorder across reboots:
```bash
nvidia-smi --query-gpu=index,name,memory.total,uuid --format=csv
```

## Model assignment

| Slot | 3060 **12 GB** | 3060 **8 GB** (fallback) | 5070 Ti 16 GB |
|---|---|---|---|
| Agent | `qwen3:8b` Q4_K_M — 4.9 GB | `qwen3:8b` Q4_K_M — 4.9 GB | `qwen3:14b` Q4_K_M — 9.0 GB |
| Context | `num_ctx 16384` — 2.4 GB KV | `num_ctx 8192` — 1.2 GB KV | `num_ctx 16384` — 3.1 GB KV |
| Embedder | `nomic-embed-text` — 0.3 GB, co-resident | **CPU instance** — no VRAM | batch backfill only |
| **Total** | **~7.6 / 12 GB** — comfortable | **~6.1 / 8 GB** — tight, headless only | **~12.1 / 16 GB** |
| `MAX_STEPS` | 6 | 6 | 8 |

**Why `qwen3:8b` on the primary when 12 GB would hold the 14b:** 14b on a 360 GB/s card generates at roughly 18–22 tok/s against 35–45 for the 8b. **For an interactive assistant, halving latency beats a marginal quality gain** — and the 14b is available on instance B for requests that genuinely need it. Fast on the primary, smart on the secondary.

**Instance B alternative:** `gpt-oss:20b` is a mixture-of-experts model sized for 16 GB and strong on multi-step tool chains. **Benchmark it against `qwen3:14b` on our real tool schemas and keep the winner** (decision D9, task P8.2). `qwen3:32b` does **not** fit in 16 GB at Q4 — do not attempt it.

## systemd units

**Two isolated instances, one GPU each — never one instance spanning both** (ADR-011). Pooling causes a mixed-generation feature downgrade (Ollama aligns to the *lower* compute capability, so Blackwell optimisations are lost on the card that has them), plus Blackwell scheduler-detection problems, plus PCIe activation shuttling for a model that fits on one card.

```bash
# Get STABLE UUIDs — numeric indices reorder across reboots and silently swap
# which model is on which card.
nvidia-smi --query-gpu=index,name,uuid --format=csv
```

```ini
# /etc/systemd/system/ollama-interactive.service
Environment="CUDA_VISIBLE_DEVICES=GPU-<3060-uuid>"
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_MODELS=/var/lib/ollama/models"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=-1"          # never unload. this is the entire point.
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_MAX_LOADED_MODELS=2"    # 8b + embedder co-resident
```

```ini
# /etc/systemd/system/ollama-heavy.service
Environment="CUDA_VISIBLE_DEVICES=GPU-<5070ti-uuid>"
Environment="OLLAMA_HOST=127.0.0.1:11435"
Environment="OLLAMA_MODELS=/var/lib/ollama/models"   # SHARED content-addressed blob store
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=5m"          # release VRAM promptly when the game starts
Environment="OLLAMA_NUM_PARALLEL=1"
```

Both point at the same `OLLAMA_MODELS` directory. The blob store is content-addressed, so a shared model is stored once, not twice.

## Setup and verification

```bash
# Driver: 550+ is Ollama's minimum; Blackwell wants newer. Run 580+.
nvidia-smi --query-gpu=driver_version --format=csv

ollama pull qwen3:8b
ollama pull nomic-embed-text
OLLAMA_HOST=127.0.0.1:11435 ollama pull qwen3:14b

# ★ size_vram MUST equal size on BOTH instances ★
ollama ps
OLLAMA_HOST=127.0.0.1:11435 ollama ps
```

**If `size_vram` is lower than `size`, the model is partially on the CPU and generation will crawl.** Drop `num_ctx` before accepting it. This check is a P8.1 exit criterion, not a suggestion.

## Reliability benchmark — gate before building anything

**Run before any code depends on either instance** (task P8.2, and it blocks the rest of P8):

```
20 identical tool-call requests, using OUR ACTUAL tool schemas from tools.yaml
  → measure: % returning valid structured tool_calls with correct arguments
  → measure: time-to-first-token, and total wall time per request
  → run against BOTH instances
  → BELOW ~75% RELIABILITY: change the model or the quantisation before proceeding
```

**Test with our real schemas, not generic ones.** Reliability varies with schema complexity and ours are not simple. An agent that fumbles one call in three is worse than no agent — it will be trusted intermittently, which is the worst outcome.

Record the results in `STATUS.md`. This is also how decision D9 (`qwen3:14b` vs `gpt-oss:20b`) is settled: by measurement, not assertion.

**Use Ollama's structured outputs (JSON-Schema-constrained) for anything parsed. Never regex model prose.**

## Context and result budgets

| Setting | Instance A | Instance B | Why |
|---|---|---|---|
| `num_ctx` | 16384 | 16384 | Room for the system prompt, rolled history, tool schemas and results |
| `temperature` | 0.3 | 0.3 | Tool selection wants determinism, not creativity |
| `MAX_STEPS` | 6 | 8 | Beyond this a small model is looping, not progressing |
| Tools per turn | 8–10 | 8–10 | Not all 30. Saves ~1,200 tokens and **measurably improves selection accuracy** |
| Result truncation | ~2,500 chars | ~2,500 chars | Summarise server-side; return the top 5 routes, not 100 |
| History | system + last 4 exchanges + running summary | same | Rolling window |

## The embedding model is pinned forever

**Changing `nomic-embed-text` invalidates every vector in `knowledge_chunks` and forces a full re-index.** Treat it as a permanent architectural commitment, not a tunable.

**Dimension: 768**, matching `nomic-embed-text` (resolved 2026-07-26). The source spec declared `vector(1024)` against a 768-dimension model, which would have failed on every insert. `knowledge_chunks.embedding` is `vector(768)` and both are now immutable together. See `STATUS.md`.

## Rate limits

| Tier | Messages/hour | Messages/day |
|---|---|---|
| `member` | 20 | 80 |
| `wing_lead` | 30 | 120 |
| `officer`+ | 60 | 240 |

Relaxed relative to a single-GPU plan because `NUM_PARALLEL=2` plus instance-B overflow raises the ceiling. **These limits bite far less than they appear to**, because the fast path serves ~70% of messages without touching a model at all.

## Power and thermals

- **170 W + 300 W under simultaneous load**, plus CPU and drives. **PSU 750 W minimum, 850 W comfortable.**
- **UPS required.** A power cut mid-inference during a `pg_dump` is how untested backups get discovered.
- **The 3060 is likely breathing the 5070 Ti's exhaust and is the card running 24/7.** Measure its sustained temperature under an hour of continuous inference.
- **Thermal guard in the arbiter: shed to `DEGRADED` above ~83 °C.**

## Upgrade path

If GSAI outgrows this, the next step is **not** a third card. It is either:
- the 5070 Ti in a headless box as primary, with gaming moved to the 3060; or
- a single 24 GB card running `qwen3:32b` at full speed.

**Nothing in the architecture changes — two environment variables get repointed.** That is the payoff of two isolated instances rather than a pooled one.
