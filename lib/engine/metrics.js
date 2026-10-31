// Post-processing helpers on a TimeSeries from simulate.run().
import { MODES } from './modes.js';

/** Index of the sample nearest to t. */
export function idxAt(ts, t) {
  const tt = ts.t;
  let lo = 0, hi = ts.n - 1;
  if (t <= tt[0]) return 0;
  if (t >= tt[hi]) return hi;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tt[mid] <= t) lo = mid; else hi = mid; }
  return t - tt[lo] <= tt[hi] - t ? lo : hi;
}

export const at = (ts, key, t) => ts[key][idxAt(ts, t)];

function range(ts, t0, t1) {
  const a = t0 == null ? 0 : idxAt(ts, t0), b = t1 == null ? ts.n - 1 : idxAt(ts, t1);
  return [a, b];
}

export function maxOf(ts, key, t0, t1) { const [a, b] = range(ts, t0, t1); let m = -Infinity; for (let j = a; j <= b; j++) m = Math.max(m, ts[key][j]); return m; }
export function minOf(ts, key, t0, t1) { const [a, b] = range(ts, t0, t1); let m = Infinity; for (let j = a; j <= b; j++) m = Math.min(m, ts[key][j]); return m; }
export function mean(ts, key, t0, t1) { const [a, b] = range(ts, t0, t1); let s = 0; for (let j = a; j <= b; j++) s += ts[key][j]; return s / (b - a + 1); }

/** max |x| over several keys in [t0, t1]. */
export function peakAbs(ts, keys, t0, t1) {
  const [a, b] = range(ts, t0, t1);
  let m = 0;
  for (const k of keys) for (let j = a; j <= b; j++) m = Math.max(m, Math.abs(ts[k][j]));
  return m;
}

/** Highest instantaneous phase-current peak in the first cycle after t0. */
export function firstPeak(ts, t0 = 0) {
  return peakAbs(ts, ['ia', 'ib', 'ic'], t0, t0 + 1 / ts.meta.fb);
}

/** Fundamental phasor magnitudes at t. */
export function phasorAt(ts, t) {
  const j = idxAt(ts, t);
  return {
    V: Math.hypot(ts.VpRe[j], ts.VpIm[j]),
    I: Math.hypot(ts.IpRe[j], ts.IpIm[j]),
    phi: ts.phi_deg[j],
  };
}

/** First time after t0 from which |x − final| stays within tol until the end. */
export function settlingTime(ts, key, final, tol, t0 = 0) {
  const a = idxAt(ts, t0);
  let last = -1;
  for (let j = a; j < ts.n; j++) if (Math.abs(ts[key][j] - final) > tol) last = j;
  if (last === ts.n - 1) return Infinity;
  return last < 0 ? 0 : ts.t[last + 1] - t0;
}

export function modeAt(ts, t) { return MODES[ts.mode[idxAt(ts, t)]]; }

/** Distinct mode keys visited in [t0, t1], in order of first appearance. */
export function modesVisited(ts, t0, t1) {
  const [a, b] = range(ts, t0, t1);
  const seen = [];
  for (let j = a; j <= b; j++) { const k = MODES[ts.mode[j]].key; if (!seen.includes(k)) seen.push(k); }
  return seen;
}

/**
 * Oscillation growth: peak-to-peak of `key` in the last `span` seconds divided
 * by peak-to-peak in the `span` seconds right after t0. > 1 means growing.
 */
export function envelopeGrowth(ts, key, t0, span) {
  const tEnd = ts.t[ts.n - 1];
  const p2p = (a, b) => maxOf(ts, key, a, b) - minOf(ts, key, a, b);
  return p2p(tEnd - span, tEnd) / Math.max(1e-12, p2p(t0, t0 + span));
}

// ---- scenario `expect` blocks (SIM_SPEC §9.2) --------------------------------------
/** Scalar metrics an expect block or expectAcross can refer to. */
export function metric(ts, name) {
  const end = ts.t[ts.n - 1];
  switch (name) {
    case 'Iend': return phasorAt(ts, end).I;
    case 'Vend': return phasorAt(ts, end).V;
    case 'IqEnd': return at(ts, 'Iq', end);
    case 'IdEnd': return at(ts, 'Id', end);
    case 'firstPeak': return firstPeak(ts);
    case 'deltaEnd': return at(ts, 'delta_deg', end);
    default: throw new Error(`metrics: unknown metric '${name}'`);
  }
}

/**
 * Check one case's expect block. Supported keys:
 *   firstPeakMin, firstPeakMax          instantaneous phase peak in the first cycle
 *   IafterMs: [ms, lo, hi]              every |i_αβ| sample from ms to the end
 *   IendRange / VendRange / IqEndRange / IdEndRange: [lo, hi]   at window end
 *   modeAtMs: [ms, 'KEY']               controller mode at that time
 *   modeVisited: 'KEY'                  mode appears somewhere after t = 0
 *   deltaEndAbsMin                      |δ drift| at window end, degrees
 * Returns an array of failure strings (empty = pass).
 */
export function checkExpect(ts, exp = {}) {
  const fails = [];
  const range = (label, v, [lo, hi]) => { if (!(v >= lo && v <= hi)) fails.push(`${label} = ${v.toFixed(3)} not in [${lo}, ${hi}]`); };
  const end = ts.t[ts.n - 1];
  for (const [k, v] of Object.entries(exp)) {
    switch (k) {
      case 'firstPeakMin': if (!(firstPeak(ts) >= v)) fails.push(`first peak ${firstPeak(ts).toFixed(3)} < ${v}`); break;
      case 'firstPeakMax': if (!(firstPeak(ts) <= v)) fails.push(`first peak ${firstPeak(ts).toFixed(3)} > ${v}`); break;
      case 'IafterMs': {
        const [ms, lo, hi] = v;
        range(`|i| after ${ms} ms (min)`, minOf(ts, 'Imag', ms / 1000, end), [lo, hi]);
        range(`|i| after ${ms} ms (max)`, maxOf(ts, 'Imag', ms / 1000, end), [lo, hi]);
        break;
      }
      case 'IendRange': range('|I| at end', metric(ts, 'Iend'), v); break;
      case 'VendRange': range('|V| at end', metric(ts, 'Vend'), v); break;
      case 'IqEndRange': range('Iq at end', metric(ts, 'IqEnd'), v); break;
      case 'IdEndRange': range('Id at end', metric(ts, 'IdEnd'), v); break;
      case 'modeAtMs': {
        const m = modeAt(ts, v[0] / 1000);
        if (m.key !== v[1]) fails.push(`mode at ${v[0]} ms = ${m.key}, expected ${v[1]}`);
        break;
      }
      case 'modeVisited': if (!modesVisited(ts, 0, end).includes(v)) fails.push(`mode ${v} never visited after t = 0`); break;
      case 'deltaEndAbsMin': if (!(Math.abs(metric(ts, 'deltaEnd')) >= v)) fails.push(`|δ| at end ${Math.abs(metric(ts, 'deltaEnd')).toFixed(1)}° < ${v}°`); break;
      default: fails.push(`unknown expect key '${k}'`);
    }
  }
  return fails;
}
