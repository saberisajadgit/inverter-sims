// Grid Thevenin source v_g(t) = V_g(t)·e^(jθ_g(t)), dθ_g/dt = ω_b·ω_g(t) (SIM_SPEC §4.4).
import { polar } from './complex.js';

export class GridSource {
  constructor({ fb, V = 1, theta = 0, omega = 1 }) {
    this.fb = fb;
    this.wb = 2 * Math.PI * fb;
    this.V = V;
    this.theta = theta;       // rad, not wrapped (only differences are used)
    this.omega = omega;       // pu
    this.Vtarget = V; this.Vrate = 0;
    this.dOmega = 0; this.rampLeft = 0;
  }

  /** Step (ramp = 0) or ramp the source magnitude to V over `ramp` seconds. */
  sag(V, ramp = 0) {
    this.Vtarget = V;
    if (ramp > 0) this.Vrate = (V - this.V) / ramp;
    else { this.V = V; this.Vrate = 0; }
  }

  phaseJump(deg) { this.theta += (deg * Math.PI) / 180; }
  freqStep(dfHz) { this.omega += dfHz / this.fb; }
  freqRamp(rocofHzPerS, duration) { this.dOmega = rocofHzPerS / this.fb; this.rampLeft = duration; }

  step(dt) {
    if (this.Vrate !== 0) {
      this.V += this.Vrate * dt;
      if ((this.Vrate > 0 && this.V >= this.Vtarget) || (this.Vrate < 0 && this.V <= this.Vtarget)) {
        this.V = this.Vtarget; this.Vrate = 0;
      }
    }
    if (this.rampLeft > 0) {
      const h = Math.min(dt, this.rampLeft);
      this.omega += this.dOmega * h;
      this.rampLeft -= h;
    }
    this.theta += this.wb * this.omega * dt;
  }

  voltage() { return polar(this.V, this.theta); }
}
