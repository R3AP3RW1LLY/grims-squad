import { Controller, Get, Post, Delete, Body, Param, Query, Inject, Res } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import {
  AppError,
  ErrorCode,
  Permission,
  KNOWLEDGE_SOURCES,
  type SourceStatus,
  type CategoryProgress,
  type BuildRoleProgress,
} from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PermissionService } from '../authz/permission.service.js';
import { satisfiesMask } from '../forum/category.service.js';
import { AiStreamService, type AiLogLine } from './ai-stream.service.js';
import {
  ShipBuildService,
  ShipBuildQueries,
  ShipyardService,
  type BuildView,
  type ImportOutcome,
} from './ship-build.service.js';
import type { FitRole } from '@grims/ed-clients';
import { AiClient, aiHealth } from './ai.client.js';
import { ImageClient } from './image.client.js';
import { TrainingStatusService } from './training.service.js';
import { CorpusService, type SubmissionView } from './corpus.service.js';
import { AssistantService } from './assistant.service.js';

/** Accepted thread ids. An unvalidated string reaching an indexed uuid column fails the insert. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each runtime reported on its own, because they run on different cards and fail independently.
 *
 * ★ NO MODEL IDENTIFIER LEAVES THIS ROUTE ★
 *
 * Squadron owner, 2026-07-31: "please only refer to our AI as GMSD AI ... dont mention any 3rd
 * party AI models in this app or website".
 *
 * This response used to carry `model`, and the moderation tab rendered it faithfully — so an
 * officer opening the admin area read the raw model name off an environment variable. Nobody had
 * typed it anywhere; it simply travelled.
 *
 * The field is GONE rather than blanked, so a future edit cannot reintroduce it by populating
 * something that already exists. `aiHealth()` still resolves the model internally to make the
 * request; it is dropped here, at the boundary, which is the only place the guarantee holds.
 */
export interface AiHealth {
  readonly text: {
    readonly configured: boolean;
    readonly reachable: boolean;
    readonly tookMs: number;
  };
  readonly image: {
    readonly configured: boolean;
    readonly reachable: boolean;
    readonly tookMs: number;
  };
}

/**
 * The AI's live view, for the admin area.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "we also want realtime streaming logs for ai in the admin area for the AI, just dont show PC file
 * paths into this streaming logs servic please."
 *
 * Paths are stripped inside `AiStreamService.emit`, which every line passes through — a single
 * funnel, so the guarantee is structural rather than something each call site remembers.
 *
 * ★ GATED ON AI_REVIEW ★
 *
 * The same permission that opens the review queue: officers, and the webmaster automatically. Not
 * AI_TOOLS_ADMIN, which would also mean kill switches and quota overrides.
 */
@Controller('v1/ai')
export class AiController {
  constructor(
    @Inject(AiStreamService) private readonly stream: AiStreamService,
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(ImageClient) private readonly images: ImageClient,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(TrainingStatusService) private readonly trainingStatus: TrainingStatusService,
    @Inject(CorpusService) private readonly corpusService: CorpusService,
    @Inject(AssistantService) private readonly assistant: AssistantService,
    @Inject(ShipBuildService) private readonly builds: ShipBuildService,
    @Inject(ShipBuildQueries) private readonly buildQueries: ShipBuildQueries,
    @Inject(ShipyardService) private readonly shipyard: ShipyardService,
  ) {}

  // ------------------------------------------------------------- ship builds
  /**
   * Every build the squadron holds.
   *
   * ★ NOT GATED, LIKE THE CORPUS PROGRESS ABOVE ★
   *
   * The owner chose squadron-wide and credited: "any member can ask what people are flying and get
   * real answers with names". A build only its submitter can see teaches the assistant nothing
   * anybody asked for, and gating the LIST while the assistant quotes them anyway would be a
   * distinction without a difference.
   */
  @Get('builds')
  async listBuilds(
    @User() caller: CurrentUser | undefined,
    @Query('ship') ship?: string,
  ): Promise<{
    builds: BuildView[];
    progress: BuildRoleProgress[];
    canSubmit: boolean;
    canModerate: boolean;
  }> {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const mask = await this.permissions.effectiveMask(caller.userId);

    const [builds, progress] = await Promise.all([
      this.buildQueries.list(ship === undefined ? {} : { shipId: ship }),
      this.buildQueries.progress(),
    ]);

    return {
      builds,
      progress,
      canSubmit: (mask & Permission.AI_TRAIN_SUBMIT) === Permission.AI_TRAIN_SUBMIT,
      canModerate: (mask & Permission.AI_REVIEW) === Permission.AI_REVIEW,
    };
  }

