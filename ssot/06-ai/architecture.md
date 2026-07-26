# GSAI ARCHITECTURE

## Design goals

1. Runs entirely on the local box via Ollama — no per-token cost, no member data leaving our control.
2. Reachable from the public site through a secure tunnel, **with the site never trusting the tunnel blindly**.
3. Can *actually do things* through a permissioned tool registry, not just talk.
4. **Degrades gracefully.** Box off → the site is unaffected (INV-030).
5. **Inherits the caller's permissions exactly.** The AI is never more privileged than the person asking.

## Request path

```
Browser / Discord
      │ WSS
      ▼
┌──────────────────────────────────────────────────────────┐
│ api  (VPS)                                               │
│  · authn/authz, rate limit, PII redaction                │
│  · builds AiRequest{ userId, permMask, messages, ctx }    │
│  · HMAC-signs it with a single-use nonce + 60s window     │
└──────────────────────┬───────────────────────────────────┘
                       │ WireGuard (control plane) — mTLS — signed payload
                       ▼
┌──────────────────────────────────────────────────────────┐
│ gsai-gateway  (local box)                                │
│  · verify signature + nonce (replay guard)                │
│  · concurrency semaphore, per-user quota                  │
│  · heartbeat to the API every 15s                         │
└──────────────────────┬───────────────────────────────────┘
                       ▼
        ┌──────────── FAST PATH ────────────┐
        │ embedding-similarity classifier    │   ~70% of traffic
        │ over ~40 canned intents, NO LLM    │   <200ms, zero hallucination
        │ → direct tool call → template      │
        └──────────────┬─────────────────────┘
                       │ low confidence
                       ▼
┌──────────────────────────────────────────────────────────┐
│ gsai-agent                                               │
│   Planner ──▶ Ollama (instance chosen by the arbiter)    │
│      │ tool_calls[]                                       │
│   ┌──▼─────────────────────────────────────────────┐     │
│   │ Tool Executor                                   │     │
│   │  1. Zod-validate args                           │     │
│   │  2. permission gate vs the caller's mask        │     │
│   │  3. confirmation gate for every mutating tool   │     │
│   │  4. execute → BACK over the tunnel to the API   │     │
│   │  5. truncate + audit (including denials)        │     │
│   └──┬──────────────────────────────────────────────┘     │
│      │ tool results                                        │
│   Loop (MAX_STEPS 6 on 8b / 8 on 14b) → answer + citations │
│                                                            │
│   RAG: pgvector + Meilisearch BM25, RRF-merged,            │
│        ACL-filtered IN the query (INV-003, INV-024)        │
└──────────────────────────────────────────────────────────┘
```

## The critical inversion

**Tools that touch squadron data do not run against a local copy of the database.** The agent calls **back** through the tunnel to the `api` service, presenting the *same* signed user context.

That means the API's existing authorization guards enforce everything, once, in one place. **The AI physically cannot bypass them because it has no other route to the data** — no database URL in its configuration, no read replica, and an egress allowlist that permits only Ollama on localhost, our API, and the whitelisted ED APIs (INV-016).

The cost is latency on every data-touching tool call. That cost is accepted deliberately: a second enforcement point inside the agent would drift from the first, and a drifted authorization check is how leaks happen.

## The fast path is the front door (ADR-012)

```
user message
  → embedding similarity against ~40 canned intents
  → HIGH CONFIDENCE  → extract params → call the tool → render a template. NO LLM.
  → otherwise        → agent loop, instance chosen by the arbiter
```

- Target ~70% of traffic; **phase exit requires ≥60% measured on real queries.**
- Only read tools with `fast_path: true` qualify. **No mutating tool is ever fast-pathed.**
- Confidence threshold starts conservative. **A miss costs one extra second; a false positive gives a confidently wrong answer.** That asymmetry sets the default.
- Templated responses carry exactly the same freshness and provenance obligations as generated ones (INV-004).
- **Build the fast path before the agent loop** (P8.6 precedes P8.8). Reversed, the loop "works" and the fast path never gets built.

## Instance routing — the GPU arbiter

Two isolated Ollama instances, one per GPU (ADR-011). The arbiter decides whether instance B may be used.

```ts
// apps/gsai/arbiter.ts — the routing decision
const GAME_PROCESSES = ['EliteDangerous64', 'EliteDangerous32'];

async function heavyAvailable(): Promise<boolean> {
  if (await gameIsRunning(GAME_PROCESSES)) return false;   // the game always wins
  if (await gpuTempC(HEAVY_GPU_UUID) > 83) return false;   // thermal guard
  return (await freeVramMb(HEAVY_GPU_UUID)) > 11_000;      // headroom for the 14b
}

export async function pickInstance(req: AiRequest): Promise<Target> {
  if (req.kind === 'batch' || req.kind === 'scheduled')
    return (await heavyAvailable()) ? HEAVY : DEFER;    // batch waits; it isn't urgent
  if (req.complexityHint === 'high' && await heavyAvailable()) return HEAVY;
  if (queueDepth(INTERACTIVE) > 3 && await heavyAvailable()) return HEAVY;  // genuine overflow
  return INTERACTIVE;                                    // the default path
}
```

