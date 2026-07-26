# ADR-012 — The deterministic fast path is the front door; the agent loop is the fallback

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §8.2.6, §14 (Phase 8)

## Context

The instinctive design for an AI assistant is "user message → LLM → tools → answer". On an 8B-class local model this is slow (seconds of generation for a database lookup), risky (hallucinated prices, invented system names) and wasteful (GPU cycles spent deciding to run a query that a string match could have chosen).

Most real member questions are not reasoning problems. *"What's Tritium selling for near Sol"* is a parameterised database query wearing a sentence.

## Decision

**Classify first, and only reason when classification fails.**

```
User message
  → embedding-similarity intent classifier over ~40 canned intents (no LLM)
  → HIGH CONFIDENCE  → extract parameters → call the tool directly
                     → render a templated response. The LLM never runs.
  → otherwise        → agent loop, routed by the arbiter (ADR-011)
```

- Target: **~70% of traffic on the fast path, under 200 ms, with zero hallucination risk.** Phase exit requires ≥60% measured on real queries.
- Tools carry `fast_path: true|false` in `06-ai/tools.yaml`. Only read tools with unambiguous parameters qualify. **No mutating tool is ever on the fast path.**
- Confidence threshold is configurable and starts conservative. **A miss costs one extra second on the agent loop; a false positive gives a confidently wrong answer.** The asymmetry sets the default.
- Templated responses are ordinary rendering code with the same freshness and provenance obligations as any other surface (INV-004).
- **Build the fast path before the agent loop** (task P8.6 precedes P8.8). This is deliberate sequencing, not a preference: building the loop first produces a system whose default behaviour is slow and hallucination-prone, and the fast path then never gets built because "it already works".

Constraints that apply to the agent loop when it does run:
- **Pre-filter tool schemas** — send the 8–10 most plausible tools, not all 30. Saves ~1,200 tokens per turn and measurably improves selection accuracy on 8B-class models.
- **Truncate tool results** to ~2,500 characters. Summarise server-side; return the top 5 routes, not 100.
- **`MAX_STEPS` 6 on the 8b, 8 on the 14b.** Beyond that a small model is looping, not progressing.
- **Roll conversation history**: system prompt + last 4 exchanges + a running summary.

## Consequences

**Positive**
- The common case is fast, deterministic, auditable and free of GPU load.
- Hallucination risk is structurally removed from most traffic rather than mitigated by prompting.
- GSAI stays usable when the box is under load, and the OFFLINE fallback is not a special case — templated responses already exist (INV-019, ADR-010).
- Rate limits (20 messages/hour, 80/day per member) bite far less because most messages never reach a model.

**Negative / accepted costs**
- **Two answer-generation paths to maintain and test.** Both must satisfy the same freshness and permission rules; the invariant tests apply to both.
- The intent catalogue is hand-curated and will need pruning and extension as real usage arrives. That is ongoing work, not a one-off.
- Templated answers read less naturally than generated prose. Acceptable — members want the number and its age.
- The classifier needs the embedding model loaded, so the embedder is co-resident on instance A rather than being a batch-only concern.
- Classifier tuning is empirical. It needs real query logs, which means the threshold starts conservative and is revised after launch.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **LLM plans everything** | Seconds of latency and a hallucination surface for questions that are database lookups. On an 8B model it is also the *least* reliable configuration. |
| **Keyword/regex intent matching instead of embeddings** | Brittle against natural phrasing ("where do I offload tritium", "who's buying tritium", "tritium sell price"). Embedding similarity handles paraphrase; regex handles exactly what its author imagined. |
| **A small LLM as the classifier** | Reintroduces GPU load and non-determinism into the step whose entire purpose is to avoid both. |
| **Build the agent loop first, add a fast path later** | The recognised failure mode: the loop "works", the fast path never gets prioritised, and every member's first impression is a slow assistant that occasionally invents a price. Explicitly sequenced against. |
| **Fast path for mutating tools too** | A misclassification would take a real action without reasoning or confirmation. Never. |
| **Skipping the fast path because the model is "good enough"** | Model quality does not address latency, GPU contention, cost of the OFFLINE fallback, or auditability. |
