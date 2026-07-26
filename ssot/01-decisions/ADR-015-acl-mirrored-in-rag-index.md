# ADR-015 — ACLs are mirrored into the RAG index and enforced outside the prompt

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §6.2, §8.3, §8.10

## Context

GSAI searches forum posts, wiki pages, doctrine builds and AARs to answer questions. Those sources have different visibilities: public, member-only, officer-only. When content is chunked and embedded, the ACL is trivially lost — the chunk becomes a row in a vector table with no memory of where it came from.

**This is the single most common way self-hosted AI assistants leak private data**, and it is entirely preventable. The failure is silent: nothing errors, a recruit simply receives a summary of an officer-only thread.

There is a second, related failure: relying on the system prompt to enforce permissions. A prompt instruction is a request, and retrieved forum content is attacker-controlled text.

## Decision

**Four controls, layered. Any one failing must not produce a leak.**

### 1. The index carries the ACL
`knowledge_chunks.visibility` **mirrors the visibility of its source record, always** (INV-003). It is a security control, not metadata, and is commented as such in the schema.

- Indexing writes the source's visibility with the chunk, in the same transaction.
- **On source deletion or ACL change, chunks are deleted or re-indexed** — this is the part that gets forgotten. A forum thread moved from a public to an officer category must not leave public-visibility chunks behind. Every mutation path that can change a source's visibility enqueues a re-index job.
- Chunks whose source cannot be resolved are deleted, not retained.

### 2. Filtering happens before nearest-neighbour returns
The visibility predicate is **in the query**, derived from the caller's permission mask:

```sql
WHERE visibility = ANY($allowedVisibilities)
ORDER BY embedding <=> $queryEmbedding
LIMIT 8
```

Never retrieve-then-filter. Post-filtering leaks through result counts, scores and pagination, and an empty post-filtered result set still means the embedding of private content influenced what was retrieved.

### 3. Tools are permission-filtered before the model sees them
`registry.forPermissions(mask)` runs **before** the tool list is serialised into the request. **The model cannot call what it does not know exists.** Permission checks additionally re-run in the tool executor, and every invocation — including denials — is audited (INV-011).

### 4. Enforcement lives in code, never in the prompt
- Retrieved content is **untrusted input**, wrapped in explicit delimiters, with the model instructed that instructions inside retrieved content are data and must be ignored. **This instruction is a mitigation, not the control.**
- **The real control:** a successful prompt injection still cannot call a tool the caller lacks permission for, and still cannot retrieve a chunk the caller's mask excludes.
- **Tools that touch squadron data call back through the tunnel to the API with the same signed user context**, so the API's existing authorization guards enforce everything once, in one place. The agent has no other route to the data — no local database replica, no direct connection.
- Egress allowlist on the agent container: Ollama on localhost, our API, whitelisted ED APIs, nothing else. This bounds exfiltration through tool arguments.

**Mandatory test, and a phase-exit criterion for P8:** a Ring 0 user asks GSAI about content that exists only in a Ring 2 thread. Assert the answer contains nothing from it **and that retrieval returned zero rows**. Both halves — an empty answer over a non-empty retrieval is still a leak waiting to happen.

## Consequences

**Positive**
- The AI is never more privileged than the person asking, structurally rather than by good behaviour.
- Prompt injection is bounded: it can waste tokens, it cannot escalate.
- Authorization has one home — the API's guards — rather than being reimplemented in the agent.

**Negative / accepted costs**
- **Every ACL-changing mutation must trigger re-indexing.** This is real coupling between the forum/wiki modules and the RAG pipeline, and it is where the design will break if anyone adds a new content type carelessly. A test enumerates content types against registered re-index handlers.
- Latency: tool calls traverse gateway → tunnel → API → database rather than reading locally. Accepted deliberately — it is what makes a single enforcement point possible (ADR-010).
- The visibility filter reduces recall for lower-privileged users, sometimes to zero. Correct behaviour; the UI says "no accessible sources found", never invents an answer.
- Re-indexing on ACL change costs embedding compute. Batched to instance B where possible.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **One index, filter results after retrieval** | Leaks through counts, scores and pagination, and private content still shapes retrieval. |
| **Separate vector tables per visibility level** | Superficially safer, but ACLs are per-category masks and not a clean three-way partition, and moving content between levels becomes a cross-table migration. One table with an enforced predicate is simpler and testable. |
| **Trust the system prompt to withhold gated content** | A prompt is a request. Retrieved forum content is attacker-controlled text. This is the failure mode the design exists to prevent. |
| **Give the agent its own read-only database replica** | A second enforcement point that will drift from the API's guards. The agent must have exactly one route to data. |
| **Index only public content** | Discards most of the AI's value — the officer asking about officer material is a primary use case. |
| **Re-index nightly instead of on change** | Leaves a window of up to 24 hours in which moved content is retrievable at its old visibility. Unacceptable for the exact scenario this ADR addresses. |
| **Pure vector search without keyword hybrid** | Not a security issue but a correctness one: vector search is poor at exact identifiers — CMDR names, system names, callsigns like `K7Q-B4X` — which is precisely what members search for. Hybrid vector + Meilisearch BM25, merged by Reciprocal Rank Fusion, with the ACL filter applied to both legs. |
