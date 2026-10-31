// Grid-forming inverter (SIM_SPEC §4.8).
//
// Outer loop (synchronises through power, no PLL):
//   droop: ω = ω_ref + m_p·(P* − P_f),       E = V* + n_q·(Q* − Q_f)
//   vsm:   2H·dω/dt = P* − P_f − D·(ω − ω_ref), E as droop
//   dθ/dt = ω_b·ω
// Inner options:
//   voltageSource: e = E·e^(jθ) − (R_v + jX_v)·i_f       (no current limit)
//   viCurrentRef:  i_ref = (E·e^(jθ) − v_c)/(R_v + jX_v) → limiter → current loop
//
// Implementation choices (also in docs/ENGINE_NOTES.md):
// - voltageSource: quasi-stationary virtual impedance (jX_v applied to the αβ
//   current vector), the usual implementation.
// - viCurrentRef: the division is realised as a *dynamic* virtual RL branch in
//   the GFM's own dq frame,
//       L_v·di_ref/dt + (R_v + jωX_v)·i_ref = E − v_c,f      (L_v = X_v/ω_b)
//   driven by v_c low-pass filtered in dq (f_vi, default 300 Hz). At the
//   fundamental it equals the algebraic form. Feeding the raw v_c straight
//   through 1/Z_v (gain ≈ 6.7) excites the LCL resonance and is unstable for
//   SCR ≲ 10 with these defaults; the filter + virtual inductance is the usual
//   fix. The dynamic form also reproduces the DC offset at fault inception.
//   The circular limiter scales the output |i_ref| ≤ I_max; the branch state
//   itself is not clamped, so a limited current keeps the impedance angle.
// - Inner current loop: f_c = 500 Hz (GFL keeps ctrl.fc = 800 Hz). With the
//   shared 150 Hz feedforward LPF (ctrl.ffHz) this is stable from SCR 1.1 to
//   20; at 800 Hz the VI path + Z_g oscillate (≈1 kHz) below SCR ≈ 1.5.
import { abs, add, sub, mul, conj, polar, scale } from './complex.js';
import { park, invPark } from './transforms.js';
import { CurrentLoop } from './currentloop.js';
import { MODE } from './modes.js';

export const GFM_DEFAULTS = {
  P: 0.5, Q: 0,
  V: 'auto',                 // V*: 'auto' = internal EMF that gives Q = Q* at the initial operating point
  outer: 'droop',            // 'droop' | 'vsm'
  mp: 0.05, nq: 0.05,
  H: 3, D: 20,
  fpq: null,                 // P/Q measurement LPF; null → 10 Hz (droop) or 50 Hz (vsm)
  inner: 'viCurrentRef',     // 'viCurrentRef' | 'voltageSource'
  Xv: 0.15, Rv: 0.02,
  fvi: 300,                  // Hz, dq LPF on v_c feeding the virtual impedance
  fc: 500,                   // Hz, inner current-loop bandwidth (GFL uses ctrl.fc)
  limiter: 'circular',       // 'circular' | 'adaptiveVI' | 'none'
  kvi: 0.5, Ith: 1.0,        // adaptiveVI: X_v,eff = X_v + k_vi·max(0, |i| − I_th)
  freezeAngleOnLimit: false, // mitigation: hold ω = ω_ref while current-limited
};

export class GFMInverter {
  constructor(p, { fb, Ts, filter, ctrl }) {
    this.type = 'GFM';
    this.p = p;
    this.fb = fb; this.wb = 2 * Math.PI * fb; this.Ts = Ts;
    this.Imax = ctrl.Imax; this.Emax = ctrl.Emax;
    this.Zv = { re: p.Rv, im: p.Xv };
    this.loop = new CurrentLoop({ fb, Ts, Xf: filter.Xf, Rf: filter.Rf, fc: p.fc ?? ctrl.fc, Emax: ctrl.Emax, ffHz: p.ffHz ?? ctrl.ffHz });
    const fpq = p.fpq ?? (p.outer === 'vsm' ? 50 : 10);
    this.aPQ = 1 - Math.exp(-2 * Math.PI * fpq * Ts);
    this.aV = 1 - Math.exp(-2 * Math.PI * p.fvi * Ts);
  }

