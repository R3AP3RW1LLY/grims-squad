#!/usr/bin/env tsx
/**
 * Proves every studio operation works against the REAL ComfyUI.
 *
 * ★ WHY THIS IS NOT OPTIONAL ★
 *
 * `studio.client.spec.ts` proves the graphs are the ones intended, against a FAKE ComfyUI. It
 * cannot prove ComfyUI ACCEPTS them: node names, input names, model filenames and the custom nodes
 * that provide the depth preprocessor all live on the far side of an HTTP boundary, and a wrong one
 * fails only when a member presses the button.
 *
 * That exact gap once let this project ship an API that could not boot, with 1,044 tests green.
 *
 *   pnpm ai:studio:smoke [path-to-source-image]
 *
 * Requires ComfyUI running with the studio models installed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { DEFAULT_RESTYLE, RESTYLE_STRENGTHS, outputPreset } from '@grims/shared';
import { StudioClient, studioConfigFrom } from '../apps/api/src/ai/studio.client.js';

const config = studioConfigFrom({
  ...process.env,
  IMAGE_BASE_URL: process.env['IMAGE_BASE_URL'] ?? 'http://127.0.0.1:8188',
  STUDIO_ENABLED: 'true',
});

const client = new StudioClient(config, fetch, {
  emit: (l) =>
    console.log(`  [${l.level}] ${l.message}${l.tookMs === undefined ? '' : ` (${l.tookMs}ms)`}`),
});

const health = await client.health();
console.log(`ComfyUI: ${health.reachable ? 'up' : 'NOT REACHABLE'} (${health.tookMs}ms)\n`);
if (!health.reachable) {
  console.error('Start it with tools\\start-ai-image.cmd, then run this again.');
  process.exit(1);
}

const sourcePath = process.argv[2] ?? 'D:/ai/smoke-full.png';
if (!existsSync(sourcePath)) {
  console.error(`No source image at ${sourcePath}. Pass one as an argument.`);
  process.exit(1);
}

const source = new Uint8Array(readFileSync(sourcePath));
const meta = await sharp(source).metadata();
const width = meta.width ?? 0;
const height = meta.height ?? 0;
console.log(`source: ${sourcePath} (${width}x${height})\n`);

const strength =
  RESTYLE_STRENGTHS.find((s) => s.id === DEFAULT_RESTYLE)?.strength ?? 0.5;

/*
 * Ordered cheapest first. Upscale needs no diffusion model at all, so if it fails the problem is
 * ComfyUI or the upscaler file — not a 6GB model, a quantisation, or a custom node. Diagnosing in
 * that order saves a lot of guessing.
 */
const jobs = [
  {
    name: 'upscale (no diffusion at all)',
    req: { op: 'upscale' as const, source, width, height, factor: 2 as const },
  },
  {
    name: 'restyle (img2img, schnell)',
    req: {
      op: 'restyle' as const,
      source,
      width,
      height,
      prompt: 'dramatic concept art, volumetric light, deep shadows',
      strength,
      seed: 12_345,
      output: 'wide1080' as const,
    },
  },
  {
    name: 'instruct (Kontext)',
    req: {
      op: 'instruct' as const,
      source,
      width,
      height,
      instruction: 'make this a dramatic sunset with warm orange light',
      seed: 12_345,
      output: 'wide1080' as const,
    },
  },
  {
    name: 'structure/depth (ControlNet + dev)',
    req: {
      op: 'structure' as const,
      source,
      width,
      height,
      prompt: 'dramatic concept art, nebula behind, rim lighting',
      mode: 'depth' as const,
      seed: 12_345,
      output: 'wide4k' as const,
    },
  },
  {
    name: 'structure/edges (Canny + dev)',
    req: {
      op: 'structure' as const,
      source,
      width,
      height,
      prompt: 'cold hard sci-fi realism, harsh sunlight',
      mode: 'edges' as const,
      seed: 12_345,
      output: 'wide720' as const,
    },
  },
];

let failures = 0;

for (const job of jobs) {
  console.log(`--- ${job.name} ---`);
  const started = Date.now();
  const out = await client.run(job.req);

  if (out === null) {
    console.error(`  FAILED after ${Date.now() - started}ms`);
    failures += 1;
    continue;
  }

  const slug = job.name.split(' ')[0]?.replace(/\W/g, '') ?? 'out';
  const dest = `D:/ai/studio-${slug}-${job.req.op === 'structure' ? job.req.mode : job.req.op}.png`;
  writeFileSync(dest, out.png);
  const m = await sharp(out.png).metadata();

  /*
   * The size is CHECKED, not just printed. "16:9 1080p/4K" was called non-negotiable, and the way
   * it breaks is silent — FLUX rounds an off-grid request and returns the wrong shape without
   * erroring. A smoke test that only reported the dimensions would have shown the bug and passed.
   */
  const want = 'output' in job.req ? outputPreset(job.req.output) : null;
  const exact = want === null || (m.width === want.width && m.height === want.height);
  console.log(
    `  ok ${m.width}x${m.height}  ${out.tookMs}ms  -> ${dest}` +
      (want === null
        ? ''
        : exact
          ? `  [exact ${want.label} 16:9]`
          : `  !! WANTED ${want.width}x${want.height}`),
  );
  if (!exact) failures += 1;
}

console.log(`\n${jobs.length - failures}/${jobs.length} operations working.`);
process.exit(failures === 0 ? 0 : 1);
