import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  FIELD_LABELS,
  OVERLAY_FIELDS,
  OVERLAY_IDS,
  OVERLAY_LABELS,
  type OverlayId,
  type OverlayLayout,
} from '../overlay-config.js';
import { Button, C, Card, Field, Problem, Section, inputStyle } from './ui.js';

/**
 * Arranging the overlays.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "make nice professional editable and lockable overlays for our modules etc", with opacity, scale,
 * accent colour and field selection editable per overlay.
 *
 * ★ EVERY CHANGE IS SENT WHOLE ★
 *
 * The panel edits a copy of the layout and hands the entire thing back. One validation point in the
 * main process (`normaliseLayout`) instead of one per property, and no way to construct a
 * half-applied arrangement by changing two things quickly.
 */

declare global {
  interface Window {
    readonly overlays: {
      set(layout: OverlayLayout): Promise<OverlayLayout | null>;
      setEditing(on: boolean): Promise<boolean>;
    };
  }
}

export function OverlaysPanel({
  layout,
  editing,
  displayNote,
  displayMode,
}: {
  layout: OverlayLayout;
  editing: boolean;
  displayNote: string | null;
  displayMode: string;
}): JSX.Element {
  const [open, setOpen] = useState<OverlayId | null>(null);

  const change = (id: OverlayId, patch: Partial<OverlayLayout[OverlayId]>): void => {
    void window.overlays.set({ ...layout, [id]: { ...layout[id], ...patch } });
  };

  const style = (id: OverlayId, patch: Partial<OverlayLayout[OverlayId]['style']>): void => {
    change(id, { style: { ...layout[id].style, ...patch } });
  };

  const anyOn = OVERLAY_IDS.some((id) => layout[id].enabled);

  return (
    <div>
      {/*
        The display-mode note, when there is one. `explain` returns null whenever overlays work, so
        this appears only when there is something the member needs to do — a line that is always
        present is a line nobody reads on the day it matters.
      */}
      {displayNote === null ? null : (
        <div style={{ marginBottom: '16px' }}>
          <Problem>{displayNote}</Problem>
        </div>
      )}

      <Section
        title="Arrange"
        aside={
          <Button
            tone={editing ? 'primary' : 'default'}
            disabled={!anyOn}
            onClick={() => void window.overlays.setEditing(!editing)}
          >
            {editing ? 'Done arranging' : 'Arrange on screen'}
          </Button>
        }
      >
        <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
          {!anyOn
            ? 'Switch an overlay on below, then come back here to place it.'
            : editing
              ? 'Every overlay now takes the mouse — drag them where you want them, then press Done. They lock again automatically.'
              : `Elite is in ${displayMode} mode. Locked overlays pass your clicks straight through to the game.`}
        </p>
      </Section>

      <Section title="Panels">
        <div style={{ display: 'grid', gap: '10px' }}>
          {OVERLAY_IDS.map((id) => {
            const state = layout[id];
            const expanded = open === id;

            return (
              <Card key={id} accent={state.enabled ? C.active : C.hairline}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '9px', flex: 1, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={state.enabled}
                      onChange={(e) =>
                        change(id, { enabled: (e.target as HTMLInputElement).checked })
                      }
                    />
                    <span style={{ fontSize: '14px' }}>{OVERLAY_LABELS[id]}</span>
                  </label>

                  <span
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '3px',
                      background: state.style.accent,
                      opacity: state.enabled ? 1 : 0.35,
                    }}
                  />

                  <Button onClick={() => setOpen(expanded ? null : id)} disabled={!state.enabled}>
                    {expanded ? 'Close' : 'Style'}
                  </Button>
                </div>

                {expanded ? (
                  <div style={{ marginTop: '14px', display: 'grid', gap: '14px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                      <Field label={`Opacity · ${Math.round(state.style.opacity * 100)}%`}>
                        <input
                          type="range"
                          min={20}
                          max={100}
                          value={Math.round(state.style.opacity * 100)}
                          /*
                           * ★ onChange, NOT onInput — SQUADRON OWNER, 2026-08-02 ★
                           *
                           * "the app seems to be freezing up quite a bit."
                           *
                           * `onInput` fires on every pixel of a drag, sixty to a hundred times a
                           * second. Each one wrote the config file to disk SYNCHRONOUSLY, re-applied
                           * all four overlay windows and re-rendered the whole app. The slider's own
                           * value came back through that round trip, so the thumb fought the cursor
                           * as well.
                           *
                           * `onChange` fires once, on release — which is when you have decided.
                           */
                          onChange={(e) =>
                            style(id, {
                              opacity: Number((e.target as HTMLInputElement).value) / 100,
                            })
                          }
                        />
                      </Field>

                      <Field label={`Size · ${state.style.scale.toFixed(2)}×`}>
                        <input
                          type="range"
                          min={70}
                          max={200}
                          value={Math.round(state.style.scale * 100)}
                          onChange={(e) =>
                            style(id, { scale: Number((e.target as HTMLInputElement).value) / 100 })
                          }
                        />
                      </Field>

                      <Field label="Accent">
                        <input
                          type="color"
                          value={state.style.accent}
                          style={{ ...inputStyle, padding: '2px', height: '34px' }}
                          // Same reason as the sliders: a colour picker streams input events
                          // the whole time the member is dragging around the wheel.
                          onChange={(e) =>
                            style(id, { accent: (e.target as HTMLInputElement).value })
                          }
                        />
                      </Field>
                    </div>

                    <Field label="Where it goes">
                      <select
                        style={inputStyle}
                        value={state.destination}
                        onChange={(e) =>
                          change(id, {
                            destination: (e.target as HTMLSelectElement).value as
                              | 'auto'
                              | 'over-game'
                              | 'detached',
                          })
                        }
                      >
                        <option value="auto">Follow the game</option>
                        <option value="over-game">Over the game</option>
                        <option value="detached">Its own window (second screen)</option>
                      </select>
                    </Field>

                    <Field label="What it shows">
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {OVERLAY_FIELDS[id].map((f) => {
                          const on = state.style.fields.includes(f);
                          return (
                            <label
                              key={f}
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: C.dim }}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  /*
                                   * Order is preserved from the canonical list rather than from the
                                   * order things were ticked — otherwise re-enabling a field moves
                                   * it to the end and the panel silently rearranges itself.
                                   */
                                  const next = OVERLAY_FIELDS[id].filter((x) =>
                                    x === f ? !on : state.style.fields.includes(x),
                                  );
                                  style(id, { fields: [...next] });
                                }}
                              />
                              {FIELD_LABELS[f] ?? f}
                            </label>
                          );
                        })}
                      </div>
                    </Field>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
