// Inner dq current controller (SIM_SPEC §4.6).
//
//   e_dq* = v_dq + (K_pc + K_ic/s)(i_dq* − i_dq) + j·ω·X_f·i_dq + R_f·i_dq
//
// Pole–zero cancellation for closed-loop bandwidth ω_c:
//   K_pc = ω_c·X_f/ω_b,  K_ic = ω_c·R_f
// Modulation limit |e_dq*| ≤ E_max (vector scaled); the integrator is held
// while saturated (conditional anti-windup).
// Options: ffGain scales the v_dq feedforward; ffHz low-pass filters it in dq
// (null = raw sampled v_dq).

export class CurrentLoop {
  constructor({ fb, Ts, Xf, Rf, fc = 800, Emax = 1.15, ffGain = 1, ffHz = null }) {
    if (fc > 1 / Ts / 10 + 1e-9) throw new Error(`currentloop: f_c = ${fc} Hz exceeds f_ctrl/10`);
    const wb = 2 * Math.PI * fb, wc = 2 * Math.PI * fc;
    this.Kp = (wc * Xf) / wb;
    this.Ki = wc * Rf;
    this.Xf = Xf; this.Rf = Rf; this.Ts = Ts; this.Emax = Emax;
    this.ffGain = ffGain;
    this.aFF = ffHz ? 1 - Math.exp(-2 * Math.PI * ffHz * Ts) : 1;
    this.vfRe = 0; this.vfIm = 0;
    this.xRe = 0; this.xIm = 0;
    this.saturated = false;
  }

  /** Set the integrator so the loop outputs e_dq in steady state (zero error). */
  init(edq, idq, vdq, w = 1) {
    this.vfRe = vdq.re; this.vfIm = vdq.im;
    this.xRe = edq.re - this.ffGain * vdq.re + w * this.Xf * idq.im - this.Rf * idq.re;
    this.xIm = edq.im - this.ffGain * vdq.im - w * this.Xf * idq.re - this.Rf * idq.im;
    this.saturated = false;
  }

  /** All arguments in the controller's dq frame; w = frame speed in pu. */
  step(iref, idq, vdq, w = 1) {
    const er = iref.re - idq.re, ei = iref.im - idq.im;
    this.vfRe += this.aFF * (vdq.re - this.vfRe);
    this.vfIm += this.aFF * (vdq.im - this.vfIm);
    let ur = this.ffGain * this.vfRe + this.Kp * er + this.xRe - w * this.Xf * idq.im + this.Rf * idq.re;
    let ui = this.ffGain * this.vfIm + this.Kp * ei + this.xIm + w * this.Xf * idq.re + this.Rf * idq.im;
    const m = Math.sqrt(ur * ur + ui * ui);
    if (m > this.Emax) {
      ur *= this.Emax / m; ui *= this.Emax / m;
      this.saturated = true;
    } else {
      this.saturated = false;
      this.xRe += this.Ki * er * this.Ts;
      this.xIm += this.Ki * ei * this.Ts;
    }
    return { re: ur, im: ui };
  }
}
