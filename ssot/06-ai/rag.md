# RAG PIPELINE

**`knowledge_chunks.visibility` is a security control, not metadata** (ADR-015, INV-003). Read `03-data/schema.prisma`'s comment on that column before changing anything here. This whole file exists to prevent one failure: a recruit receiving a summary of an officer-only thread.

## Indexing

```
Content created / edited / moved / deleted
  → BullMQ job (queue: rag-index)
  → chunk: 600 tokens, 80 overlap, RESPECTING markdown headings
  → embed via Ollama (nomic-embed-text, pinned forever)
  → upsert into knowledge_chunks WITH THE SOURCE'S VISIBILITY VALUE
  → on source deletion or ACL change: DELETE or RE-INDEX the chunks
```

### Sources indexed
| Source | `sourceType` | Visibility derived from |
|---|---|---|
| Forum post | `forum_post` | its category's `viewPerm` |
| Forum thread title + first post | `forum_post` | its category's `viewPerm` |
| Wiki page | `wiki` | the page's visibility |
| Doctrine build description | `doctrine` | `loadout.visibility` |
| Loadout comment | `loadout` | `loadout.visibility` |
| Guide | `guide` | its category's `viewPerm` |
| GalNet article | `galnet` | always `public` |
| AAR | `aar` | its category's `viewPerm` |

### Chunking rules
- **600 tokens, 80 overlap.** Overlap prevents an answer from being cut in half at a boundary.
- **Respect markdown headings** — never split mid-section. A chunk that starts halfway through a numbered procedure retrieves poorly and reads worse.
- Prepend the source title to each chunk's embedded text. A chunk saying "use grade 5" is meaningless without "Standard BGS Krait loadout" attached.
- Skip chunks under 50 tokens; they add noise and retrieve almost randomly.
- Code blocks and tables are kept whole even if that exceeds 600 tokens.

### The ACL propagation obligation — where this design breaks if you are careless
**Every mutation path that can change a source's visibility must enqueue a re-index.** Specifically:

| Event | Required action |
|---|---|
| Thread moved between categories | Re-index every chunk of every post in it |
| Category's `viewPerm` changed | Re-index every chunk under it, **including nested children** |
| Post soft-deleted | Delete its chunks |
| Post restored | Re-index |
| Loadout visibility changed | Re-index its chunks |
| Source hard-deleted (GDPR erasure) | Delete its chunks |
| Wiki page visibility changed | Re-index |

**`KnowledgeChunk` has no foreign key to its source** — sources are polymorphic across seven types. That makes this a hand-written correctness obligation the database cannot enforce, which is exactly why it carries a dedicated test and a tier-3 risk classification (ADR-021).

A test enumerates every content type against the registered re-index handlers. **A new content type without a handler fails CI**, because the alternative is discovering it through a leak.

**Re-indexing is not deferred to a nightly job.** A nightly rebuild leaves up to 24 hours in which moved content is retrievable at its old visibility. Unacceptable for the exact scenario this design addresses.

## Retrieval

**Hybrid: vector + BM25, merged by Reciprocal Rank Fusion.** Pure vector search is poor at exact identifiers — CMDR names, system names, callsigns like `K7Q-B4X` — which is precisely what members search for. Pure keyword search misses paraphrase. Both legs are needed, and **the ACL filter is applied to both.**

```sql
-- Vector leg. The visibility predicate is IN the query, evaluated WITH the ANN scan.
-- Never retrieve-then-filter: post-filtering leaks through counts and scores, and private
-- content still shapes what was retrieved.
SELECT id, title, content, source_type, source_id,
       1 - (embedding <=> $queryEmbedding) AS similarity
FROM knowledge_chunks
WHERE visibility = ANY($allowedVisibilities)               -- coarse tier
  AND (view_perm_mask IS NULL                              -- no mask beyond the tier
       OR (view_perm_mask & $callerMask) = view_perm_mask) -- exact mask test
ORDER BY embedding <=> $queryEmbedding
LIMIT 8;
```

> **The second predicate is not optional, and omitting it was a real leak.** An earlier revision
> showed only the `visibility = ANY(...)` line and relegated the mask test to prose. Forum
> categories carry an **arbitrary admin-editable `viewPerm`** (ADR-005) — "Site & Infrastructure"
> is gated on `SITE_CONFIG`, which no value of a four-member enum can express. With `visibility`
> defaulting to `public`, a sysadmin thread containing integration-key rotation steps indexed as
> **world-readable** — and the mandatory P8 leak test passed anyway, because it exercises an
> *officer* category, which does map cleanly (RED-TEAM R1).
>
> Two structural consequences, both now in the schema:
> 1. `knowledge_chunks.visibility` has **no default** — the indexer resolves a visibility
>    explicitly or refuses to index. It previously failed *open*.
> 2. `knowledge_chunks.view_perm_mask` carries the source's exact mask. An unresolvable ACL sets
>    `visibility = officer` **and** the most restrictive mask — it fails *closed*.

```
Meilisearch leg: same query, BM25, with the identical ACL filter expression.
Merge: RRF, k = 60, score = Σ 1 / (k + rank_i)
Final: top 8 chunks into context, each wrapped in <retrieved> tags (06-ai/prompts.md)
```

