import { ComfyTransport } from './comfy.transport.js';
import {
  IMAGE_CFG,
  IMAGE_GEN_HEIGHT,
  IMAGE_GEN_WIDTH,
  IMAGE_SAMPLER,
  IMAGE_SCHEDULER,
  IMAGE_STEPS,
  IMAGE_TIMEOUT_MS,
  MAX_SEED,
  buildImagePrompt,
} from '@grims/shared';

/**
 * Talking to ComfyUI on the owner's 5070 Ti.
 *
 * ★ WHY THIS IS NOT `AiClient` ★
 *
 * The text side speaks the OpenAI chat protocol, which every runtime implements, so that client is
 * written against a standard and swapping Ollama for something else is one environment variable.
 *
 * There is no equivalent standard for local image generation. ComfyUI's API takes a NODE GRAPH —
 * you send the pipeline itself, not a prompt — so this file necessarily knows about
 * `UnetLoaderGGUF` and `DualCLIPLoader` by name. That is a real coupling and worth being honest
 * about: changing image runtime means rewriting `buildGraph`, not editing config.
 *
 * It buys something in return. Because the graph is ours, the sampler settings, the resolution and
 * the model files are all decided HERE, in code, under review — rather than living in a workflow
 * JSON somebody exported from a UI once and nobody can diff.
 *
 * ★ SAME FAILURE PHILOSOPHY AS THE TEXT CLIENT ★
 *
 * Returns null rather than throwing. The machine may be off, the game may be using the card, the
 * tunnel may be down. Those are normal states, and a member asking for banner artwork when the GPU
 * is unavailable should be told "not right now", not meet a 500.
 */

export interface ImageConfig {
  /** ComfyUI's HTTP root, e.g. `http://127.0.0.1:8188`. */
  readonly baseUrl: string;
  /** Filenames as they sit in ComfyUI's model folders. */
  readonly unet: string;
  readonly clipT5: string;
  readonly clipL: string;
  readonly vae: string;
}

/** Sensible defaults matching what `tools/start-ai-image.cmd` installs. */
const DEFAULTS = {
  unet: 'flux1-schnell-Q4_K_S.gguf',
  clipT5: 't5xxl_fp8_e4m3fn.safetensors',
  clipL: 'clip_l.safetensors',
  vae: 'ae.safetensors',
} as const;

/**
 * Reads config from the environment. Null means image generation is not configured.
 *
 * Only `IMAGE_BASE_URL` is required. The model filenames have defaults because they are an
 * installation detail, not a deployment choice — somebody standing up a second instance should not
 * have to copy four filenames correctly to get a working service, and getting one wrong fails at
 * generation time with a ComfyUI validation error rather than at boot.
 */
export function imageConfigFrom(env: NodeJS.ProcessEnv): ImageConfig | null {
  const baseUrl = env['IMAGE_BASE_URL'];
  if (typeof baseUrl !== 'string' || baseUrl === '') return null;

  const pick = (key: string, fallback: string): string => {
    const v = env[key];
    return typeof v === 'string' && v !== '' ? v : fallback;
  };

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    unet: pick('IMAGE_UNET', DEFAULTS.unet),
    clipT5: pick('IMAGE_CLIP_T5', DEFAULTS.clipT5),
    clipL: pick('IMAGE_CLIP_L', DEFAULTS.clipL),
    vae: pick('IMAGE_VAE', DEFAULTS.vae),
  };
}

/** What one generation produced, before downscaling to banner size. */
export interface RawImage {
  /** PNG bytes at IMAGE_GEN_WIDTH × IMAGE_GEN_HEIGHT. */
  readonly png: Uint8Array;
  readonly seed: number;
  readonly tookMs: number;
}

interface StreamSink {
  emit(line: {
    level: 'info' | 'warn' | 'error';
    kind: string;
    message: string;
    tookMs?: number;
  }): void;
}

export class ImageClient {
  constructor(
    private readonly config: ImageConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly stream: StreamSink | null = null,
    /** Injected so tests do not actually wait two seconds a poll. */
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  get configured(): boolean {
    return this.config !== null;
  }

  /**
   * Generates one image. Null on any failure.
   *
   * ★ ONE. NOT A BATCH. ★
   *
   * `batch_size` stays at 1 and callers wanting three options call this three times, in sequence.
   *
   * That is not an oversight. This runs on the card Elite Dangerous is running on, and peak VRAM is
   * what decides whether the game survives — a batch of three is three times the latents and three
   * times the VAE decode, all resident at once. Sequential generation has the same total cost and a
   * third of the peak.
   */
  async generate(prompt: string, seed: number | null): Promise<RawImage | null> {
    if (this.config === null) return null;

    const started = Date.now();
    const chosenSeed = seed ?? Math.floor(Math.random() * MAX_SEED);
    const graph = this.#buildGraph(buildImagePrompt(prompt), chosenSeed);

    const promptId = await this.#comfy().submit(graph);
    if (promptId === null) {
      this.stream?.emit({
        level: 'error',
        kind: 'image',
        message: 'The artwork service would not accept the job — is it running?',
        tookMs: Date.now() - started,
      });
      return null;
    }

    const waited = await this.#comfy().awaitImage(promptId, started + IMAGE_TIMEOUT_MS);
    if (!waited.ok) {
      this.stream?.emit({
        level: waited.failure === 'timeout' ? 'warn' : 'error',
        kind: 'image',
        message:
          waited.failure === 'timeout'
            ? 'Generation timed out. The GPU is likely busy with the game.'
            : 'Generation finished with no image. Out of memory is the usual cause.',
        tookMs: Date.now() - started,
      });
      return null;
    }
    const png = waited.png;

    const tookMs = Date.now() - started;
    this.stream?.emit({ level: 'info', kind: 'image', message: 'Artwork generated', tookMs });
    return { png, seed: chosenSeed, tookMs };
  }

  /** Whether ComfyUI is answering. Cheap — asks for its stats, does not touch a model. */
  async health(): Promise<{ reachable: boolean; tookMs: number }> {
    if (this.config === null) return { reachable: false, tookMs: 0 };
    return this.#comfy().health();
  }

  /**
   * The transport, built per call.
   *
   * Cheap (it holds a URL and two function references) and it keeps `config === null` handled in
   * exactly one place — the alternative is a nullable field every method has to re-check.
   */
  #comfy(): ComfyTransport {
    return new ComfyTransport(this.config?.baseUrl ?? '', this.fetchImpl, this.sleep);
  }

