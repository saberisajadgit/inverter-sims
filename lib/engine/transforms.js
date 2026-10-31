// Clarke / Park transforms (amplitude-invariant, SIM_SPEC §3) and the
// fundamental phasor estimator (SIM_SPEC §4.10).
import { rot } from './complex.js';

const S3_2 = Math.sqrt(3) / 2;

/** abc → αβ (amplitude invariant: |x_αβ| = phase peak). */
export function clarke(a, b, c) {
  return { re: (2 / 3) * (a - 0.5 * b - 0.5 * c), im: (2 / 3) * S3_2 * (b - c) };
}

/** αβ → abc (zero-sequence assumed 0). */
export function invClarke(z) {
  return [z.re, -0.5 * z.re + S3_2 * z.im, -0.5 * z.re - S3_2 * z.im];
}

/** αβ → dq in a frame at angle θ: x_dq = x_αβ·e^(−jθ). */
export const park = (z, th) => rot(z, -th);
/** dq → αβ. */
export const invPark = (z, th) => rot(z, th);

/**
 * One-cycle moving-average phasor estimator: X̂ = MA_T[x_αβ·e^(−jω_b t)].
 * Removes DC offset (seen at −f_b) and negative sequence (−2f_b).
 * T/dt is usually not an integer (60 Hz at 10 µs → 1666.67 samples), so the
 * oldest sample in the window gets a fractional weight.
 */
export class PhasorEstimator {
  constructor(dt, fb) {
    this.wb = 2 * Math.PI * fb;
    this.nWin = 1 / (fb * dt);           // samples per cycle (fractional)
    this.L = Math.floor(this.nWin);
    this.frac = this.nWin - this.L;
    this.size = this.L + 1;
    this.re = new Float64Array(this.size);
    this.im = new Float64Array(this.size);
    this.head = 0;                        // index of the newest sample
    this.sumRe = 0; this.sumIm = 0;       // sum of the newest L samples
    this.count = 0;
  }

  /** Pre-fill as if x had been the steady phasor X forever. */
  fill(X) {
    this.re.fill(X.re); this.im.fill(X.im);
    this.sumRe = X.re * this.L; this.sumIm = X.im * this.L;
    this.count = 0;
  }

  push(z, t) {
    const x = rot(z, -this.wb * t);
    // the sample leaving the "newest L" set becomes the fractional oldest one
    const next = (this.head + 1) % this.size;           // currently the oldest (L+1-th) slot
    const leaving = (this.head + 1 + 1) % this.size;    // after write, this becomes the oldest
    this.sumRe += x.re - this.re[leaving];
    this.sumIm += x.im - this.im[leaving];
    this.re[next] = x.re; this.im[next] = x.im;
    this.head = next;
    // re-sum periodically to stop rounding drift
    if (++this.count >= 20000) this._resum();
  }

  _resum() {
    let sr = 0, si = 0;
    for (let k = 0; k < this.L; k++) {
      const i = (this.head - k + this.size) % this.size;
      sr += this.re[i]; si += this.im[i];
    }
    this.sumRe = sr; this.sumIm = si; this.count = 0;
  }

  value() {
    const old = (this.head + 1) % this.size;
    return {
      re: (this.sumRe + this.frac * this.re[old]) / this.nWin,
      im: (this.sumIm + this.frac * this.im[old]) / this.nWin,
    };
  }
}