  /** Warm start from the steady-state phasors (already rotated to t0). */
  init({ vc, iF, e }) {
    const p = this.p;
    // internal EMF behind the virtual impedance at the initial operating point
    const Eint = p.inner === 'voltageSource' ? add(e, mul(this.Zv, iF)) : add(vc, mul(this.Zv, iF));
    const S = mul(vc, conj(iF));
    this.theta = Math.atan2(Eint.im, Eint.re);
    this.Pf = S.re; this.Qf = S.im;
    this.Pref = p.P === 'auto' ? S.re : p.P;
    this.Qref = p.Q === 'auto' ? S.im : p.Q;
    this.Vref = p.V === 'auto' || p.V == null ? abs(Eint) + p.nq * (this.Qf - this.Qref) : p.V;
    this.omega = p.outer === 'vsm' ? 1 : 1 + p.mp * (this.Pref - this.Pf);
    this.omegaPu = this.omega;
    this.E = this.Vref + p.nq * (this.Qref - this.Qf);
    this.frameTheta = this.theta;
    this.idq = park(iF, this.theta); this.idqRef = this.idq;
    this.vdq = park(vc, this.theta);
    this.vdqF = { ...this.vdq };
    this.ivdq = { ...this.idq };               // virtual-branch current (dq)
    this.uPrev = { re: this.E - this.vdqF.re, im: -this.vdqF.im };
    this.loop.init(park(e, this.theta), this.idq, this.vdq, this.omega);
    this.limited = false;
    this.mode = MODE.NORMAL;
  }

  setRefs({ P, Q, V }) {
    if (P !== undefined) this.Pref = P;
    if (Q !== undefined) this.Qref = Q;
    if (V !== undefined) this.Vref = V;
  }

  get Pstar() { return this.Pref; }
  get Qstar() { return this.Qref; }
  get pllFreqHz() { return NaN; }   // no PLL

  control({ vc, iF }) {
    const p = this.p, Ts = this.Ts;
    const S = mul(vc, conj(iF));
    this.Pf += this.aPQ * (S.re - this.Pf);
    this.Qf += this.aPQ * (S.im - this.Qf);

    // outer loop
    if (p.outer === 'vsm') this.omega += (Ts / (2 * p.H)) * (this.Pref - this.Pf - p.D * (this.omega - 1));
    else this.omega = 1 + p.mp * (this.Pref - this.Pf);
    const w = p.freezeAngleOnLimit && this.limited ? 1 : this.omega;
    this.E = this.Vref + p.nq * (this.Qref - this.Qf);

    const th = this.theta;
    const idq = park(iF, th), vdq = park(vc, th);
    const imeas = abs(iF);
    let e, mode = MODE.NORMAL, limited = false;

    if (p.inner === 'voltageSource') {
      e = sub(polar(this.E, th), mul(this.Zv, iF));
      const m = abs(e);
      if (m > this.Emax) e = scale(e, this.Emax / m);
      if (imeas > this.Imax) mode = MODE.VS_UNLIMITED;
      this.idqRef = idq;
    } else {
      this.vdqF.re += this.aV * (vdq.re - this.vdqF.re);
      this.vdqF.im += this.aV * (vdq.im - this.vdqF.im);
      let Rv = p.Rv, Xv = p.Xv;
      if (p.limiter === 'adaptiveVI' && imeas > p.Ith) {
        const k = 1 + (p.kvi * (imeas - p.Ith)) / p.Xv;   // scale R_v with X_v to keep X/R
        Rv *= k; Xv *= k;
        mode = MODE.ADAPTIVE_VI;
      }
      // trapezoidal step of L_v·di/dt + (R_v + jωX_v)·i = u, u = E − v_c,f (dq)
      const Lv = Xv / this.wb;
      const u = { re: this.E - this.vdqF.re, im: -this.vdqF.im };
      const zr = (Ts * Rv) / (2 * Lv), zi = (Ts * w * Xv) / (2 * Lv);   // Ts·Z/(2L_v)
      const g = Ts / (2 * Lv);
      const nr = (1 - zr) * this.ivdq.re + zi * this.ivdq.im + g * (u.re + this.uPrev.re);
      const ni = (1 - zr) * this.ivdq.im - zi * this.ivdq.re + g * (u.im + this.uPrev.im);
      const dr = 1 + zr, di = zi, dd = dr * dr + di * di;
      // the virtual branch runs unclamped (R_v bounds it at |u|/|Z_v|) so the
      // limited current keeps the impedance angle; only its output is limited
      this.ivdq = { re: (nr * dr + ni * di) / dd, im: (ni * dr - nr * di) / dd };
      let iref = this.ivdq;
      this.uPrev = u;
      const mag = abs(iref);
      if (mag > this.Imax) {
        if (p.limiter === 'none') mode = MODE.UNLIMITED;
        else {
          // circular limiter (also the backstop for adaptiveVI)
          iref = scale(iref, this.Imax / mag);
          limited = true;
          if (mode !== MODE.ADAPTIVE_VI) mode = MODE.CL;
        }
      }
      const edq = this.loop.step(iref, idq, vdq, w);
      e = invPark(edq, th);
      this.idqRef = iref;
    }

    this.idq = idq;
    this.vdq = vdq;
    this.theta = th + this.wb * w * Ts;
    if (this.theta > Math.PI) this.theta -= 2 * Math.PI;
    else if (this.theta <= -Math.PI) this.theta += 2 * Math.PI;
    this.limited = limited;
    this.mode = mode;
    this.frameTheta = th;
    this.omegaPu = w;
    return e;
  }
}