  /**
   * The FLUX.1-schnell pipeline, as a ComfyUI graph.
   *
   * ★ WHY GGUF AND NOT THE fp8 CHECKPOINT ★
   *
   * The all-in-one fp8 build is simpler — one file, no custom node. It is also about 11GB of VRAM,
   * and this card has roughly 7GB free while Elite Dangerous is running. Q4_K_S is 6.3GB and fits
   * in what the game leaves behind. Quality loss at Q4 on a decorative backdrop is not visible;
   * an out-of-memory crash in the game very much is.
   */
  /**
   * Hands the card back.
   *
   * ★ THE OUTAGE THIS EXISTS FOR — 2026-08-10 ★
   *
   * ComfyUI keeps a model resident after a generation so the next one is fast. That is the right
   * default for a machine doing nothing else, and this machine does two other things: it runs the
   * squadron's AI and it runs Elite Dangerous.
   *
   * Measured within half an hour of image generation being switched on in production: ComfyUI held
   * 6.9 GB, Ollama held 6.9 GB, and the 15.9 GB card had 0.5 GB free. Ollama's weights were still
   * resident but it had no headroom left for inference, so a two-token reply took EIGHTEEN SECONDS.
   * Screening timed out at 20s, the health check at 63s, and every forum post started being held
   * for review — none of which mentions the GPU, so the cause was invisible from the symptom.
   *
   * The graph comment above reasoned that Q4_K_S "fits in what the game leaves behind", and it does.
   * What it did not account for is that fitting is not enough when another service needs room to
   * WORK in what is left.
   *
   * ★ WHY THIS IS CALLED AND NOT LEFT TO A TIMEOUT ★
   *
   * Image generation is occasional and member-initiated; the AI answers a health check every minute
   * and screens every post. So the rare visitor is the one that tidies up. Measured effect of this
   * call on the live machine: Ollama went from 18.0s to 7.5s on the same prompt.
   *
   * Failure is swallowed. A banner that generated is a banner the member should get, and being
   * unable to free memory afterwards must not turn a success into an error.
   */
  async release(): Promise<void> {
    const c = this.config;
    if (c === null) return;

    try {
      await this.fetchImpl(`${c.baseUrl}/free`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
    } catch {
      // See above.
    }
  }

  #buildGraph(prompt: string, seed: number): Record<string, unknown> {
    const c = this.config;
    if (c === null) return {};

    return {
      unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: c.unet } },
      clip: {
        class_type: 'DualCLIPLoader',
        inputs: { clip_name1: c.clipT5, clip_name2: c.clipL, type: 'flux' },
      },
      vae: { class_type: 'VAELoader', inputs: { vae_name: c.vae } },
      positive: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['clip', 0] } },
      /*
       * An empty negative prompt, and it is not a placeholder for one.
       *
       * Schnell is guidance-distilled and runs at cfg 1.0, where there is no unconditional branch
       * for a negative prompt to steer. The node is required by KSampler's signature; the text in
       * it is genuinely ignored. Filling it in would look like it was doing something.
       */
      negative: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['clip', 0] } },
      latent: {
        class_type: 'EmptySD3LatentImage',
        inputs: { width: IMAGE_GEN_WIDTH, height: IMAGE_GEN_HEIGHT, batch_size: 1 },
      },
      sampler: {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps: IMAGE_STEPS,
          cfg: IMAGE_CFG,
          sampler_name: IMAGE_SAMPLER,
          scheduler: IMAGE_SCHEDULER,
          denoise: 1.0,
          model: ['unet', 0],
          positive: ['positive', 0],
          negative: ['negative', 0],
          latent_image: ['latent', 0],
        },
      },
      decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } },
      /*
       * PreviewImage, not SaveImage.
       *
       * Both make the bytes fetchable. SaveImage writes to `output/` and leaves the file there
       * forever — three files per member per attempt, on somebody's personal machine, that nobody
       * will ever delete. PreviewImage writes to `temp/`, which ComfyUI clears on restart. We keep
       * only what the member actually chooses, in our own media store.
       */
      out: { class_type: 'PreviewImage', inputs: { images: ['decode', 0] } },
    };
  }
}

/*
 * `firstImage` and `isFinished` moved to comfy.transport.ts when the studio needed the same
 * polling. Re-exported here so existing imports and tests keep working — the protocol quirks they
 * encode (a history entry exists while a job RUNS; PreviewImage writes to `temp`) are worth having
 * one copy of.
 */
export { firstImage, isFinished } from './comfy.transport.js';
