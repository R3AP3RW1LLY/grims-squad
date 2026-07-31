import {
  ART_GUIDANCE,
  needsUpscale,
  outputPreset,
  IMAGE_SAMPLER,
  IMAGE_SCHEDULER,
  IMAGE_STEPS,
  MAX_SEED,
  STRUCTURE_STRENGTH,
  STUDIO_TIMEOUT_MS,
  buildArtPrompt,
  GEN_BASE,
  type OutputPresetId,
  type StructureMode,
  type UpscaleFactor,
} from '@grims/shared';
import { ComfyTransport } from './comfy.transport.js';

/**
 * The fan art graphs.
 *
 * ★ WHY THIS IS A SECOND CLIENT AND NOT MORE METHODS ON THE FIRST ★
 *
 * `image.client.ts` draws banners: one size, one model, one graph, tuned for the signature layout.
 * This draws whatever a member asks for, from their own screenshot, across four different pipelines
 * and three different models. They share a protocol — hence `ComfyTransport` — and share nothing
 * else. Merging them would produce one class where every method ignored most of its parameters.
 *
 * ★ THE MODELS, AND WHY THEY DIFFER PER OPERATION ★
 *
 *   restyle    schnell   4 steps, guidance-distilled. Fast, and img2img at moderate denoise does
 *                        not need the extra fidelity — the composition is already decided.
 *   structure  dev       ControlNet Union is TRAINED against dev. Pairing it with schnell degrades
 *                        noticeably; this is not a preference, it is what the adapter expects.
 *   instruct   kontext   A different model entirely, trained to edit an image from an instruction.
 *   upscale    none      No diffusion at all. An ESRGAN pass, seconds rather than minutes.
 */

export interface StudioConfig {
  readonly baseUrl: string;
  /** Fast distilled model, for restyle. Shared with the banner generator. */
  readonly schnell: string;
  /** Full model, required by the ControlNet adapter. */
  readonly dev: string;
  /** Instruction-editing model. */
  readonly kontext: string;
  readonly controlnet: string;
  readonly upscaler: string;
  readonly clipT5: string;
  readonly clipL: string;
  readonly vae: string;
}

const DEFAULTS = {
  schnell: 'flux1-schnell-Q4_K_S.gguf',
  dev: 'flux1-dev-Q4_K_S.gguf',
  kontext: 'flux1-kontext-dev-Q4_K_M.gguf',
  controlnet: 'flux-controlnet-union-pro-2.safetensors',
  upscaler: '4x-UltraSharp.pth',
  clipT5: 't5xxl_fp8_e4m3fn.safetensors',
  clipL: 'clip_l.safetensors',
  vae: 'ae.safetensors',
} as const;

/**
 * Reads config. Null means the studio is off — which is a legitimate state, and separate from
 * banner generation being off, because the studio needs three extra models on disk.
 */
export function studioConfigFrom(env: NodeJS.ProcessEnv): StudioConfig | null {
  const baseUrl = env['IMAGE_BASE_URL'];
  if (typeof baseUrl !== 'string' || baseUrl === '') return null;
  if (env['STUDIO_ENABLED'] !== 'true') return null;

  const pick = (key: string, fallback: string): string => {
    const v = env[key];
    return typeof v === 'string' && v !== '' ? v : fallback;
  };

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    schnell: pick('IMAGE_UNET', DEFAULTS.schnell),
    dev: pick('STUDIO_DEV_UNET', DEFAULTS.dev),
    kontext: pick('STUDIO_KONTEXT_UNET', DEFAULTS.kontext),
    controlnet: pick('STUDIO_CONTROLNET', DEFAULTS.controlnet),
    upscaler: pick('STUDIO_UPSCALER', DEFAULTS.upscaler),
    clipT5: pick('IMAGE_CLIP_T5', DEFAULTS.clipT5),
    clipL: pick('IMAGE_CLIP_L', DEFAULTS.clipL),
    vae: pick('IMAGE_VAE', DEFAULTS.vae),
  };
}

