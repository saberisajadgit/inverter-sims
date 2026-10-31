// Grid-following inverter (SIM_SPEC §4.7): SRF-PLL + dq current control,
// with K-factor ride-through, current limiting, PLL-loss blocking and P ramp.
//
// Sign convention (§3): d axis on v, so P = v_d·i_d and Q = −v_d·i_q.
// Voltage support (Q > 0, injecting) means i_q < 0.
import { abs } from './complex.js';
import { park, invPark } from './transforms.js';
import { SRFPLL } from './pll.js';
import { CurrentLoop } from './currentloop.js';
import { MODE } from './modes.js';

export const GFL_DEFAULTS = {
  P: 0.5, Q: 0,
  K: 2, dbLow: 0.9, dbHigh: 1.1,
  priority: 'Iq',            // 'Iq' | 'Id'
  realistic: true,           // false: no PLL-loss blocking
  Vblock: 0.15, tBlock: 0.001, tResume: 0.02,   // block after |v| < V_block for t_block
  Pramp: 2,                  // pu/s after a ride-through event
  fV: 100,                   // Hz, LPF on |v_c| used by the outer loop
  labelDeadband: false,      // show DEADBAND · CONSTANT P instead of NORMAL
  pll: { fn: 20, zeta: 0.707, normalize: false, ideal: false },
};

export class GFLInverter {
  constructor(p, { fb, Ts, filter, ctrl }) {
    this.type = 'GFL';
    this.p = p;
    this.fb = fb; this.wb = 2 * Math.PI * fb; this.Ts = Ts;
    this.Imax = ctrl.Imax;
    this.pll = new SRFPLL({ fb, Ts, ...p.pll });
    this.loop = new CurrentLoop({ fb, Ts, Xf: filter.Xf, Rf: filter.Rf, fc: ctrl.fc, Emax: ctrl.Emax, ffHz: p.ffHz ?? ctrl.ffHz });
    this.aV = 1 - Math.exp(-2 * Math.PI * p.fV * Ts);
    this.nResume = Math.max(1, Math.round(p.tResume / Ts));
    this.nBlock = Math.max(1, Math.round(p.tBlock / Ts));
  }

  /** Warm start from the steady-state phasors (already rotated to t0). */
  init({ vc, iF, e, thetaG }) {
    const th = Math.atan2(vc.im, vc.re);
    this.pll.init(th, 0);
    this.idealOffset = th - thetaG;
    this.Vf = abs(vc);
    this.Pref = this.p.P; this.Qref = this.p.Q;
    this.Plim = this.p.P;
    this.blocked = false; this.resumeCount = 0; this.blockCount = 0;
    this.frameTheta = th; this.omegaPu = 1;
    this.idq = park(iF, th); this.idqRef = this.idq;
    this.vdq = park(vc, th);
    this.loop.init(park(e, th), this.idq, this.vdq, 1);
    this.mode = this.p.labelDeadband ? MODE.DEADBAND : MODE.NORMAL;
  }

  setRefs({ P, Q }) {
    if (P !== undefined) { this.Pref = P; this.Plim = Math.max(this.Plim, P); }
    if (Q !== undefined) this.Qref = Q;
  }

  get Pstar() { return this.Pref; }
  get Qstar() { return this.Qref; }
  get pllFreqHz() { return this.p.pll.ideal ? this.fb * this.omegaPu : this.pll.freqHz; }

  /** One control sample. Returns the αβ voltage command (before delay compensation). */
  control({ vc, iF, thetaG, omegaG }) {
    const p = this.p, Ts = this.Ts;
    const vin = abs(vc);
    this.Vf += this.aV * (vin - this.Vf);

    // PLL loss of lock: below V_block the voltage angle is undefined (realistic mode)
    if (p.realistic) {
      if (!this.blocked) {
        // debounced so LC ringing at fault inception doesn't trip it
        this.blockCount = vin < p.Vblock ? this.blockCount + 1 : 0;
        if (this.blockCount >= this.nBlock) { this.blocked = true; this.resumeCount = 0; this.blockCount = 0; }
      } else if (vin > p.Vblock + 0.05) {
        if (++this.resumeCount >= this.nResume) this.blocked = false;
      } else this.resumeCount = 0;
    }

    // synchronisation: SRF-PLL, or "ideal" = grid angle + pre-fault offset (an oracle)
    let th, w;
    const ideal = p.pll.ideal;
    if (ideal) { th = thetaG + this.idealOffset; w = omegaG; }
    else { th = this.pll.theta; }
    const vdq = park(vc, th), idq = park(iF, th);
    if (!ideal) {
      this.pll.frozen = this.blocked;
      this.pll.update(vdq, vin);       // advances pll.theta to the next sample
      w = 1 + this.pll.dw;
    }

    // outer references
    const V = Math.max(this.Vf, 0.5);
    if (!this.blocked) this.Plim = Math.min(Math.max(this.Pref, 0), this.Plim + p.Pramp * Ts);
    const Pcmd = this.Pref > 0 ? Math.min(this.Pref, this.Plim) : this.Pref;
    let id = Pcmd / V;
    let iq = -this.Qref / V;
    let zone = false;
    if (this.Vf < p.dbLow) { zone = true; iq -= p.K * (p.dbLow - this.Vf); }        // inject (iq < 0)
    else if (this.Vf > p.dbHigh) { zone = true; iq += p.K * (this.Vf - p.dbHigh); }  // absorb

    // current limit
    const Im = this.Imax;
    let limited = false;
    if (id * id + iq * iq > Im * Im * (1 + 1e-9)) {
      limited = true;
      if (p.priority === 'Id') {
        id = Math.max(-Im, Math.min(Im, id));
        const r = Math.sqrt(Math.max(0, Im * Im - id * id));
        iq = Math.max(-r, Math.min(r, iq));
      } else {
        iq = Math.max(-Im, Math.min(Im, iq));
        const r = Math.sqrt(Math.max(0, Im * Im - iq * iq));
        id = Math.max(-r, Math.min(r, id));
      }
    }
    // remember what was actually deliverable so P ramps back up afterwards
    if (zone && this.Pref > 0) this.Plim = Math.min(this.Plim, Math.max(0, V * id));
    if (this.blocked) { id = 0; iq = 0; this.Plim = 0; }

    const iref = { re: id, im: iq };
    const edq = this.loop.step(iref, idq, vdq, w);

    let mode;
    if (this.blocked) mode = MODE.BLOCKED;
    else if (limited) mode = p.priority === 'Id' ? MODE.CL_ID : MODE.CL_IQ;
    else if (zone) mode = MODE.KFACTOR;
    else if (this.Pref > 0 && this.Plim < this.Pref - 1e-6) mode = MODE.RECOVERY;
    else mode = p.labelDeadband ? MODE.DEADBAND : MODE.NORMAL;

    this.mode = mode;
    this.frameTheta = th;
    this.omegaPu = w;
    this.idq = idq; this.idqRef = iref; this.vdq = vdq;
    return invPark(edq, th);
  }
}
