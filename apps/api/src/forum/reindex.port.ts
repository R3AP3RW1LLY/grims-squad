/**
 * "This content's visibility changed — the search and RAG indexes must catch up."
 *
 * ★ A PORT, BECAUSE THE CONSUMER IS TWO PHASES AWAY ★
 *
 * INV-003 is `due:P8`: a knowledge chunk's visibility must equal its source's
 * visibility AT TIME OF QUERY, so moving a thread from a public category to an
 * officer one has to re-index or delete its chunks before the next retrieval.
 * P2.1's acceptance requires the move to ENQUEUE that work.
 *
 * There is no queue in the API yet, and inventing one now would mean guessing at
 * P8's shape — BullMQ topology, retry policy, dead-letter handling — and getting
 * it wrong in a way that is expensive to unpick. So this is the seam: P2 calls
 * it, P8 implements it against the real queue.
 *
 * ★ WHY NOT JUST OMIT IT UNTIL P8 ★
 *
 * Because the CALL SITE is the thing that gets forgotten. Adding the queue later
 * is easy; finding every place that should have enqueued and did not is the
 * failure this project has produced repeatedly — a control written, tested, and
 * never invoked. The call belongs in the same commit as the move it describes.
 *
 * ★ THE DEFAULT IMPLEMENTATION IS DELIBERATELY LOUD IN DEV AND SILENT IN PROD ★
 *
 * A no-op that says nothing would let P8 arrive and nobody notice the port had
 * been feeding a bin. A no-op that throws would break P2 for a P8 feature.
 */

export interface ReindexRequest {
  /** What changed. `thread` covers its posts — chunks are indexed per post. */
  readonly kind: 'thread';
  readonly id: string;
  /**
   * Why, so a P8 consumer can decide between re-index and delete without
   * re-deriving it. A move to a more restrictive category may mean DELETING
   * public-visibility chunks rather than rewriting them.
   */
  readonly reason: 'moved' | 'created' | 'updated' | 'deleted';
}

export interface ReindexQueue {
  enqueue(request: ReindexRequest): Promise<void>;
}

/**
 * The stand-in until P8.
 *
 * Records what it was asked to do so a test can assert the call happened, and
 * logs in development so the gap is visible to whoever is looking at it rather
 * than discovered when RAG starts returning officer content to members.
 */
export class PendingReindexQueue implements ReindexQueue {
  readonly requests: ReindexRequest[] = [];

  async enqueue(request: ReindexRequest): Promise<void> {
    this.requests.push(request);

    if (process.env['NODE_ENV'] !== 'production') {
      /*
       * `console.error` rather than a logger: this file must not pull in a
       * logging dependency for a placeholder, and stderr is where a developer
       * is already looking.
       */
      console.error(
        JSON.stringify({
          msg: 'reindex enqueued but NOT PROCESSED — no consumer until P8 (INV-003)',
          ...request,
        }),
      );
    }
  }
}