### Mask → allowed visibilities
| Caller holds | `allowedVisibilities` |
|---|---|
| nothing | `['public']` |
| `FORUM_VIEW_MEMBER` | `['public', 'squadron']` |
| `FORUM_VIEW_OFFICER` | `['public', 'squadron', 'officer']` |
| own content | plus `private` rows **owned by that caller**, applied as a row-level ownership predicate — not as a visibility value |

**Category-specific permissions beyond the three tiers** (for example BGS Intelligence gated on `BGS_REPORT`) are handled by storing the category's `viewPerm` on the chunk's `metadata` and adding a mask test to the predicate. **The three-value `visibility` enum is a fast coarse filter, not the whole check** — a design that relied on the enum alone would leak the moment a category used a custom mask.

### The Meilisearch leg needs the same protection, and it is easy to forget
The BM25 leg reads a **second copy of the ACL** in Meilisearch — a separate mirror, updated by a
separate BullMQ job whose queue state lives in Redis. A Redis restart, or a Meilisearch OOM on
the 8 GB box, drops queued re-index jobs.

**The failure is asymmetric:** Postgres says a moved thread is Ring 2 while the Meilisearch
document still says public. INV-024's test indexes a token and searches immediately, so it
exercises a *freshly indexed* document and passes. The P8 leak test asserts "retrieval returned
zero rows … asserted by inspecting the SQL" — **Meilisearch is not SQL, so that assertion cannot
cover it** (ARCH-ADV A4).

Therefore:
- The Meilisearch re-index job gets **the same treatment as the pgvector one**: a failure after
  an ACL change alerts immediately and is treated as a potential leak.
- A **nightly divergence sweep** compares each indexed document's ACL against its source and
  alerts on any mismatch — both mirrors, not just Postgres.
- The mandatory leak test asserts **zero rows from both legs**, checked independently before the
  RRF merge.

### Optional rerank
A small cross-encoder rerank pass after the merge, if retrieval quality proves insufficient. **Only ever applied to the already-ACL-filtered set** — reranking is a relevance step and must never widen the candidate pool.

## The mandatory ACL leak test

**A P8 phase-exit criterion. Claiming the phase is done without running it is a defect** (`docs/PROMPT-PHASES.md`).

```
Given:  a forum thread in a Ring 2 (officer) category containing a unique nonsense token
When:   a Ring 0 user asks GSAI a question whose only possible answer is in that thread
Then:   1. the answer contains nothing from the thread; AND
        2. THE RETRIEVAL RETURNED ZERO ROWS
```

**Both halves.** An empty answer over a non-empty retrieval means the content reached the model and the model chose not to use it — that is luck, not a control, and it will fail the next time the model is changed.

Additional cases in the same suite:
- The same question after the thread is **moved** from an officer category to a public one → now retrievable. Proves re-indexing works in the permissive direction too.
- The same question after the thread is moved **back** → not retrievable again. Proves it works in the restrictive direction, which is the one that matters.
- A `private` loadout comment, queried by another member → zero rows.
- A **soft-deleted** post → zero rows.

## Embedding and re-index economics

- **The embedding model is pinned forever.** Changing `nomic-embed-text` invalidates every vector and forces a full re-index (ADR-011).
- ⚠ **Dimension conflict, decision D16:** the spec declares `vector(1024)` while pinning a 768-dimension model. **Resolve before P8.9.**
- Incremental indexing runs on **instance A's co-resident embedder** — small, frequent, low latency.
- **Bulk backfill runs on instance B overnight**, arbiter-gated. A full re-index of a mature forum is hours of embedding; it belongs on the free card while nobody is waiting.
- Re-index jobs are idempotent and keyed by `(sourceType, sourceId)`, so a duplicate enqueue is harmless.

## Failure modes

| Failure | Detection | Response |
|---|---|---|
| Embedder unavailable | Ollama call fails | Queue the job with backoff. **Content is searchable via Meilisearch meanwhile** — degraded, not broken. |
| Re-index job fails after an ACL change | job failure metric | **Alert immediately, and treat as a potential leak** until re-run. This is the one queue failure that is a security event. |
| Chunk orphaned (source deleted, chunk survived) | nightly consistency sweep | Delete. Alert if the count is non-zero — it means a delete path is missing a handler. |
| Retrieval returns nothing | empty result | **Say so honestly.** "No accessible sources found." Never fabricate, and never hint that inaccessible material exists. |
| HNSW index missing | query plan check | Sequential scan over every vector. Slow, not wrong — but it will look like an outage. |
| Dimension mismatch | insert error | Every insert fails. See decision D16 — resolve before building on it. |

## Operational notes

- Build the HNSW index **after** the initial bulk load. Building it empty then inserting is dramatically slower.
- `knowledge_chunks` grows with content, not with membership. Expect 1–3 GB including the index for a mature forum.
- The RAG index lives in **Postgres on the VPS**, not on the local box — it is squadron data and is subject to the same enforcement as everything else. Retrieval happens through the API (INV-016).
- Chunk counts per source are recorded so the admin dashboard can show index coverage and spot a source that silently stopped indexing.
