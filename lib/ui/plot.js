// Canvas waveform plot with progressive reveal and a cursor (SIM_SPEC §5.1, §6).
// draw() is a pure function of its arguments: no clocks, no randomness.

const css = (el, v) => getComputedStyle(el).getPropertyValue(v).trim();

/** Smallest "nice" number ≥ x from 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^k. */
export function niceCeil(x) {
  const mag = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= x - 1e-9) return m * mag;
  return 10 * mag;
}

export class WavePlot {
  /**
   * series: [{ key, color (css var or colour), width, dash }]
   * opts: { yMax, limit (±I_max lines), bands: [[t0, t1]], clipPeak,
   *         freq: { key, center, span, label, color } }  optional frequency strip
   *         along the bottom of the chart with its own axis on the right
   */
  constructor(canvas, { series, fontPx = 16 }) {
    this.cv = canvas;
    this.series = series;
    this.fontPx = fontPx;
  }

  setData(ts, opts) { this.ts = ts; this.opts = opts; }

  /** cursorT: last revealed sim time (s); null = everything. */
  draw(cursorT) {
    const { cv, ts, opts } = this;
    if (!ts) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(10, cv.clientWidth), H = Math.max(10, cv.clientHeight);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const fp = this.fontPx;
    const fq = opts.freq;
    const L = fp * 3.1, R = fq ? fp * 3.4 : fp * 1.5, T = 8, B = fp + 12;
    const t = ts.t, n = ts.n, t0 = t[0], t1 = t[n - 1];
    const X = (x) => L + ((x - t0) / (t1 - t0)) * (W - L - R);
    const yMax = opts.yMax;
    // main (current) area T..Hm; frequency strip F0..F1 below it
    const Hm = fq ? T + Math.round((H - T - B) * 0.72) : H - B;
    const F0 = Hm + 10, F1 = H - B;
    const Y = (y) => T + (1 - (y + yMax) / (2 * yMax)) * (Hm - T);
    const YF = fq ? (f) => F0 + (1 - (f - (fq.center - fq.span)) / (2 * fq.span)) * (F1 - F0) : null;
    const tc = cursorT == null ? t1 : Math.max(t0, Math.min(t1, cursorT));
    let jc = 0;
    while (jc < n - 1 && t[jc + 1] <= tc + 1e-9) jc++;

    const col = (c) => (c.startsWith('--') ? css(cv, c) : c);
    g.font = `${fp}px ${css(cv, '--font-ui')}`;
    g.textBaseline = 'middle';

    // fault band (revealed with the cursor)
    for (const [a, b] of opts.bands || []) {
      if (a > tc) continue;
      g.fillStyle = col('--fault-band');
      const xa = X(Math.max(a, t0)), xb = X(Math.min(b, tc));
      g.fillRect(xa, T, xb - xa, H - T - B);
    }

    // grid + y ticks
    const step = yTickStep(yMax, Hm - T);
    g.strokeStyle = col('--grid'); g.lineWidth = 1; g.fillStyle = col('--muted'); g.textAlign = 'right';
    for (let y = -Math.floor(yMax / step) * step; y <= yMax + 1e-9; y += step) {
      g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(W - R, Y(y)); g.stroke();
      g.fillText(fmtTick(y), L - 8, Y(y));
    }
    if (fq) {
      // frequency strip: separator, grid at centre ± span, right-hand axis in Hz
      g.strokeStyle = col('--axis'); g.beginPath(); g.moveTo(L, Hm + 5); g.lineTo(W - R, Hm + 5); g.stroke();
      g.textAlign = 'left'; g.fillStyle = col(fq.color);
      for (const f of [fq.center - fq.span, fq.center, fq.center + fq.span]) {
        g.strokeStyle = col('--grid'); g.beginPath(); g.moveTo(L, YF(f)); g.lineTo(W - R, YF(f)); g.stroke();
        g.fillText(fmtHz(f), W - R + 8, YF(f));
      }
      g.textBaseline = 'top'; g.font = `600 ${fp}px ${css(cv, '--font-ui')}`;
      g.fillText(fq.label, L + 6, F0 - 1);
      g.font = `${fp}px ${css(cv, '--font-ui')}`; g.textBaseline = 'middle';
    }
    // x ticks every 20 ms
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (let ms = Math.ceil(t0 * 1000 / 20 - 1e-6) * 20; ms <= t1 * 1000 + 1e-6; ms += 20) {
      const x = X(ms / 1000);
      g.strokeStyle = col('--grid'); g.beginPath(); g.moveTo(x, T); g.lineTo(x, H - B); g.stroke();
      g.fillStyle = col('--muted');
      g.fillText(ms === 0 ? '0 ms' : (ms > 0 ? '+' : '') + ms, x, H - 4);
    }
    g.strokeStyle = col('--axis'); g.beginPath(); g.moveTo(L, T); g.lineTo(L, H - B); g.lineTo(W - R, H - B); g.stroke();
    if (fq) { g.beginPath(); g.moveTo(W - R, F0); g.lineTo(W - R, F1); g.stroke(); }

    // ±I_max
    if (opts.limit) {
      g.strokeStyle = col('--limit'); g.lineWidth = 2; g.setLineDash([7, 6]);
      for (const y of [opts.limit, -opts.limit]) { g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(W - R, Y(y)); g.stroke(); }
      g.setLineDash([]);
    }

    // traces up to the cursor, clipped to the plot area (extreme peaks clamp visually)
    g.save();
    g.beginPath(); g.rect(L, T, W - L - R, Hm - T); g.clip();
    for (const s of this.series) {
      const y = ts[s.key];
      g.strokeStyle = col(s.color); g.lineWidth = s.width ?? 2.5; g.setLineDash(s.dash || []);
      g.lineJoin = 'round';
      g.beginPath();
      for (let j = 0; j <= jc; j++) { const px = X(t[j]), py = Y(y[j]); j ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
    }
    g.setLineDash([]);
    g.restore();

    if (fq) {
      g.save();
      g.beginPath(); g.rect(L, F0 - 2, W - L - R, F1 - F0 + 4); g.clip();
      g.strokeStyle = col(fq.color); g.lineWidth = 2.5; g.lineJoin = 'round';
      const f = ts[fq.key];
      g.beginPath();
      for (let j = 0; j <= jc; j++) { const px = X(t[j]), py = YF(f[j]); j ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
      g.restore();
    }

    // clipped-peak marker: the true peak is still printed in the readout
    if (opts.clipPeak && opts.clipPeak.t <= tc) {
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.font = `600 ${fp}px ${css(cv, '--font-ui')}`;
      const txt = `▲ peak ${opts.clipPeak.v.toFixed(2)} pu (off scale)`;
      const tw = g.measureText(txt).width;
      const x = Math.min(X(opts.clipPeak.t) + 8, W - R - tw - 8);
      g.fillStyle = col('--panel'); g.globalAlpha = 0.92;
      g.fillRect(x - 5, T + 3, tw + 10, fp + 8);
      g.globalAlpha = 1; g.fillStyle = col('--limit');
      g.fillText(txt, x, T + 7);
    }

    // cursor
    if (cursorT != null && tc < t1) {
      g.strokeStyle = col('--ink'); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(tc), T); g.lineTo(X(tc), H - B); g.stroke();
    }
    this.geom = { L, R, T, B, W, H, t0, t1 };
  }

  /** Canvas x (css px) → sim time, or null outside the plot area. */
  timeAtX(x) {
    const gm = this.geom;
    if (!gm) return null;
    const f = (x - gm.L) / (gm.W - gm.L - gm.R);
    return f < 0 || f > 1 ? null : gm.t0 + f * (gm.t1 - gm.t0);
  }
}

/** Tick step for a ±yMax axis drawn over `px` pixels: keep labels ≥ 28 px apart. */
function yTickStep(yMax, px) {
  for (const s of [0.5, 1, 2, 5, 10]) if (yMax / s <= 4 && (s / (2 * yMax)) * px >= 28) return s;
  return 20;
}
const fmtHz = (f) => (Number.isInteger(Math.round(f * 10) / 10) ? f.toFixed(0) : f.toFixed(1));
const fmtTick = (y) => (Math.abs(y) < 1e-9 ? '0' : Number.isInteger(y) ? String(y) : y.toFixed(1));
