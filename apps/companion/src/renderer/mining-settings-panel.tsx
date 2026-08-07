import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { C, Section, Card, Button } from './ui.js';
import {
  setDefaultThreshold,
  setMaterialThreshold,
  clearMaterialThreshold,
  type MiningSettings,
} from '../mining-settings.js';
import { CORE_ONLY_MATERIALS } from '@grims/shared/mining';

/**
 * The percentages a member chooses, on screen.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add full on mining companion app settings to allow the user the option to select percentages"
 *
 * ★ THE NUMBERS ARE THE FEATURE ★
 *
 * Everything here writes through `mining-settings.ts`, which clamps and repairs. Nothing on this
 * page validates for itself: two validators is one validator and a bug, and the model's rules are
 * the ones the overlay actually obeys.
 *
 * A slider AND a number box for the default, because they answer different questions — a slider is
 * for "roughly where", a box is for "exactly 22". Per-material rows are boxes only: somebody
 * setting Void Opal to 0 is being precise on purpose.
 */

/** The materials worth suggesting, so the common case is two clicks rather than typing a name. */
const SUGGESTED: readonly string[] = [
  'Painite',
  'Platinum',
  'Low Temperature Diamonds',
  'Bromellite',
  ...CORE_ONLY_MATERIALS,
];

export function MiningSettingsPanel({
  settings,
  onChange,
}: {
  settings: MiningSettings;
  onChange: (next: MiningSettings) => void;
}): JSX.Element {
  const [adding, setAdding] = useState('');

  const rows = Object.entries(settings.perMaterial).sort(([a], [b]) => (a < b ? -1 : 1));
  const unused = SUGGESTED.filter((m) => !(m in settings.perMaterial));

  return (
    <div>
      <Section title="When to flag a rock">
        <Card>
          <p style={{ margin: '0 0 10px', fontSize: '12px', color: C.dim }}>
            A prospected rock is highlighted when its best material is at or above this share. Set a
            material its own number below when the default is wrong for it — twelve per cent Painite
            is a good rock and twelve per cent Bauxite is not worth the limpet.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.default}
              onInput={(e) =>
                onChange(setDefaultThreshold(settings, Number((e.target as HTMLInputElement).value)))
              }
              style={{ flex: 1, // The app chrome's own accent. The OVERLAY uses squadron cyan because it sits over the game;
              // this panel sits in the app, and matching the surface it is on is what "match the
              // existing styles" means here.
              accentColor: C.orange }}
              aria-label="Default threshold"
            />
            {/*
              A number box beside the slider. The slider answers "roughly where"; a member who
              wants exactly 22 should not have to hunt for it a pixel at a time.
            */}
            <input
              type="number"
              min={0}
              max={100}
              value={settings.default}
              onInput={(e) =>
                onChange(setDefaultThreshold(settings, Number((e.target as HTMLInputElement).value)))
              }
              style={{
                width: '64px',
                background: C.raised,
                color: C.text,
                border: `1px solid ${C.subtle}`,
                borderRadius: '4px',
                padding: '4px 6px',
                fontFamily: 'var(--font-mono)',
              }}
              aria-label="Default threshold, exact"
            />
            <span style={{ color: C.dim, fontSize: '12px' }}>%</span>
          </div>
        </Card>
      </Section>

      <Section title="Per material">
        <Card>
          {rows.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12px', color: C.dim }}>
              Nothing set. Every material uses the default above.
            </p>
          ) : (
            rows.map(([material, percent]) => (
              <div
                key={material}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '4px 0',
                }}
              >
                <span style={{ flex: 1, fontSize: '13px' }}>{material}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={percent}
                  onInput={(e) =>
                    onChange(
                      setMaterialThreshold(
                        settings,
                        material,
                        Number((e.target as HTMLInputElement).value),
                      ),
                    )
                  }
                  style={{
                    width: '64px',
                    background: C.raised,
                    color: C.text,
                    border: `1px solid ${C.subtle}`,
                    borderRadius: '4px',
                    padding: '4px 6px',
                    fontFamily: 'var(--font-mono)',
                  }}
                  aria-label={`${material} threshold`}
                />
                <span style={{ color: C.dim, fontSize: '12px' }}>%</span>
                {/*
                  "Use default" rather than "Delete": removing the row does not remove the material
                  from the overlay, it returns it to the default — and saying so stops somebody
                  wondering whether they have switched Painite off.
                */}
                <Button onClick={() => onChange(clearMaterialThreshold(settings, material))}>
                  Use default
                </Button>
              </div>
            ))
          )}

          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Material name"
              value={adding}
              onInput={(e) => setAdding((e.target as HTMLInputElement).value)}
              style={{
                flex: 1,
                background: C.raised,
                color: C.text,
                border: `1px solid ${C.subtle}`,
                borderRadius: '4px',
                padding: '5px 8px',
                fontSize: '13px',
              }}
              aria-label="Add a material"
            />
            <Button
              onClick={() => {
                /*
                 * Seeded at the CURRENT DEFAULT rather than at zero. A new row at 0% would flag
                 * every rock containing a trace of it — which reads as the app being broken, from
                 * an action the member took deliberately.
                 */
                onChange(setMaterialThreshold(settings, adding, settings.default));
                setAdding('');
              }}
            >
              Add
            </Button>
          </div>

          {unused.length > 0 ? (
            <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {unused.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange(setMaterialThreshold(settings, m, settings.default))}
                  style={{
                    background: C.raised,
                    color: C.dim,
                    border: `1px solid ${C.subtle}`,
                    borderRadius: '999px',
                    padding: '3px 10px',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  + {m}
                </button>
              ))}
            </div>
          ) : null}
        </Card>
      </Section>
    </div>
  );
}
