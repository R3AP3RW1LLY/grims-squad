import type { CatalogueModule } from '@grims/ed-clients/builds';

/**
 * What a module actually does, in words.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "ensure were showing all stats for the components we want to add to our ship" — pointing at
 * EDCD/coriolis as the reference.
 *
 * ★ WHY A TABLE AND NOT A SWITCH ON GROUP ★
 *
 * Coriolis shows different figures for a shield generator than for a multi-cannon, and the obvious
 * way to write that is a branch per module group. There are 89 groups. A branch per group means the
 * next group Frontier adds shows nothing at all, silently, and nobody notices until somebody asks
 * why the new module has no stats.
 *
 * So this is driven by the FIELDS a module carries rather than the group it belongs to. Every field
 * coriolis records is listed once, with a label and a unit; a module renders whichever of them it
 * has. A new group inherits sensible output for free, and a genuinely new field shows up as missing
 * from this table rather than as a blank panel.
 *
 * The field list came from counting every key across all 970 modules, not from reading coriolis's
 * templates — the data is the contract, and the templates cover only what upstream chose to show.
 */

interface FieldSpec {
  readonly label: string;
  readonly unit?: string;
  /** Decimal places. Integers by default — a mass of "12.00 t" reads as false precision. */
  readonly dp?: number;
  /** Rendered as a percentage: coriolis stores resistances as 0.42 meaning 42%. */
  readonly pct?: boolean;
}

/**
 * Ordered deliberately: the figures that decide a choice come first.
 *
 * Somebody comparing two power plants wants output and heat before boot time. A dropdown that lists
 * fields alphabetically makes every module look the same at a glance, which defeats the point of
 * showing them at all.
 */
const FIELDS: ReadonlyArray<readonly [string, FieldSpec]> = [
  // ---- what it gives you ----------------------------------------------------
  ['pgen', { label: 'Power output', unit: 'MW', dp: 2 }],
  ['maximum', { label: 'Capacity', dp: 0 }],
  ['damage', { label: 'Damage', dp: 1 }],
  ['optmul', { label: 'Optimal multiplier', dp: 2 }],
  ['shieldreinforcement', { label: 'Shield boost', unit: 'MJ', dp: 0 }],
  ['hullreinforcement', { label: 'Hull boost', dp: 0 }],
  ['protection', { label: 'Protection', pct: true }],
  ['repair', { label: 'Repair capacity', dp: 0 }],
  ['regen', { label: 'Regeneration', unit: '/s', dp: 1 }],
  ['brokenregen', { label: 'Broken regen', unit: '/s', dp: 1 }],
  ['rate', { label: 'Rate', unit: '/s', dp: 2 }],
  ['bays', { label: 'Vehicle bays', dp: 0 }],

  // ---- the mass curve, which is why a module suits one hull and not another --
  ['optmass', { label: 'Optimal mass', unit: 't', dp: 0 }],
  ['minmass', { label: 'Minimum mass', unit: 't', dp: 0 }],
  ['maxmass', { label: 'Maximum mass', unit: 't', dp: 0 }],
  ['minmul', { label: 'Minimum multiplier', dp: 2 }],
  ['maxmul', { label: 'Maximum multiplier', dp: 2 }],

  // ---- drives ---------------------------------------------------------------
  ['maxfuel', { label: 'Max fuel per jump', unit: 't', dp: 2 }],
  ['fuelmul', { label: 'Fuel multiplier', dp: 3 }],
  ['fuelpower', { label: 'Fuel power', dp: 2 }],

  // ---- distributor ----------------------------------------------------------
  ['syscap', { label: 'SYS capacity', dp: 1 }],
  ['sysrate', { label: 'SYS recharge', unit: '/s', dp: 1 }],
  ['engcap', { label: 'ENG capacity', dp: 1 }],
  ['engrate', { label: 'ENG recharge', unit: '/s', dp: 1 }],
  ['wepcap', { label: 'WEP capacity', dp: 1 }],
  ['weprate', { label: 'WEP recharge', unit: '/s', dp: 1 }],

  // ---- weapons --------------------------------------------------------------
  ['fireint', { label: 'Fire interval', unit: 's', dp: 2 }],
  ['roundspershot', { label: 'Rounds per shot', dp: 0 }],
  ['clip', { label: 'Clip size', dp: 0 }],
  ['ammo', { label: 'Ammo reserve', dp: 0 }],
  ['reload', { label: 'Reload', unit: 's', dp: 1 }],
  ['range', { label: 'Range', unit: 'm', dp: 0 }],
  ['falloff', { label: 'Damage falloff', unit: 'm', dp: 0 }],
  ['shotspeed', { label: 'Shot speed', unit: 'm/s', dp: 0 }],
  ['piercing', { label: 'Armour piercing', dp: 0 }],
  ['jitter', { label: 'Jitter', unit: '°', dp: 2 }],
  ['breachdmg', { label: 'Breach damage', dp: 1 }],
  ['breachmin', { label: 'Breach chance min', pct: true }],
  ['breachmax', { label: 'Breach chance max', pct: true }],
  ['distdraw', { label: 'WEP draw', unit: 'MJ', dp: 2 }],
  ['thermload', { label: 'Thermal load', dp: 2 }],

  // ---- resistances ----------------------------------------------------------
  ['kinres', { label: 'Kinetic resistance', pct: true }],
  ['thermres', { label: 'Thermal resistance', pct: true }],
  ['explres', { label: 'Explosive resistance', pct: true }],
  ['causres', { label: 'Caustic resistance', pct: true }],

  // ---- scanners and utilities ----------------------------------------------
  ['angle', { label: 'Scan angle', unit: '°', dp: 0 }],
  ['ranget', { label: 'Typical range', unit: 'ls', dp: 0 }],
  ['scantime', { label: 'Scan time', unit: 's', dp: 1 }],
  ['facinglimit', { label: 'Facing limit', unit: '°', dp: 0 }],
  ['duration', { label: 'Duration', unit: 's', dp: 1 }],
  ['time', { label: 'Time', unit: 's', dp: 0 }],
  ['spinup', { label: 'Spin-up', unit: 's', dp: 1 }],
  ['eff', { label: 'Efficiency', dp: 2 }],
  ['boot', { label: 'Boot time', unit: 's', dp: 1 }],
  ['ammocost', { label: 'Ammo cost', unit: 'cr', dp: 0 }],
];