/** What the studio was asked to do. One shape per operation — see the union in ai-studio.ts. */
export type StudioRequest =
  | {
      readonly op: 'restyle';
      readonly source: Uint8Array;
      readonly width: number;
      readonly height: number;
      readonly prompt: string;
      readonly strength: number;
      readonly seed: number | null;
      /** Exact finished size. Nothing is GENERATED here — see finishTo. */
      readonly output: OutputPresetId;
    }
  | {
      readonly op: 'structure';
      readonly source: Uint8Array;
      readonly width: number;
      readonly height: number;
      readonly prompt: string;
      readonly mode: StructureMode;
      readonly seed: number | null;
      /** Exact finished size. Nothing is GENERATED here — see finishTo. */
      readonly output: OutputPresetId;
    }
  | {
      readonly op: 'instruct';
      readonly source: Uint8Array;
      readonly width: number;
      readonly height: number;
      readonly instruction: string;
      readonly seed: number | null;
      /** Exact finished size. Nothing is GENERATED here — see finishTo. */
      readonly output: OutputPresetId;
    }
  | {
      readonly op: 'upscale';
      readonly source: Uint8Array;
      readonly width: number;
      readonly height: number;
      readonly factor: UpscaleFactor;
    };

export interface StudioResult {
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

export class StudioClient {
  constructor(
    private readonly config: StudioConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly stream: StreamSink | null = null,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  get configured(): boolean {
    return this.config !== null;
  }

  /** Runs one studio job. Null on any failure — the machine may be off or busy with the game. */
  async run(req: StudioRequest): Promise<StudioResult | null> {
    if (this.config === null) return null;

    const started = Date.now();
    const comfy = new ComfyTransport(this.config.baseUrl, this.fetchImpl, this.sleep);

    /*
     * The source goes across FIRST. ComfyUI's LoadImage reads from its own input folder rather than
     * accepting bytes inline, and it may rename the file if one of that name exists — so the graph
     * is built around the name it hands back, never the one we sent.
     */
    const name = await comfy.uploadImage(req.source, `grims-${req.op}.png`);
    if (name === null) {
      this.stream?.emit({
        level: 'error',
        kind: 'studio',
        message: `Could not send the source image for ${req.op}.`,
        tookMs: Date.now() - started,
      });
      return null;
    }

    const seed = ('seed' in req ? req.seed : null) ?? Math.floor(Math.random() * MAX_SEED);
    // `this.config` was checked at the top; passing it down beats four non-null assertions in the
    // graph builders, each of which would be a place a future edit could get wrong silently.
    const graph = buildGraph(this.config, req, name, seed);

    const promptId = await comfy.submit(graph);
    if (promptId === null) {
      this.stream?.emit({
        level: 'error',
        kind: 'studio',
        message: `ComfyUI would not accept the ${req.op} job — check the models are installed.`,
        tookMs: Date.now() - started,
      });
      return null;
    }

    const waited = await comfy.awaitImage(promptId, started + STUDIO_TIMEOUT_MS);
    if (!waited.ok) {
      this.stream?.emit({
        level: waited.failure === 'timeout' ? 'warn' : 'error',
        kind: 'studio',
        message:
          waited.failure === 'timeout'
            ? `${req.op} timed out — the GPU is likely busy with the game.`
            : `${req.op} finished with no image. Out of memory is the usual cause.`,
        tookMs: Date.now() - started,
      });
      return null;
    }

    const tookMs = Date.now() - started;
    this.stream?.emit({ level: 'info', kind: 'studio', message: `${req.op} done`, tookMs });
    return { png: waited.png, seed, tookMs };
  }

  async health(): Promise<{ reachable: boolean; tookMs: number }> {
    if (this.config === null) return { reachable: false, tookMs: 0 };
    return new ComfyTransport(this.config.baseUrl, this.fetchImpl, this.sleep).health();
  }
}

/**
 * Turns a decoded image into the exact pixels the member asked for.
 *
 * ★ SQUADRON OWNER, 2026-07-30: "full 16:9 1080p / 4k ... this is non-negotiable" ★
 *
 * Nothing upstream generates at the output size, and it cannot: 1080 is not a multiple of sixteen,
 * so FLUX physically cannot produce 1920×1080 — it rounds to 1088 and returns the wrong shape
 * without complaining. 4K is on the grid and is eight times the resolution FLUX was trained at,
 * which makes it duplicate horizons and repeat ships.
 *
 * So generation happens at `GEN_BASE` and this lands it. ESRGAN adds genuine detail at 4×, then a
 * Lanczos reduction hits the exact number. The reduction is not a cost — it averages away the
 * pixel-level noise diffusion always leaves, which is why this beats a native large generation.
 *
 * ★ crop: 'center', AND WHY IT MATTERS FOR ONE OPERATION ★
 *
 * For generate, restyle and structure the latent is already exactly 16:9, so the crop is a no-op.
 * Kontext is the exception: it snaps to its own trained aspect buckets and can hand back 2.33:1.
 * Cropping trims the sides to reach 16:9; the alternative, `fill`, would stretch everything in the
 * picture. A trimmed edge is a choice somebody can see and work around. A 1% horizontal stretch on
 * every image is a defect nobody ever notices and cannot undo.
 */
function finishTo(
  graph: Record<string, unknown>,
  from: string,
  target: { width: number; height: number },
  upscaler: string,
): Record<string, unknown> {
  let source = from;

  if (needsUpscale(target)) {
    graph['finishModel'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: upscaler } };
    graph['finishUp'] = {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: ['finishModel', 0], image: [source, 0] },
    };
    source = 'finishUp';
  }