- Poll every 15 s, cache the result, expose it on the admin health dashboard as `GSAI-HEAVY: available | gaming | busy`.
- **`DEFER` is not an error.** Batch work waits for the card; nobody is watching.
- On game launch, `KEEP_ALIVE=5m` means instance B releases VRAM on its own within five minutes, and the arbiter stops routing to it immediately.
- **Scheduled jobs run on instance B overnight** — the nightly BGS digest, weekly forum summaries and embedding backfill. The maintainer is asleep, the card is free, and members wake up to a briefing written by the better model.

## Agent loop

```ts
async function runAgent(req: AiRequest): Promise<AiResponse> {
  const tools = registry.forPermissions(req.permMask);   // FILTERED UP FRONT — INV-011
  const selected = preselect(tools, req, 10);            // 8-10 most plausible — ADR-012 R9
  const messages = [systemPrompt(req), ...rollHistory(req.messages)];
  const trace: ToolInvocation[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {         // 6 on the 8b, 8 on the 14b
    const res = await ollama.chat({
      model: pickModel(req), messages,
      tools: selected.map(toOllamaSchema), stream: true,
      options: { temperature: 0.3, num_ctx: 16384 },
    });

    if (!res.message.tool_calls?.length) return { text: res.message.content, trace };

    for (const call of res.message.tool_calls) {
      const tool = selected.find(t => t.name === call.function.name);
      if (!tool) { messages.push(toolError(call, 'Unknown tool')); continue; }

      const parsed = tool.schema.safeParse(call.function.arguments);
      if (!parsed.success) {                             // feed the error back
        messages.push(toolError(call, fmtZod(parsed.error)));  // so it self-corrects
        continue;
      }

      if (!hasPermission(req.permMask, tool.permission)) {
        await audit({ ...call, outcome: 'denied' });     // the denial IS the evidence
        messages.push(toolError(call, 'Permission denied'));
        continue;
      }

      if (tool.mutating && !req.confirmedActions?.includes(hashCall(call))) {
        return { needsConfirmation: { tool: tool.name, args: parsed.data,
                 preview: await tool.preview?.(parsed.data, req) }, trace };
      }

      const started = Date.now();
      try {
        const result = await withTimeout(tool.handler(parsed.data, ctx(req)), tool.timeoutMs);
        messages.push({ role: 'tool', name: tool.name,
                        content: JSON.stringify(truncateForContext(result, tool.maxResultChars)) });
        trace.push({ ...call, outcome: 'ok', ms: Date.now() - started });
      } catch (e) {
        messages.push(toolError(call, String(e)));
        trace.push({ ...call, outcome: 'error', ms: Date.now() - started });
      }
      await audit(trace.at(-1)!);
    }
  }
  return { text: 'I hit my step limit on that one, CMDR. Try narrowing it down.', trace };
}
```

**The details that carry the security properties:**
- Tools filtered by permission **before the model ever sees them** — the model cannot call what it does not know exists.
- Zod errors fed back so the model self-corrects rather than failing the turn.
- Every result truncated before it enters the context window.
- **Every invocation audited whether it succeeded, failed, or was denied.**
- Step-limit exhaustion produces an honest partial answer, never a fabricated one.

## Availability states

Gateway heartbeats the API every 15 s. **Three missed beats → `OFFLINE`.**

| State | Behaviour |
|---|---|
| `ONLINE` | Full streaming interactive |
| `DEGRADED` | Queued, with a position indicator and an honest estimate |
| `OFFLINE` | **The UI says so plainly.** Read-only queries fall back to direct API calls with templated, non-LLM responses. Chat requests queue and are delivered by Discord DM on reconnect. Scheduled jobs roll over. |

The OFFLINE fallback is cheap precisely because the fast path already exists — templated responses are not a special case built for outages, they are the normal path for most traffic.

**Nothing outside the GSAI subsystem may depend on the gateway** (INV-030). With the box powered off, every other feature works.

## Surfaces

**Web** — a slide-over panel on ⌘K / Ctrl+K, available on every page, with page context injected: on a system page, *"what's the market here"* needs no system name. Tokens stream over WebSocket; tool calls render as collapsible cards; confirmations are inline buttons.

**Discord** — `/gsai <question>`, `@mention`, thread-aware follow-ups, ephemeral replies for anything privacy-sensitive. **Uses the invoking member's Discord roles — the same permission mask, the same tools, the same brain.**

**Proactive** (opt-in, rate-limited) — daily ops briefing, BGS tick summary with what changed and what to do about it, market alerts, recruitment summaries for officers, weekly forum digest. All on instance B, overnight.

**Voice** — deferred to P9 (`scope.md`).

## Component inventory

| Component | Runs on | Responsibility |
|---|---|---|
| `gsai-gateway` | local box | Signature/nonce verification, semaphore, quota, heartbeat |
| `gsai-agent` | local box | Fast path, agent loop, tool executor, RAG retrieval |
| `arbiter` | local box | GPU availability, game detection, thermal guard, routing |
| `ollama-interactive` | RTX 3060, :11434 | `qwen3:8b`, resident 24/7 |
| `ollama-heavy` | RTX 5070 Ti, :11435 | `qwen3:14b`, arbiter-gated |
| tool handlers | local box → API | Call back over the tunnel with the caller's signed context |
| RAG index | Postgres on the VPS | pgvector + Meilisearch, ACL-filtered |

**The RAG index lives on the VPS, not the local box** — it is squadron data, subject to the same ACL enforcement as everything else, and retrieval happens through the API for exactly the reason in "The critical inversion" above.
