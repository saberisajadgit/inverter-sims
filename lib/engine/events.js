// Scenario events (SIM_SPEC §4.4). Each event is { t, type, ...params }, with t in
// seconds relative to the first event (t = 0).

export const EVENT_TYPES = [
  'fault', 'clear', 'sag', 'phaseJump', 'freqRamp', 'freqStep',
  'breakerOpen', 'breakerClose', 'setpoint', 'loadStep',
];

export const FAULT_R_DEFAULT = 0.005;   // bolted, pu
export const M_MIN = 0.02, M_MAX = 0.98;

export const clipM = (m) => Math.min(M_MAX, Math.max(M_MIN, m));

export function sortEvents(events = []) {
  for (const ev of events) {
    if (!EVENT_TYPES.includes(ev.type)) throw new Error(`events: unknown type '${ev.type}'`);
    if (!Number.isFinite(ev.t)) throw new Error(`events: '${ev.type}' needs a numeric t`);
  }
  // stable sort keeps the authored order of simultaneous events
  return events.map((ev, k) => [ev, k]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([ev]) => ev);
}

/**
 * Apply one event. ctx = { net, grid, inv, fb }.
 * Network branch ids used: 'fault', 'line1' (breaker side), 'load'.
 */
export function applyEvent(ev, { net, grid, inv }) {
  switch (ev.type) {
    case 'fault':
      net.setParams('fault', { R: ev.R ?? FAULT_R_DEFAULT });
      net.setEnabled('fault', true);
      break;
    case 'clear':
      net.setEnabled('fault', false);
      break;
    case 'sag':
      grid.sag(ev.V, ev.ramp ?? 0);
      break;
    case 'phaseJump':
      grid.phaseJump(ev.deg);
      break;
    case 'freqRamp':
      grid.freqRamp(ev.rocof_Hz_s, ev.duration ?? Infinity);
      break;
    case 'freqStep':
      grid.freqStep(ev.df_Hz);
      break;
    case 'breakerOpen':
      net.setEnabled('line1', false);
      break;
    case 'breakerClose':
      net.setEnabled('line1', true);
      break;
    case 'setpoint':
      inv.setRefs(ev);
      break;
    case 'loadStep': {
      const { R_L = 0, X_L = 0 } = ev;
      if (!Number.isFinite(R_L) || (R_L <= 0 && X_L <= 0)) { net.setEnabled('load', false); break; }
      net.setParams('load', { R: R_L, L: X_L / grid.wb });
      net.setEnabled('load', true);
      break;
    }
    default:
      throw new Error(`events: unhandled '${ev.type}'`);
  }
}