  graph['finishScale'] = {
    class_type: 'ImageScale',
    inputs: {
      image: [source, 0],
      upscale_method: 'lanczos',
      width: target.width,
      height: target.height,
      crop: 'center',
    },
  };
  graph['out'] = { class_type: 'PreviewImage', inputs: { images: ['finishScale', 0] } };
  return graph;
}

/** Dispatches to the right pipeline. Free function: it needs config and a request, not a client. */
function buildGraph(
  c: StudioConfig,
  req: StudioRequest,
  imageName: string,
  seed: number,
): Record<string, unknown> {
  switch (req.op) {
    case 'restyle':
      return restyleGraph(c, req, imageName, seed);
    case 'structure':
      return structureGraph(c, req, imageName, seed);
    case 'instruct':
      return instructGraph(c, req, imageName, seed);
    case 'upscale':
      return upscaleGraph(c, req, imageName);
  }
}

/**
 * img2img: keep the composition, repaint it.
 *
 * ★ THE ONE PARAMETER THAT MATTERS IS `denoise` ★
 *
 * The source is encoded to a latent and the sampler starts from THAT rather than from noise, so
 * `denoise` is literally how much of the member's picture is allowed to be destroyed. 0.3 is a
 * colour grade; 0.72 is a different image that rhymes with theirs. The UI names these rather than
 * showing the number, because a bare 0–1 slider gets dragged to the end.
 */
function restyleGraph(
  c: StudioConfig,
  req: Extract<StudioRequest, { op: 'restyle' }>,
  imageName: string,
  seed: number,
): Record<string, unknown> {
  const graph: Record<string, unknown> = {
    unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: c.schnell } },
    clip: {
      class_type: 'DualCLIPLoader',
      inputs: { clip_name1: c.clipT5, clip_name2: c.clipL, type: 'flux' },
    },
    vae: { class_type: 'VAELoader', inputs: { vae_name: c.vae } },
    load: { class_type: 'LoadImage', inputs: { image: imageName } },
    /*
     * Scaled before encoding, not after. VAE-encoding a 4K screenshot under --lowvram is minutes
     * of GPU for detail the sampler immediately discards — and on a card running a game, it is
     * the allocation most likely to fail.
     */
    /*
     * Scaled to GEN_BASE — exactly 16:9, on the FLUX grid, 1.33MP — with a CENTRE CROP.
     *
     * Two jobs at once. It bounds what the VAE has to encode (a 4K screenshot under --lowvram is
     * minutes of GPU for detail the sampler discards, and the allocation most likely to fail on a
     * card running a game). And it guarantees the latent is exactly 16:9, so the finishing stage
     * can hit 1920x1080 or 3840x2160 without stretching anything.
     *
     * Cropping rather than letterboxing: an ultrawide screenshot loses its edges, which somebody
     * can see and reframe around. Padding would put black bars INSIDE the image the model then
     * paints over, and it would try to make something of them.
     */
    scale: {
      class_type: 'ImageScale',
      inputs: {
        image: ['load', 0],
        upscale_method: 'lanczos',
        width: GEN_BASE.width,
        height: GEN_BASE.height,
        crop: 'center',
      },
    },
    encode: { class_type: 'VAEEncode', inputs: { pixels: ['scale', 0], vae: ['vae', 0] } },
    positive: {
      class_type: 'CLIPTextEncode',
      inputs: { text: buildArtPrompt(req.prompt), clip: ['clip', 0] },
    },
    // Ignored at cfg 1.0 — schnell is guidance-distilled — but required by KSampler's signature.
    negative: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['clip', 0] } },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: IMAGE_STEPS,
        cfg: 1.0,
        sampler_name: IMAGE_SAMPLER,
        scheduler: IMAGE_SCHEDULER,
        denoise: req.strength,
        model: ['unet', 0],
        positive: ['positive', 0],
        negative: ['negative', 0],
        latent_image: ['encode', 0],
      },
    },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } },
  };

  return finishTo(graph, 'decode', outputPreset(req.output), c.upscaler);
}

