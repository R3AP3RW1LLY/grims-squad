# ADR-024 — Member-contributed GPU compute for the AI service

**Status:** Proposed — design only, not scheduled · **Date:** 2026-07-27
**Depends on:** the AI service existing at all (P8)

## The ask

The AI service runs on the squadron owner's GPUs. Members should be able to
**opt in to contributing their own GPU** to the pool, with work distributed
round-robin by job type. Only discrete GPUs qualify — AMD, NVIDIA or Intel Arc.
No integrated graphics.

## Recorded, not built

This is written down now because it is a real requirement and chat is not where
requirements live. It is **not** being built in this pass, and saying so is the
honest thing: it is a distributed compute network, not a feature, and it lands
after the AI service it would serve.

## What has to be true before it is safe

★ **A CONTRIBUTED GPU IS SOMEBODY ELSE'S COMPUTER RUNNING OUR CODE** ★

That is the whole problem, and it is not a small one.

1. **The worker must not be able to read what it processes.** A member
   volunteering a GPU would be handed other members' prompts — which for a
   squadron AI means private questions, draft messages, and whatever somebody
   typed while assuming it went to a server. Either the work is public by
   construction, or this cannot ship. **This is the blocking constraint**, and
   no amount of scheduling cleverness substitutes for it.

2. **The result must not be trustable on its own.** A contributed node can
   return anything. For anything that affects a member's standing, results need
   corroboration from a second node or a check that does not rely on the node
   being honest.

3. **The contributor must not be exposed.** Running a compute worker means
   accepting jobs from the network. It must not open a port, must poll rather
   than listen, and must run the model in a sandbox that cannot reach the rest
   of their machine.

4. **It must be visibly, obviously stoppable.** Somebody's electricity bill and
   somebody's frame rate. Pause when the game launches, hard stop on a click, and
   a plain statement of what it costs to run — never a background process that
   quietly heats a GPU.

## Sketch, for when it is scheduled

- **Eligibility.** Discrete AMD / NVIDIA / Intel Arc only, detected rather than
  self-reported. Integrated graphics are excluded because the result would be
  slower than not distributing at all, and the contributor's machine would crawl.
- **Round-robin by job type.** Different jobs want different things — a large
  language model wants VRAM, an image job wants throughput. Nodes advertise
  capability; the scheduler matches rather than spraying.
- **Health and honesty.** A node that is slow, wrong, or gone gets dropped
  automatically. Contribution is visible to the contributor and to nobody else
  by default.

## Why the constraint above is not negotiable

The failure mode is not "the feature works badly". It is a member discovering
that a question they asked the squadron AI was processed on another member's
desktop. That is not a bug to fix afterwards — it is the reason to design this
properly or not build it.
