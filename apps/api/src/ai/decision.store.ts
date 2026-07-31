import type { PrismaClient } from '@prisma/client';
import {
  DRIFT,
  FEWSHOT_LIMIT,
  FEWSHOT_MIN_SIMILARITY,
  type DecisionSource,
  type ScreenDecision,
} from '@grims/shared';
import type { EmbedClient } from './embed.client.js';

/**
 * The decisions the screener learns from.
 *
 * ★ THE LABEL IS ALWAYS A HUMAN'S ★
 *
 * `shouldFlag` comes from a moderator or an upheld report. `modelFlagged` is recorded beside it for
 * drift measurement only — never as a label. A screener trained on its own verdicts compounds its
 * first mistake forever, and would do so while every metric said it was agreeing with itself.
 *
 * ★ WHY RAW SQL ★
 *
 * pgvector. Prisma has no native type for it, so the column is invisible to the generated client
 * and both the write and the nearest-neighbour read have to be raw. Confined to this file so
 * nothing else has to know.
 */
export class DecisionStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly embed: EmbedClient,
  ) {}

  /**
   * Records what a human decided.
   *
   * Best-effort by design: the caller has already released or refused the post, and that decision
   * must stand whether or not we manage to learn from it. A failure here costs one example.
   */
  async record(entry: {
    postId: string | null;
    text: string;
    shouldFlag: boolean;
    modelFlagged: boolean;
    source: DecisionSource;
    decidedBy: string | null;
  }): Promise<void> {
    const vector = await this.embed.embed(entry.text);

    /*
     * Stored even when the embedding failed. The row is still evidence for drift measurement and
     * can be embedded later; discarding it would lose the moderator's judgement because a helper
     * model happened to be offline.
     */
    await this.db.$executeRawUnsafe(
      `INSERT INTO screen_decisions
         (post_id, text, should_flag, model_flagged, source, decided_by, decided_at, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, now(), ${vector === null ? 'NULL' : `'[${vector.join(',')}]'::vector`})`,
      entry.postId,
      entry.text.slice(0, 4_000),
      entry.shouldFlag,
      entry.modelFlagged,
      entry.source,
      entry.decidedBy,
    );
  }

  /**
   * The most similar past decisions, as precedent for a post being screened now.
   *
   * ★ SIMILAR, NOT RECENT ★
   *
   * Recency would show the model whatever happened to be judged last, which is usually about
   * something else entirely. Five near-neighbours carry how THIS squadron judges THIS kind of post,
   * which is the only thing worth spending prompt space on.
   *
   * Empty on any failure — including no embedding model at all — so screening simply proceeds
   * without precedent, exactly as it did before this existed.
   */
  async similar(text: string): Promise<ScreenDecision[]> {
    const vector = await this.embed.embed(text);
    if (vector === null) return [];

    try {
      /*
       * `<=>` is cosine DISTANCE, so similarity is 1 - distance. Ordering by the operator is what
       * lets the HNSW index serve this; computing similarity in a WHERE clause instead would force
       * a sequential scan over every decision ever made.
       */
      const rows = await this.db.$queryRawUnsafe<
        Array<{ text: string; should_flag: boolean; model_flagged: boolean; source: string; similarity: number }>
      >(
        `SELECT text, should_flag, model_flagged, source,
                1 - (embedding <=> $1::vector) AS similarity
           FROM screen_decisions
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT $2`,
        `[${vector.join(',')}]`,
        FEWSHOT_LIMIT,
      );

      return rows
        /*
         * The floor is applied AFTER the index has done its work. A nearest neighbour is still the
         * nearest even when nothing is close, and an unrelated example is worse than none — it
         * teaches the model that an unrelated post is precedent.
         */
        .filter((r) => r.similarity >= FEWSHOT_MIN_SIMILARITY)
        .map((r) => ({
          text: r.text,
          shouldFlag: r.should_flag,
          modelFlagged: r.model_flagged,
          source: r.source as DecisionSource,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Whether the screener is drifting, and which way.
   *
   * ★ THE ALARM FOR THE FAILURE THIS WHOLE MECHANISM COULD CAUSE ★
   *
   * Moderators only see posts the model flagged, so the loop can only ever say "you over-flagged".
   * Left alone it would drift toward permissiveness — the dangerous direction, and the one the
   * review queue structurally cannot see.
   *
   * So the two rates are watched separately: releases say it is too strict, upheld reports say it
   * is too permissive. Silence below a minimum sample, because three decisions is not a trend.
   */
  async drift(): Promise<{ note: string; level: 'info' | 'warn' } | null> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{ source: string; should_flag: boolean; n: bigint }>
    >(
      `SELECT source, should_flag, COUNT(*)::bigint AS n
         FROM screen_decisions
        WHERE created_at > now() - interval '30 days'
        GROUP BY 1, 2`,
    );

    const total = rows.reduce((sum, r) => sum + Number(r.n), 0);
    if (total < DRIFT.minSample) return null;

    const count = (source: string, shouldFlag: boolean): number =>
      Number(rows.find((r) => r.source === source && r.should_flag === shouldFlag)?.n ?? 0);

    const reviewed = count('review', true) + count('review', false);
    const released = count('review', false);
    const reports = count('report', true) + count('report', false);
    const upheld = count('report', true);

    if (reviewed > 0 && released / reviewed >= DRIFT.releaseRateHigh) {
      return {
        level: 'warn',
        note: `Screening may be too strict — officers released ${released} of ${reviewed} held posts.`,
      };
    }
    if (reports > 0 && upheld / reports >= DRIFT.reportUpheldHigh) {
      return {
        level: 'warn',
        note: `Screening may be too permissive — ${upheld} of ${reports} reported posts were upheld.`,
      };
    }
    return { level: 'info', note: `Screening steady over ${total} decisions.` };
  }
}