/**
 * ControlNet: keep the SHAPES, replace everything else.
 *
 * ★ THIS IS THE ONE THAT SOLVES THE SHIP PROBLEM ★
 *
 * No open model knows what a Krait Mk II looks like. This does not ask it to: a depth map is
 * extracted from the member's screenshot and the sampler is held to it, so the hull keeps its
 * exact form and pose while the paint, the lighting and the entire background are generated
 * fresh. The ship is right because it was never invented.
 *
 * ★ WHY THIS ONE USES `dev` AND FULL STEPS ★
 *
 * ControlNet Union is trained against FLUX.1-dev. Running it on schnell produces visibly weaker
 * adherence — the adapter's conditioning does not land the same way on a distilled model. So this
 * path pays for dev: 20 steps and real guidance, which is slower and is the reason the studio is
 * a queued job rather than a synchronous request.
 */
function structureGraph(
  c: StudioConfig,
  req: Extract<StudioRequest, { op: 'structure' }>,
  imageName: string,
  seed: number,
): Record<string, unknown> {
  /*
   * Depth for ships, edges for flat subjects. DepthAnythingV2 understands three-dimensional form,
   * so a hull keeps its volume; Canny follows hard outlines, which is right when the lines ARE
   * the subject and a depth map would read as a flat plane.
   */
  const hint =
    req.mode === 'depth'
      ? {
          class_type: 'DepthAnythingV2Preprocessor',
          inputs: {
            image: ['scale', 0],
            ckpt_name: 'depth_anything_v2_vitl.pth',
            resolution: 1024,
          },
        }
      : {
          class_type: 'Canny',
          inputs: { image: ['scale', 0], low_threshold: 0.2, high_threshold: 0.5 },
        };

  const graph: Record<string, unknown> = {
    unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: c.dev } },
    clip: {
      class_type: 'DualCLIPLoader',
      inputs: { clip_name1: c.clipT5, clip_name2: c.clipL, type: 'flux' },
    },
    vae: { class_type: 'VAELoader', inputs: { vae_name: c.vae } },
    controlnet: { class_type: 'ControlNetLoader', inputs: { control_net_name: c.controlnet } },
    load: { class_type: 'LoadImage', inputs: { image: imageName } },
    /*
     * Scaled to GEN_BASE — exactly 16:9, on the FLUX grid, 1.33MP — with a CENTRE CROP.
     *
     * Two jobs at once. It bounds what the VAE has to encode (a 4K screenshot under --lowvram is
     * minutes of GPU for detail the sampler discards, and the allocation most likely to fail on a
     * card running a game). And it guarantees the latent is exactly 16:9, so the finishing stage
     * can hit 1920x1080 or 3840x2160 without stretching anything.
     *
     * Cropping rather than letterboxing: an ultrawide screenshot loses its edges, which somebody
     * can see and reframe around. Padding would put black bars INSIDE the image the model then
     * paints over, and it would try to make something of them.
     */
    scale: {
      class_type: 'ImageScale',
      inputs: {
        image: ['load', 0],
        upscale_method: 'lanczos',
        width: GEN_BASE.width,
        height: GEN_BASE.height,
        crop: 'center',
      },
    },
    hint,
    positive: {
      class_type: 'CLIPTextEncode',
      inputs: { text: buildArtPrompt(req.prompt), clip: ['clip', 0] },
    },
    negative: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['clip', 0] } },
    /*
     * `guidance: 3.5` — dev is NOT guidance-distilled and needs a real value here. Leaving it at
     * schnell's 1.0 produces washed-out, low-contrast output that reads as a broken model.
     */
    guided: {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['positive', 0], guidance: 3.5 },
    },
    control: {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['guided', 0],
        negative: ['negative', 0],
        control_net: ['controlnet', 0],
        image: ['hint', 0],
        strength: STRUCTURE_STRENGTH,
        start_percent: 0.0,
        /*
         * Released at 80%. Holding the control to the very end fights the model during the final
         * detail steps and leaves a faint outline of the depth map in the output; letting go
         * early keeps the composition and lets the render finish cleanly.
         */
        end_percent: 0.8,
        vae: ['vae', 0],
      },
    },
    latent: {
      class_type: 'EmptySD3LatentImage',
      inputs: { width: GEN_BASE.width, height: GEN_BASE.height, batch_size: 1 },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        seed,
        // dev is not distilled: 20 steps, not 4. This is the slow path and knows it.
        steps: 20,
        cfg: 1.0,
        sampler_name: IMAGE_SAMPLER,
        scheduler: IMAGE_SCHEDULER,
        denoise: 1.0,
        model: ['unet', 0],
        positive: ['control', 0],
        negative: ['control', 1],
        latent_image: ['latent', 0],
      },
    },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } },
  };

  return finishTo(graph, 'decode', outputPreset(req.output), c.upscaler);
}

