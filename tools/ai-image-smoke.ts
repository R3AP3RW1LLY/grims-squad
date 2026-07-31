#!/usr/bin/env tsx
/**
 * Proves image generation works, end to end, through the REAL client.
 *
 * ★ WHY THIS EXISTS RATHER THAN A UNIT TEST ★
 *
 * `image.client.spec.ts` proves the client behaves correctly against a FAKE ComfyUI: the right
 * graph, the right failure handling, the right polling. What it cannot prove is that the graph is
 * one the installed ComfyUI actually accepts — node names, input names and model filenames all live
 * on the other side of an HTTP boundary, and a wrong one fails only at generation time.
 *
 * That gap is exactly the class of bug that took this project down once before: 1,044 green tests
 * while the API would not boot, because a module import was missing and nothing asked the container
 * to wire it. A green suite is not a running system.
 *
 * So: run this after installing, after upgrading ComfyUI, and after changing the graph.
 *
 *   pnpm ai:image:smoke
 *   pnpm ai:image:smoke "orange gas giant at sunrise, ring shadow across the clouds"
 *
 * Requires ComfyUI running — `tools/start-ai-image.cmd`.
 */
import { writeFileSync } from 'node:fs';
import { ImageClient, imageConfigFrom } from '../apps/api/src/ai/image.client.js';
import { toBannerSize } from '../apps/api/src/ai/artwork.service.js';

const baseUrl = process.env['IMAGE_BASE_URL'] ?? 'http://127.0.0.1:8188';
const config = imageConfigFrom({ ...process.env, IMAGE_BASE_URL: baseUrl });

const client = new ImageClient(config, fetch, {
  emit: (l) => console.log(`  [${l.level}] ${l.message}${l.tookMs === undefined ? '' : ` (${l.tookMs}ms)`}`),
});

const health = await client.health();
console.log(`ComfyUI at ${baseUrl}: ${health.reachable ? 'up' : 'NOT REACHABLE'} (${health.tookMs}ms)`);
if (!health.reachable) {
  console.error('Start it with tools\\start-ai-image.cmd, then run this again.');
  process.exit(1);
}

const prompt = process.argv[2] ?? 'deep blue nebula with drifting dust, distant cold stars, quiet and vast';
console.log(`prompt: ${prompt}`);

const started = Date.now();
// A fixed seed: two runs of this script should produce the SAME image, and a run that does not is
// itself the finding.
const raw = await client.generate(prompt, 12_345);

if (raw === null) {
  console.error('FAILED: no image came back. The ComfyUI window has the reason.');
  process.exit(1);
}

const banner = await toBannerSize(raw.png);
writeFileSync('D:/ai/smoke-full.png', raw.png);
writeFileSync('D:/ai/smoke-banner.png', banner);

console.log(`generated  ${raw.png.byteLength} bytes  seed ${raw.seed}  ${raw.tookMs}ms`);
console.log(`downscaled ${banner.byteLength} bytes`);
console.log(`total      ${Date.now() - started}ms`);
console.log('wrote D:/ai/smoke-full.png and D:/ai/smoke-banner.png');
