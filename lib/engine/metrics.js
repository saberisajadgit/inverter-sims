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
