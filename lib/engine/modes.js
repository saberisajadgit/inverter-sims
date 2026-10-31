// Controller modes, logged every sample as a Uint8 index (SIM_SPEC §4.7, §4.8)
// and shown as the panel's status pill. `tone` maps to the pill colour (§6).

export const MODES = [
  { key: 'NORMAL',        label: 'NORMAL',                        tone: 'ok' },
  { key: 'CL_IQ',         label: 'CURRENT LIMIT · Iq PRIORITY',   tone: 'warn' },
  { key: 'CL_ID',         label: 'CURRENT LIMIT · Id PRIORITY',   tone: 'warn' },
  { key: 'KFACTOR',       label: 'K-FACTOR Iq INJECTION',         tone: 'warn' },
  { key: 'DEADBAND',      label: 'DEADBAND · CONSTANT P',         tone: 'ok' },
  { key: 'BLOCKED',       label: 'BLOCKED · PLL LOST',            tone: 'bad' },
  { key: 'RECOVERY',      label: 'RECOVERY · P RAMP',             tone: 'warn' },
  { key: 'CL',            label: 'CURRENT LIMIT',                 tone: 'warn' },
  { key: 'ADAPTIVE_VI',   label: 'ADAPTIVE VIRTUAL Z',            tone: 'warn' },
  // the UI fills in the peak: "CURRENT LIMIT (UNLIMITED 4.31 pu)"
  { key: 'UNLIMITED',     label: 'CURRENT LIMIT (UNLIMITED {peak} pu)', tone: 'bad' },
  { key: 'VS_UNLIMITED',  label: 'VOLTAGE SOURCE · NOT LIMITED',  tone: 'warn' },
];

export const MODE = Object.fromEntries(MODES.map((m, i) => [m.key, i]));
