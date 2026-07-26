# ADR-011 — Two isolated Ollama instances, one per GPU; the 3060 is primary

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §8.2 (assumption A7, CONFIRMED)

## Context

The AI box holds an RTX 3060 (Ampere, CC 8.6, 12 GB, 360 GB/s) and an RTX 5070 Ti (Blackwell, CC 12.0, 16 GB, 896 GB/s). Ollama can pool both cards and split a model's layers across them. Token generation speed is dominated by memory bandwidth, so on raw throughput the 5070 Ti is roughly 2.5× the 3060 and the obvious primary.

Two facts complicate the obvious answer. First, the 5070 Ti is the card the maintainer plays Elite Dangerous on. Second, mixing generations inside one Ollama instance has documented costs.

## Decision

### Two isolated instances, one GPU each — not one instance spanning both

```
GSAI-INTERACTIVE   RTX 3060 12 GB   :11434   qwen3:8b Q4_K_M, num_ctx 16384, KEEP_ALIVE=-1
GSAI-HEAVY         RTX 5070 Ti      :11435   qwen3:14b Q4_K_M, num_ctx 16384, KEEP_ALIVE=5m
```

Three reasons pooling is rejected:
1. **Mixed-generation feature downgrade.** With CC 8.6 and CC 12.0 in one instance, Ollama aligns to the lower generation's feature set — Blackwell-specific tensor-core optimisations are lost on the card that has them.
2. **Blackwell scheduler detection.** RTX 50-series cards are not always auto-detected by Ollama's scheduler, requiring explicit UUID pinning and `OLLAMA_SCHED_SPREAD` just to place layers.
3. **PCIe activation shuttling.** Splitting a model that fits on one card is strictly slower, on every forward pass.

Each instance sees exactly one GPU via `CUDA_VISIBLE_DEVICES` set to a **GPU UUID, never a numeric index** — indices reorder across reboots. Both point at the same `OLLAMA_MODELS` directory; the blob store is content-addressed, so shared models are stored once.

### The 3060 is primary, despite being the slower card

**Availability beats throughput for a service other people depend on.** An LLM resident in VRAM while the maintainer is in a conflict zone means either stuttering frames or a model evicted mid-request. The 3060 gives GSAI a card nobody is fighting over: resident 24/7, `KEEP_ALIVE=-1`, never unloaded, never contended.

Instance B is **arbiter-gated**: it takes work only when no game process is detected, free VRAM exceeds ~11 GB, and GPU temperature is below ~83 °C. It handles scheduled/batch work (overnight BGS digests, weekly summaries, embedding backfill), explicitly high-complexity requests, and genuine overflow when instance A's queue is deep. `KEEP_ALIVE=5m` means it releases VRAM on its own shortly after a game launches, and the arbiter stops routing to it immediately.

### `qwen3:8b` on the primary, not `14b`, even though 12 GB would hold it

14b on a 360 GB/s card generates at roughly 18–22 tok/s against 35–45 for the 8b. **For an interactive assistant, halving latency beats a marginal quality gain** — and the 14b is available on instance B for requests that genuinely need it. Fast on the primary, smart on the secondary.

### Preconditions
- **NVIDIA driver 580+.** Verify both cards enumerate before troubleshooting anything else.
- **Confirm the 3060 is the 12 GB variant** (`nvidia-smi --query-gpu=name,memory.total,uuid --format=csv`). The 8 GB 3060 and the 3060 Ti exist and change the model tier — decision D8.
- **`ollama ps` must show `size_vram == size` on both.** If it does not, the model is partially on CPU and generation will crawl; drop `num_ctx` before accepting it.
- **PSU 750 W minimum, 850 W comfortable**; UPS required.
- **The embedding model is pinned forever.** Changing it invalidates every vector in `knowledge_chunks` and forces a full re-index.

## Consequences

**Positive**
- Neither documented failure mode can occur — each instance sees one homogeneous GPU.
- GSAI's interactive latency is stable and independent of whether the maintainer is playing.
- The better model is used exactly where it is free: overnight, on work nobody is waiting for.
- Upgrading later ("make the 5070 Ti primary in a headless box") repoints two environment variables and changes nothing architectural.

**Negative / accepted costs**
- **The arbiter is a service that must exist** (~60 lines plus a poller) with its own failure modes. Instance B being unavailable must degrade, never error.
- Two systemd units, two ports, two model sets to keep straight.
- Quality is inconsistent by design: the same question can be answered by an 8b or a 14b. The system prompt and tool contracts are identical, so the difference is depth of reasoning, not correctness of facts — facts come from tools.
- Peak draw of 170 W + 300 W simultaneously if instance B ever runs during a game session.
- The 3060 likely breathes the 5070 Ti's exhaust and is the card running 24/7 — hence the temperature guard.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **One Ollama instance across both GPUs** | Mixed-generation feature downgrade, Blackwell detection problems, and PCIe shuttling for a model that fits on one card. Explicitly rejected in `scope.md`. |
| **5070 Ti as primary** | It is the gaming card. GSAI would be contended or evicted exactly when the maintainer is playing — which is also when members are most likely to be online. Revisit only if the 5070 Ti moves to a headless box. |
| **`qwen3:14b` on the 3060** | Halves interactive throughput for a marginal quality gain, when 14b is already available on instance B. |
| **`qwen3:32b`** | Does not fit in 16 GB at Q4. |
| **`gpt-oss:20b` on instance B without benchmarking** | Plausible — it is MoE and sized for 16 GB, and strong on multi-step tool chains. Not decided by assertion: benchmark it against `qwen3:14b` on **our** tool schemas and keep the winner (decision D9, task P8.2). |
| **Numeric `CUDA_VISIBLE_DEVICES` indices** | Reorder across reboots, silently swapping which model is on which card. |
| **A third GPU** | The upgrade path is a single 24 GB card or a headless box, not more cards in a gaming rig. |