  /**
   * Imports a build from a link somebody found.
   *
   * ★ FOUND IN THE WILD, NOT NECESSARILY THEIRS ★
   *
   * Squadron owner, 2026-08-01: "the training import are for builds they find in the wild". So this
   * is a contribution, like a training image — gated on AI_TRAIN_SUBMIT rather than on owning the
   * ship. Their own ships arrive separately, from their journals.
   */
  @Post('builds')
  async importBuild(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
  ): Promise<ImportOutcome> {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const mask = await this.permissions.effectiveMask(caller.userId);
    if ((mask & Permission.AI_TRAIN_SUBMIT) !== Permission.AI_TRAIN_SUBMIT) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot submit training material.');
    }

    const url = typeof (body as { url?: unknown })?.url === 'string' ? (body as { url: string }).url : '';
    if (url.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Paste a build link.');
    }

    return this.builds.importLink(url, { submittedById: caller.userId, isBaseline: false });
  }

  /**
   * Imports a BASELINE build — the squadron's reference, not somebody's contribution.
   *
   * ★ SQUADRON OWNER, 2026-08-01 ★
   *
   * "in the admin /app/training i want to add a section where the webmaster can import via link in
   * the same way all the default ship builds please this will be the base level".
   *
   * ★ WHY THE DISTINCTION IS LOAD-BEARING ★
   *
   * A baseline says "this is how the squadron does it"; a member's build says "this is what
   * somebody flies". The assistant weights them differently and cites them differently, so
   * collapsing the two would let one person's experiment answer as doctrine.
   *
   * `AI_TRAINING`, which is the permission the training page itself runs on — the same officers who
   * decide what the assistant learns decide what its reference builds are.
   *
   * A bare `coriolis.io/outfit/<ship>` link is the STOCK ship, which is exactly what a baseline
   * import wants and needs no build code at all.
   */
  @Post('builds/baseline')
  async importBaseline(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
  ): Promise<ImportOutcome> {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const mask = await this.permissions.effectiveMask(caller.userId);
    if ((mask & Permission.AI_TRAINING) !== Permission.AI_TRAINING) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot manage what the assistant learns.');
    }

    const url = typeof (body as { url?: unknown })?.url === 'string' ? (body as { url: string }).url : '';
    if (url.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, 'Paste a build link.');

    /*
     * `submittedById: null` — a baseline belongs to the squadron rather than to whoever pasted it.
     * Crediting the webmaster on forty reference builds would put one name against the whole
     * doctrine and make the credit meaningless where it matters, on members' own contributions.
     */
    return this.builds.importLink(url, { submittedById: null, isBaseline: true });
  }

  // ---------------------------------------------------------------- shipyard
  /**
   * Every hull, for the Shipyard's ship picker.
   *
   * ★ SQUADRON OWNER, 2026-08-01 ★
   *
   * "a page under squadron called Shipyard ... 2 options build my own or AI Assisted build".
   *
   * Ungated beyond sign-in. Outfitting is not a privileged act — it is a member working out what to
   * save for, and the data is Frontier's own.
   */
  @Get('shipyard/ships')
  async shipyardShips(@User() caller: CurrentUser | undefined) {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    return { ships: await this.shipyard.ships() };
  }

  /**
   * One hull and every module that fits it.
   *
   * ★ THE WHOLE THING GOES DOWN AT ONCE ★
   *
   * A Coriolis-style outfitter re-computes mass, power and jump the instant a module changes.
   * Asking the server per click would put a round trip between picking a power plant and seeing
   * what it did — the one thing that screen has to feel immediate about.
   */
  @Get('shipyard/outfit/:shipId')
  async shipyardOutfit(
    @User() caller: CurrentUser | undefined,
    @Param('shipId') shipId: string,
  ) {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const outfit = await this.shipyard.outfit(shipId);
    if (outfit === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'We do not have that ship in our data.');
    }
    return outfit;
  }

  /**
   * Fits a ship for a role, within a budget.
   *
   * ★ THE ANSWER IS COMPUTED, NOT WRITTEN ★
   *
   * This is what the AI-assisted path calls and what the assistant will call. Every module comes
   * from Frontier's data and every number from the stats calculator — the model's job is to explain
   * the result, never to invent one.
   */
  @Post('shipyard/fit')
  async shipyardFit(@User() caller: CurrentUser | undefined, @Body() body: unknown) {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const input = (body ?? {}) as Record<string, unknown>;
    const role = typeof input['role'] === 'string' ? input['role'] : '';

    const ROLES: readonly string[] = ['mining', 'combat', 'explorer', 'trader'];
    if (!ROLES.includes(role)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `Unknown role: ${role}`);
    }

    const budget = typeof input['budget'] === 'number' && input['budget'] > 0 ? input['budget'] : undefined;
    const shipId = typeof input['shipId'] === 'string' && input['shipId'] !== '' ? input['shipId'] : undefined;

    const fit = await this.builds.fit({ role: role as FitRole, budget, shipId });

    if (fit === null) {
      /*
       * Nothing affordable is a real answer, and saying so beats fitting the cheapest hull anyway
       * and letting somebody discover the price at the shipyard.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        budget === undefined
          ? 'No ship could be fitted for that.'
          : `Nothing can be fitted for that role within ${Math.round(budget / 1_000_000)} million credits.`,
      );
    }

    return fit;
  }

  /** Removes a build: your own always, anybody's with AI_REVIEW. */
  @Delete('builds/:id')
  async removeBuild(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const mask = await this.permissions.effectiveMask(caller.userId);
    const canModerate = (mask & Permission.AI_REVIEW) === Permission.AI_REVIEW;

    await this.buildQueries.remove(id, caller.userId, canModerate);
    return { removed: true };
  }

  /**
   * Is the model answering, right now.
   *
   * ★ THE SAME ANSWER ON LOCALHOST AND ON THE SERVER ★
   *
   * `AI_BASE_URL` is `http://127.0.0.1:11434/v1` in both places. On a development machine that is
   * Ollama running locally; on the Vultr box it is the near end of the SSH reverse tunnel, which
   * forwards that port to the same Ollama. One value, one code path, no environment branching —
   * which is what makes "it worked locally" mean anything.
   */
  @Get('health')
  async health(@User() caller: CurrentUser | undefined): Promise<AiHealth> {
    await this.#assertMayReview(caller);

    /*
     * BOTH sides, reported separately, and asked in PARALLEL.
     *
     * They are two runtimes on two graphics cards, and they fail independently — the usual state
     * during a game session is text up, image busy. One combined "AI: ok/down" would be wrong most
     * evenings and would send an officer looking for a fault that is somebody playing Elite.
     *
     * Parallel because each has its own four-second timeout, and an admin panel that takes eight
     * seconds to say "both down" is one nobody opens twice.
     */
    const [text, image] = await Promise.all([aiHealth(this.ai), this.images.health()]);

    return {
      // `model` is deliberately destructured away and not spread. See AiHealth.
      text: { configured: this.ai.configured, reachable: text.reachable, tookMs: text.tookMs },
      image: { configured: this.images.configured, ...image },
    };
  }

  /**
   * The live log.
   *
   * SSE rather than websockets, matching the existing live stream: it is a GET that never ends, so
   * it carries the session cookie like any other request and needs no second auth path.
   */
  @Get('stream')
  async logStream(
    @User() caller: CurrentUser | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.#assertMayReview(caller);

    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      /*
       * Every one of these is load-bearing, for the reasons spelled out on the members' live
       * stream: an intermediary that caches an endless response never ends the request, and
       * `x-accel-buffering: no` is what stops Caddy holding events until a buffer fills — which
       * works perfectly in development and fails only in production.
       */
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    raw.write(': connected\n\n');

    const send = (line: AiLogLine): void => {
      raw.write(`event: ai\ndata: ${JSON.stringify(line)}\n\n`);
    };

    // The recent backlog first, so a freshly-opened panel is not an empty box that looks broken.
    for (const line of this.stream.recent()) send(line);

    const unsubscribe = this.stream.subscribe(send);

    /*
     * The heartbeat is not optional: proxies close idle connections at around 60 seconds, and a
     * stream that dies silently reconnects forever while appearing to work.
     */
    const heartbeat = setInterval(() => {
      try {
        raw.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  /**
   * What the assistant knows, per source.
   *
   * ★ GATED ON AI_TRAINING, NOT AI_REVIEW ★
   *
   * Reading a log and curating what the AI learns are different jobs. Officers hold both; the
   * separation matters because the training permission is also what will approve members'
   * screenshots, and that is a job worth handing to people who know Elite rather than to whoever
   * happens to administer the platform.
   */
  @Get('training')
  async training(@User() caller: CurrentUser | undefined): Promise<{ sources: SourceStatus[] }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const mask = await this.permissions.effectiveMask(caller.userId);
    if (!satisfiesMask(mask, Permission.AI_TRAINING)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot see the AI training status.');
    }

    return { sources: await this.trainingStatus.status() };
  }

  /**
   * Asks the worker to run one source now.
   *
   * ★ SQUADRON OWNER, 2026-08-01 ★
   *
   * "if any of the ingestion sources stall, we need to show a button to re-trigger."
   *
   * ★ IT PUBLISHES A REQUEST; IT DOES NOT RUN ANYTHING ★
   *
   * The ingests are containers cron starts and discards. This process has no Docker socket, and
   * giving a web-facing service the ability to start containers would be a much larger decision
   * than a refresh button warrants.
   *
   * So it NOTIFYs, and the resident worker daemon runs the job. If that daemon is not up, nothing
   * happens — which is why the response says the request was sent rather than that the job started.
   * Claiming a job began when nobody was listening would be the same class of lie as the stalled
   * run that prompted this.
   */
  @Post('training/:source/rerun')
  async rerun(
    @User() caller: CurrentUser | undefined,
    @Param('source') source: string,
  ): Promise<{ requested: true }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const mask = await this.permissions.effectiveMask(caller.userId);
    if (!satisfiesMask(mask, Permission.AI_TRAINING)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot start a training run.');
    }

    /*
     * Validated against the contract's own list before it reaches the channel. The daemon checks
     * again against what it is willing to spawn — two gates, because this value crosses a process
     * boundary and arrives there as a bare string.
     */
    if (!(KNOWLEDGE_SOURCES as readonly string[]).includes(source) && source !== 'embed') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not an ingestion source.');
    }

    /*
     * ★ EDDN CANNOT BE RUN, BECAUSE IT NEVER STOPS ★
     *
     * Every other source is a job the daemon spawns and waits for. The collector is a resident
     * subscriber in its own container; there is nothing to start, and the daemon rejects it as an
     * unknown source — which reached the member as "Requested" followed by nothing happening, the
     * exact silent failure the re-run button was built to remove.
     *
     * Said plainly here instead. If the collector is genuinely down, the answer is to restart its
     * container, and a button on this page cannot and should not do that.
     */
    if (source === 'eddn') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'The EDDN collector runs continuously rather than in scheduled runs, so there is nothing ' +
          'to start. If it has stopped reporting, its container needs restarting.',
      );
    }

    await this.trainingStatus.requestRun(source);
    return { requested: true };
  }

  /**
   * Help Train the Bot: where every category stands, and what this member has sent.
   *
   * ★ ONE ROUND TRIP FOR THE WHOLE PAGE ★
   *
   * The bars and the member's own list are always drawn together, and two endpoints would mean the
   * page renders in two stages with the second one arriving late — which for a progress bar reads
   * as the number changing on its own.
   *
   * ★ PROGRESS IS NOT GATED, SUBMITTING IS ★
   *
   * Anybody signed in may see how the collection is going. Whether they can add to it is
   * `AI_TRAIN_SUBMIT`, checked in the service, and the page uses `canSubmit` to say so plainly
   * rather than offering a form that will refuse them.
   */
  @Get('corpus')
  async corpus(@User() caller: CurrentUser | undefined): Promise<{
    categories: CategoryProgress[];
    mine: SubmissionView[];
    canSubmit: boolean;
  }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const mask = await this.permissions.effectiveMask(caller.userId);

    const [categories, mine] = await Promise.all([
      this.corpusService.progress(),
      this.corpusService.mine(caller.userId),
    ]);

    return {
      categories,
      mine,
      canSubmit: (mask & Permission.AI_TRAIN_SUBMIT) === Permission.AI_TRAIN_SUBMIT,
    };
  }

  /**
   * Offers an already-uploaded image for training.
   *
   * The bytes went through `/v1/media/uploads` — quota, decode, re-encode, storage. This is the
   * OFFER, and it carries the description that makes the image worth anything.
   */
  @Post('corpus')
  async offer(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const b = (body ?? {}) as Record<string, unknown>;

    const uploadId = typeof b['uploadId'] === 'string' ? b['uploadId'] : '';
    const category = typeof b['category'] === 'string' ? b['category'] : '';
    const description = typeof b['description'] === 'string' ? b['description'] : '';
    if (uploadId === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Upload the image first.');
    }

    const mask = await this.permissions.effectiveMask(caller.userId);
    return this.corpusService.submit(caller.userId, mask, {
      uploadId,
      category,
      description,
      ...(typeof b['notes'] === 'string' ? { notes: b['notes'] } : {}),
      ...(typeof b['shipType'] === 'string' ? { shipType: b['shipType'] } : {}),
    });
  }

  /** A member changing their mind. Always available, never needs a reason. */
  @Delete('corpus/:id')
  async withdraw(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    await this.corpusService.withdraw(caller.userId, id);
    return { ok: true };
  }

  /**
   * Ask the assistant.
   *
   * ★ SIGNED IN, ALWAYS ★
   *
   * Not because the knowledge is secret — most of it is a public galaxy dump — but because every
   * conversation is logged for officer review, and a log of anonymous questions is a log nobody can
   * act on. It also makes the rate limit mean something.
   *
   * ★ HISTORY COMES FROM THE CLIENT ★
   *
   * The turns are sent back with each question rather than reassembled server-side. The alternative
   * is trusting the thread id to reconstruct history, which would let anybody replay somebody
   * else's conversation into their own context by guessing a uuid. The client already has its own
   * transcript; the server keeps the durable copy for review.
   */
  @Post('ask')
  async ask(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
  ): Promise<{ answer: string; sources: unknown[]; threadId: string }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to ask the assistant.');
    }

    /*
     * ★ CHECKED HERE AS WELL AS IN THE NAV ★
     *
     * The sidebar hides the page without this permission, and a hidden link is not a boundary —
     * the URL is still typeable and this endpoint is still callable. Officers taking the assistant
     * away from a rank need it actually taken away, not merely unadvertised.
     */
    const mask = await this.permissions.effectiveMask(caller.userId);
    if (!satisfiesMask(mask, Permission.AI_CHAT)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot use the assistant.');
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const question = typeof b['question'] === 'string' ? b['question'] : '';
    if (question.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Ask a question first.');
    }

    /*
     * The thread id is minted by the SERVER when a conversation starts, and only accepted from the
     * client if it is a well-formed uuid. Echoing back whatever arrives would put an unvalidated
     * string into an indexed uuid column, and a malformed one fails the insert — which would lose
     * the log entry for a conversation that otherwise worked.
     */
    const supplied = typeof b['threadId'] === 'string' ? b['threadId'] : '';
    const threadId = UUID.test(supplied) ? supplied : randomUUID();

    const history = Array.isArray(b['history'])
      ? (b['history'] as unknown[])
          .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
          .filter((t) => t['role'] === 'user' || t['role'] === 'assistant')
          .map((t) => ({
            role: t['role'] as 'user' | 'assistant',
            content: String(t['content'] ?? '').slice(0, 2_000),
          }))
      : [];

    const result = await this.assistant.ask(caller.userId, question, history, 'web', threadId);

    return { answer: result.answer, sources: [...result.sources], threadId };
  }

  /**
   * Conversations, for officer review.
   *
   * ★ SQUADRON OWNER — NON-NEGOTIABLE ★
   *
   * "Every conversation logged for officer review ... it also need to be visible to the webmaster
   * role! this is non-negotiable as the webmaster is the AI developer."
   *
   * `AI_REVIEW` is the same gate as the rest of the log, and the webmaster override is already
   * built into `effectiveMask` — so the requirement is satisfied by using the existing permission
   * rather than by carving out a second path that could drift from it.
   */
  @Get('conversations')
  async conversations(@User() caller: CurrentUser | undefined): Promise<{ threads: unknown[] }> {
    await this.#assertMayReview(caller);
    return { threads: await this.assistant.recentThreads() };
  }

  @Get('conversations/:threadId')
  async conversation(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
  ): Promise<{ turns: unknown[] }> {
    await this.#assertMayReview(caller);
    if (!UUID.test(threadId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not a conversation id.');
    }
    return { turns: await this.assistant.thread(threadId) };
  }

  async #assertMayReview(caller: CurrentUser | undefined): Promise<void> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const mask = await this.permissions.effectiveMask(caller.userId);
    if (!satisfiesMask(mask, Permission.AI_REVIEW)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot read the AI log.');
    }
  }
}