/**
 * Kontext: do what the member asked, in words.
 *
 * ★ NO DENOISE SLIDER, NO PREPROCESSOR, NO MODE ★
 *
 * "make this a dramatic sunset" is the entire interface. Kontext is trained for instruction
 * editing, so the source image is supplied as REFERENCE conditioning rather than as a starting
 * latent — which is why the instruction text goes in raw, with no art guidance appended. Telling
 * an editing model "no text, no watermark" when the member asked it to change the lighting just
 * gives it contradictory instructions.
 */
function instructGraph(
  c: StudioConfig,
  req: Extract<StudioRequest, { op: 'instruct' }>,
  imageName: string,
  seed: number,
): Record<string, unknown> {
  const graph: Record<string, unknown> = {
    unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: c.kontext } },
    clip: {
      class_type: 'DualCLIPLoader',
      inputs: { clip_name1: c.clipT5, clip_name2: c.clipL, type: 'flux' },
    },
    vae: { class_type: 'VAELoader', inputs: { vae_name: c.vae } },
    load: { class_type: 'LoadImage', inputs: { image: imageName } },
    /*
     * Kontext's OWN scaler, not ImageScale. It snaps to the specific aspect buckets the model was
     * trained on — using an arbitrary size here degrades the edit noticeably, which is exactly
     * the sort of thing that looks like "the model is bad" rather than "the input was off-grid".
     */
    scale: { class_type: 'FluxKontextImageScale', inputs: { image: ['load', 0] } },
    encode: { class_type: 'VAEEncode', inputs: { pixels: ['scale', 0], vae: ['vae', 0] } },
    instruction: {
      class_type: 'CLIPTextEncode',
      inputs: { text: req.instruction.slice(0, 800), clip: ['clip', 0] },
    },
    negative: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['clip', 0] } },
    // The source as reference conditioning — this is what makes it an EDIT rather than a redraw.
    reference: {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: ['instruction', 0], latent: ['encode', 0] },
    },
    guided: {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['reference', 0], guidance: 2.5 },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 20,
        cfg: 1.0,
        sampler_name: IMAGE_SAMPLER,
        scheduler: IMAGE_SCHEDULER,
        denoise: 1.0,
        model: ['unet', 0],
        positive: ['guided', 0],
        negative: ['negative', 0],
        latent_image: ['encode', 0],
      },
    },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } },
  };

  return finishTo(graph, 'decode', outputPreset(req.output), c.upscaler);
}

/**
 * ESRGAN: more pixels, no diffusion.
 *
 * ★ THE ONLY OPERATION THAT INVENTS NOTHING ★
 *
 * No model, no seed, no prompt, and seconds rather than minutes. It is also the one everybody
 * will use most, because it is what turns a finished piece into something printable.
 *
 * 2× is the 4× model followed by a downscale rather than a separate 2× model: the extra detail
 * the big model recovers survives the reduction, and the result is sharper than a native 2× pass.
 */
function upscaleGraph(
  c: StudioConfig,
  req: Extract<StudioRequest, { op: 'upscale' }>,
  imageName: string,
): Record<string, unknown> {
  const graph: Record<string, unknown> = {
    model: { class_type: 'UpscaleModelLoader', inputs: { model_name: c.upscaler } },
    load: { class_type: 'LoadImage', inputs: { image: imageName } },
    up: {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: ['model', 0], image: ['load', 0] },
    },
  };

  if (req.factor === 4) {
    graph['out'] = { class_type: 'PreviewImage', inputs: { images: ['up', 0] } };
    return graph;
  }

  graph['down'] = {
    class_type: 'ImageScale',
    inputs: {
      image: ['up', 0],
      upscale_method: 'lanczos',
      width: req.width * 2,
      height: req.height * 2,
      crop: 'disabled',
    },
  };
  graph['out'] = { class_type: 'PreviewImage', inputs: { images: ['down', 0] } };
  return graph;
}

/** Exported for the spec: the guidance appended to restyle and structure prompts, never to instruct. */
export const STUDIO_ART_GUIDANCE = ART_GUIDANCE;
