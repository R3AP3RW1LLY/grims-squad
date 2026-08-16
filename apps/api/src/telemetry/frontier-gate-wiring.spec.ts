import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The hub must be ABLE to tell the app about Frontier.
 *
 * ★ SQUADRON OWNER, 2026-08-16: "why was i not asked to connect frontier Capi to my app?" ★
 *
 * Because the settings endpoint never carried a Frontier opinion, in any deployment.
 *
 * `TelemetryController` injects `CAPI_SERVICE` with `@Optional()`, so the endpoint still answers on
 * a deployment where Frontier is not configured. `CmdrModule` declared the provider and exported
 * NOTHING, and `TelemetryModule` did not import it — so that optional injection resolved to
 * `undefined` everywhere, and the payload simply had no `frontier` field.
 *
 * The companion's gate treats "the hub has no opinion" as PASS, and that is deliberate: a hub that
 * cannot answer must not lock a member out of their own app.
 *
 * Two correct safeties, combining into total silence. Nothing threw, nothing logged, no test failed,
 * and the step the owner made MANDATORY never once appeared. That is the shape of failure this file
 * exists to make impossible — it is checked structurally, because a runtime test would need the
 * whole Nest graph and the bug was in the graph.
 */

const SRC = join(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('the Frontier opinion reaches the settings endpoint', () => {
  it('★ MANDATORY: CmdrModule EXPORTS the cAPI service ★', () => {
    // Declaring a provider makes it available inside its own module and nowhere else.
    const mod = read('cmdr/cmdr.module.ts');

    expect(mod).toMatch(/exports:\s*\[[^\]]*CAPI_SERVICE/);
  });

  it('★ MANDATORY: TelemetryModule imports CmdrModule ★', () => {
    // The other half. An export nobody imports is still undefined at the injection site.
    const mod = read('telemetry/telemetry.module.ts');

    expect(mod).toMatch(/imports:\s*\[[^\]]*CmdrModule/);
  });

  it('★ MANDATORY: the settings endpoint still reports frontier ★', () => {
    // The field the companion's gate reads. Its absence is what "no opinion" means.
    expect(read('telemetry/telemetry.controller.ts')).toContain('frontier');
  });
});