export interface ModuleFact {
  readonly label: string;
  readonly value: string;
}

const MOUNTS: Readonly<Record<string, string>> = { F: 'Fixed', G: 'Gimballed', T: 'Turreted' };

function format(value: number, spec: FieldSpec): string {
  if (spec.pct === true) return `${(value * 100).toFixed(0)}%`;
  const body = value.toFixed(spec.dp ?? 0);
  return spec.unit === undefined ? body : `${body} ${spec.unit}`;
}

/**
 * Every figure this module carries, ready to render.
 *
 * Fields that are present but ZERO are dropped. Coriolis writes `0` for "does not apply" as often
 * as for a genuine zero — a laser records `kinres: 0` because it has no kinetic resistance, not
 * because its resistance was measured at nought — and listing them buries the figures that matter
 * under a column of noughts. The exception is anything the reader might be checking IS zero, and
 * for modules there is nothing in that category: a real zero here always means "not applicable".
 */
export function moduleFacts(module: CatalogueModule): ModuleFact[] {
  const facts: ModuleFact[] = [];
  const raw = module.raw;

  if (typeof raw['mount'] === 'string') {
    facts.push({ label: 'Mount', value: MOUNTS[raw['mount']] ?? raw['mount'] });
  }
  if (module.mass !== null && module.mass > 0) {
    facts.push({ label: 'Mass', value: `${module.mass} t` });
  }
  if (module.power !== null && module.power > 0) {
    facts.push({ label: 'Power draw', value: `${module.power.toFixed(2)} MW` });
  }
  if (module.integrity !== null && module.integrity > 0) {
    facts.push({ label: 'Integrity', value: String(module.integrity) });
  }

  for (const [key, spec] of FIELDS) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
    facts.push({ label: spec.label, value: format(value, spec) });
  }

  return facts;
}

/** The module's own description, as Frontier writes it. */
export function moduleDescription(module: CatalogueModule): string | null {
  const text = module.raw['ukDiscript'];
  return typeof text === 'string' && text !== '' ? text : null;
}

/**
 * A one-line summary for a dropdown option.
 *
 * A dropdown cannot show a table, and the browser will not render markup inside an `<option>`. So
 * the two or three figures that actually decide the choice go inline, and the full table appears
 * beside the slot once something is fitted.
 */
export function moduleSummary(module: CatalogueModule): string {
  const bits: string[] = [];
  const raw = module.raw;

  const push = (key: string, label: string, dp = 0): void => {
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) bits.push(`${label} ${v.toFixed(dp)}`);
  };

  push('pgen', 'out', 2);
  push('damage', 'dmg', 1);
  push('optmass', 'opt', 0);
  push('maximum', 'cap', 0);
  push('shieldreinforcement', 'shield', 0);
  push('hullreinforcement', 'hull', 0);

  if (module.mass !== null && module.mass > 0) bits.push(`${module.mass}t`);
  if (module.power !== null && module.power > 0) bits.push(`${module.power.toFixed(2)}MW`);

  return bits.join(' · ');
}
