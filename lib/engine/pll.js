// Synchronous-reference-frame PLL (SIM_SPEC §4.5).
//
//   v_dq = v_c·e^(−jθ)
//   Δω = K_p·v_q + K_i·∫v_q dt        (pu, clamped ±0.1)
//   dθ/dt = ω_b·(1 + Δω)
//
// Linearised at |v| = 1: ω_n² = ω_b·K_i, 2ζω_n = ω_b·K_p, so
//   K_p = 2ζω_n/ω_b,  K_i = ω_n²/ω_b.
// Without pre-normalisation the loop gain scales with |v|: at low voltage the
// PLL slows down, and below V_block (handled by the inverter) it is frozen.

export class SRFPLL {
  constructor({ fb, Ts, fn = 20, zeta = 0.707, normalize = false, clamp = 0.1 }) {
    this.fb = fb; this.wb = 2 * Math.PI * fb; this.Ts = Ts;
    const wn = 2 * Math.PI * fn;
    this.Kp = (2 * zeta * wn) / this.wb;
    this.Ki = (wn * wn) / this.wb;
    this.normalize = normalize;
    this.clamp = clamp;
    this.lockSamples = Math.round(2 / (fb * Ts));   // 2 cycles
    this.init(0, 0);
  }

  init(theta, dw = 0) {
    this.theta = theta;
    this.xi = dw;
    this.dw = dw;
    this.frozen = false;
    this.lockCount = this.lockSamples;
    this.locked = true;
  }

  /**
   * One control sample. `vdq` must be v_c already rotated by the current
   * this.theta; `vmag` = |v_c|. Advances θ to the next sample.
   */
  update(vdq, vmag) {
    const vq = vdq.im;
    if (!this.frozen) {
      const err = this.normalize ? vq / Math.max(vmag, 1e-6) : vq;
      this.xi = Math.max(-this.clamp, Math.min(this.clamp, this.xi + this.Ki * err * this.Ts));
      this.dw = Math.max(-this.clamp, Math.min(this.clamp, this.Kp * err + this.xi));
    } else {
      this.dw = this.xi;   // integrator frozen, θ free-runs at the last frequency
    }
    this.theta += this.wb * (1 + this.dw) * this.Ts;
    if (this.theta > Math.PI) this.theta -= 2 * Math.PI;
    else if (this.theta <= -Math.PI) this.theta += 2 * Math.PI;

    const good = vmag > 1e-6 && Math.abs(vq) / vmag < 0.05 && !this.frozen;
    this.lockCount = good ? this.lockCount + 1 : 0;
    this.locked = this.lockCount >= this.lockSamples;
  }

  get omegaPu() { return 1 + this.dw; }
  get freqHz() { return this.fb * (1 + this.dw); }
}
