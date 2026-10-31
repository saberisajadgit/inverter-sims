// EMTP-style network solver (SIM_SPEC §4.3).
//
// The system is balanced and every element has real R, L, C, so the α and β
// networks are identical: one complex nodal system is solved, with every
// voltage and current being its complex αβ value.
//
// Companion models (Δt = dt):
//   series RL  trapezoidal: G = 1/(2L/Δt + R), I_h = G·[v(n) + (2L/Δt − R)·i(n)]
//              backward Euler: G = 1/(L/Δt + R), I_h = G·(L/Δt)·i(n)
//   capacitor  trapezoidal: G = 2C/Δt, I_h = −(G·v(n) + i(n))
//              backward Euler: G = C/Δt, I_h = −G·v(n)
//   resistor   G = 1/R, no history
// with i(n+1) = G·v(n+1) + I_h for every branch (v = v_a − v_b, i flows a → b).
//
// For the 2 steps after any topology/parameter change the backward-Euler
// companions are used (critical damping adjustment), then trapezoidal again.

const RL = 0, CAP = 1, RES = 2;
const GND = { k: 'g', i: -1 };

export class Network {
  constructor(dt) {
    this.dt = dt;
    this.nodeNames = []; this.nodeIdx = new Map();
    this.srcNames = []; this.srcIdx = new Map();
    this.branches = []; this.byId = new Map();
    this.dirty = true;
    this.beLeft = 0;
    this.method = '';
    this.damping = true;      // set false only to demonstrate trapezoidal ringing
    this.v = null;            // node voltages {re: Float64Array, im: Float64Array}
    this.sRe = []; this.sIm = [];
  }

  // ---- topology --------------------------------------------------------------
  addNode(name) { this.nodeIdx.set(name, this.nodeNames.length); this.nodeNames.push(name); this.v = null; return this; }
  addSource(name) { this.srcIdx.set(name, this.srcNames.length); this.srcNames.push(name); this.sRe.push(0); this.sIm.push(0); return this; }

  _term(name) {
    if (name === 'gnd') return GND;
    if (this.nodeIdx.has(name)) return { k: 'n', i: this.nodeIdx.get(name) };
    if (this.srcIdx.has(name)) return { k: 's', i: this.srcIdx.get(name) };
    throw new Error(`network: unknown terminal '${name}'`);
  }

  _add(type, id, a, b, p, enabled) {
    if (this.byId.has(id)) throw new Error(`network: duplicate branch '${id}'`);
    const br = {
      id, type, a: this._term(a), b: this._term(b),
      R: p.R ?? 0, L: p.L ?? 0, C: p.C ?? 0, enabled,
      G: 0, iRe: 0, iIm: 0, vRe: 0, vIm: 0, hRe: 0, hIm: 0,
    };
    if (type === RL && br.R <= 0 && br.L <= 0) throw new Error(`network: RL branch '${id}' has zero impedance`);
    if (type === RES && !(br.R > 0)) throw new Error(`network: resistor '${id}' must have R > 0`);
    this.branches.push(br); this.byId.set(id, br); this.dirty = true;
    return this;
  }
  addRL(id, a, b, R, L, enabled = true) { return this._add(RL, id, a, b, { R, L }, enabled); }
  addC(id, a, b, C, enabled = true) { return this._add(CAP, id, a, b, { C }, enabled); }
  addR(id, a, b, R, enabled = true) { return this._add(RES, id, a, b, { R }, enabled); }

  _ensureState() {
    if (!this.v) {
      const n = this.nodeNames.length;
      this.v = { re: new Float64Array(n), im: new Float64Array(n) };
    }
  }

  _vRe(t) { return t.k === 'n' ? this.v.re[t.i] : t.k === 's' ? this.sRe[t.i] : 0; }
  _vIm(t) { return t.k === 'n' ? this.v.im[t.i] : t.k === 's' ? this.sIm[t.i] : 0; }

  _markChange() { this.dirty = true; if (this.damping) this.beLeft = 2; }

  /** Switch a branch in or out (fault, breaker, load). */
  setEnabled(id, on) {
    const br = this.branch(id);
    if (br.enabled === on) return;
    this._ensureState();
    br.enabled = on;
    br.iRe = 0; br.iIm = 0;
    br.vRe = this._vRe(br.a) - this._vRe(br.b);
    br.vIm = this._vIm(br.a) - this._vIm(br.b);
    this._markChange();
  }

  /** Change R/L/C of a branch. Inductor current and capacitor voltage are kept. */
  setParams(id, p) {
    const br = this.branch(id);
    if (p.R !== undefined) br.R = p.R;
    if (p.L !== undefined) br.L = p.L;
    if (p.C !== undefined) br.C = p.C;
    this._markChange();
  }

  branch(id) {
    const br = this.byId.get(id);
    if (!br) throw new Error(`network: unknown branch '${id}'`);
    return br;
  }

  setSource(name, z) { const i = this.srcIdx.get(name); this.sRe[i] = z.re; this.sIm[i] = z.im; }
  nodeV(name) { const i = this.nodeIdx.get(name); return { re: this.v.re[i], im: this.v.im[i] }; }
  branchI(id) { const br = this.branch(id); return { re: br.iRe, im: br.iIm }; }

  // ---- assembly ----------------------------------------------------------------
  /** Stamp admittances y(br) = [re, im] into a complex n×n matrix. */
  _assemble(yOf) {
    const n = this.nodeNames.length;
    const Are = new Float64Array(n * n), Aim = new Float64Array(n * n);
    for (const br of this.branches) {
      if (!br.enabled) continue;
      const [yr, yi] = yOf(br);
      const a = br.a, b = br.b;
      if (a.k === 'n') { Are[a.i * n + a.i] += yr; Aim[a.i * n + a.i] += yi; }
      if (b.k === 'n') { Are[b.i * n + b.i] += yr; Aim[b.i * n + b.i] += yi; }
      if (a.k === 'n' && b.k === 'n') {
        Are[a.i * n + b.i] -= yr; Aim[a.i * n + b.i] -= yi;
        Are[b.i * n + a.i] -= yr; Aim[b.i * n + a.i] -= yi;
      }
    }
    return { n, Are, Aim };
  }

  _build(method) {
    const dt = this.dt, trap = method === 'trap';
    for (const br of this.branches) {
      if (br.type === RL) br.G = 1 / ((trap ? 2 : 1) * br.L / dt + br.R);
      else if (br.type === CAP) br.G = (trap ? 2 : 1) * br.C / dt;
      else br.G = 1 / br.R;
    }
    this.lu = luFactor(this._assemble((br) => [br.G, 0]));
    this.method = method;
    this.dirty = false;
    const n = this.nodeNames.length;
    this.bRe = new Float64Array(n); this.bIm = new Float64Array(n);
  }

  // ---- time step ---------------------------------------------------------------
  /** Advance one step: source voltages must already hold their values at t(n+1). */
  step() {
    this._ensureState();
    const method = this.beLeft > 0 ? 'be' : 'trap';
    if (this.dirty || method !== this.method) this._build(method);
    const trap = method === 'trap', dt = this.dt;
    const bRe = this.bRe, bIm = this.bIm, sRe = this.sRe, sIm = this.sIm;
    bRe.fill(0); bIm.fill(0);

    for (const br of this.branches) {
      if (!br.enabled) continue;
      let hRe = 0, hIm = 0;
      if (br.type === RL) {
        if (trap) { const k = 2 * br.L / dt - br.R; hRe = br.G * (br.vRe + k * br.iRe); hIm = br.G * (br.vIm + k * br.iIm); }
        else { const k = br.G * br.L / dt; hRe = k * br.iRe; hIm = k * br.iIm; }
      } else if (br.type === CAP) {
        if (trap) { hRe = -(br.G * br.vRe + br.iRe); hIm = -(br.G * br.vIm + br.iIm); }
        else { hRe = -br.G * br.vRe; hIm = -br.G * br.vIm; }
      }
      br.hRe = hRe; br.hIm = hIm;
      const a = br.a, b = br.b, G = br.G;
      // KCL, current leaving node a: G(va − vb) + Ih ; leaving node b: G(vb − va) − Ih
      if (a.k === 'n') {
        bRe[a.i] -= hRe; bIm[a.i] -= hIm;
        if (b.k === 's') { bRe[a.i] += G * sRe[b.i]; bIm[a.i] += G * sIm[b.i]; }
      }
      if (b.k === 'n') {
        bRe[b.i] += hRe; bIm[b.i] += hIm;
        if (a.k === 's') { bRe[b.i] += G * sRe[a.i]; bIm[b.i] += G * sIm[a.i]; }
      }
    }

    luSolve(this.lu, bRe, bIm, this.v.re, this.v.im);

    for (const br of this.branches) {
      if (!br.enabled) continue;
      const vr = this._vRe(br.a) - this._vRe(br.b);
      const vi = this._vIm(br.a) - this._vIm(br.b);
      br.vRe = vr; br.vIm = vi;
      br.iRe = br.G * vr + br.hRe; br.iIm = br.G * vi + br.hIm;
    }
    if (this.beLeft > 0) this.beLeft--;
  }

  // ---- steady state ------------------------------------------------------------
  /**
   * Sinusoidal steady-state solve at angular frequency ω (rad/s) with the
   * present source voltages taken as phasors. Returns node voltages and branch
   * currents as complex values keyed by name.
   */
  phasorSolve(omega) {
    const yOf = (br) => {
      if (br.type === RL) { const zr = br.R, zi = omega * br.L, d = zr * zr + zi * zi; return [zr / d, -zi / d]; }
      if (br.type === CAP) return [0, omega * br.C];
      return [1 / br.R, 0];
    };
    const lu = luFactor(this._assemble(yOf));
    const n = this.nodeNames.length;
    const bRe = new Float64Array(n), bIm = new Float64Array(n);
    for (const br of this.branches) {
      if (!br.enabled) continue;
      const [yr, yi] = yOf(br);
      const a = br.a, b = br.b;
      if (a.k === 'n' && b.k === 's') { bRe[a.i] += yr * this.sRe[b.i] - yi * this.sIm[b.i]; bIm[a.i] += yr * this.sIm[b.i] + yi * this.sRe[b.i]; }
      if (b.k === 'n' && a.k === 's') { bRe[b.i] += yr * this.sRe[a.i] - yi * this.sIm[a.i]; bIm[b.i] += yr * this.sIm[a.i] + yi * this.sRe[a.i]; }
    }
    const xRe = new Float64Array(n), xIm = new Float64Array(n);
    luSolve(lu, bRe, bIm, xRe, xIm);
    const val = (t) => (t.k === 'n' ? { re: xRe[t.i], im: xIm[t.i] } : t.k === 's' ? { re: this.sRe[t.i], im: this.sIm[t.i] } : { re: 0, im: 0 });
    const v = {}, i = {};
    this.nodeNames.forEach((name, k) => { v[name] = { re: xRe[k], im: xIm[k] }; });
    for (const br of this.branches) {
      if (!br.enabled) { i[br.id] = { re: 0, im: 0 }; continue; }
      const va = val(br.a), vb = val(br.b);
      const dr = va.re - vb.re, di = va.im - vb.im;
      const [yr, yi] = yOf(br);
      i[br.id] = { re: yr * dr - yi * di, im: yr * di + yi * dr };
    }
    return { v, i };
  }

  /** Load a phasorSolve() result as the instantaneous αβ state (warm start). */
  setState(sol) {
    this._ensureState();
    this.nodeNames.forEach((name, k) => { this.v.re[k] = sol.v[name].re; this.v.im[k] = sol.v[name].im; });
    for (const br of this.branches) {
      br.vRe = this._vRe(br.a) - this._vRe(br.b);
      br.vIm = this._vIm(br.a) - this._vIm(br.b);
      br.iRe = br.enabled ? sol.i[br.id].re : 0;
      br.iIm = br.enabled ? sol.i[br.id].im : 0;
    }
  }
}

// ---- complex LU with partial pivoting -------------------------------------------
function luFactor({ n, Are, Aim }) {
  const piv = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    let p = k, best = -1;
    for (let r = k; r < n; r++) {
      const m = Are[r * n + k] ** 2 + Aim[r * n + k] ** 2;
      if (m > best) { best = m; p = r; }
    }
    if (!(best > 0)) throw new Error('network: singular nodal matrix (floating node?)');
    piv[k] = p;
    if (p !== k) {
      for (let c = 0; c < n; c++) {
        let t = Are[k * n + c]; Are[k * n + c] = Are[p * n + c]; Are[p * n + c] = t;
        t = Aim[k * n + c]; Aim[k * n + c] = Aim[p * n + c]; Aim[p * n + c] = t;
      }
    }
    const dr = Are[k * n + k], di = Aim[k * n + k], dd = dr * dr + di * di;
    for (let r = k + 1; r < n; r++) {
      const ar = Are[r * n + k], ai = Aim[r * n + k];
      const lr = (ar * dr + ai * di) / dd, li = (ai * dr - ar * di) / dd;
      Are[r * n + k] = lr; Aim[r * n + k] = li;
      for (let c = k + 1; c < n; c++) {
        const ur = Are[k * n + c], ui = Aim[k * n + c];
        Are[r * n + c] -= lr * ur - li * ui;
        Aim[r * n + c] -= lr * ui + li * ur;
      }
    }
  }
  return { n, Are, Aim, piv };
}

function luSolve({ n, Are, Aim, piv }, bRe, bIm, xRe, xIm) {
  for (let k = 0; k < n; k++) { xRe[k] = bRe[k]; xIm[k] = bIm[k]; }
  // whole rows (L part included) were swapped during factorisation, so PA = LU:
  // apply every swap to b first, then forward-substitute
  for (let k = 0; k < n; k++) {
    const p = piv[k];
    if (p !== k) {
      let t = xRe[k]; xRe[k] = xRe[p]; xRe[p] = t;
      t = xIm[k]; xIm[k] = xIm[p]; xIm[p] = t;
    }
  }
  for (let k = 0; k < n; k++) {
    for (let r = k + 1; r < n; r++) {
      const lr = Are[r * n + k], li = Aim[r * n + k];
      xRe[r] -= lr * xRe[k] - li * xIm[k];
      xIm[r] -= lr * xIm[k] + li * xRe[k];
    }
  }
  for (let k = n - 1; k >= 0; k--) {
    let sr = xRe[k], si = xIm[k];
    for (let c = k + 1; c < n; c++) {
      const ur = Are[k * n + c], ui = Aim[k * n + c];
      sr -= ur * xRe[c] - ui * xIm[c];
      si -= ur * xIm[c] + ui * xRe[c];
    }
    const dr = Are[k * n + k], di = Aim[k * n + k], dd = dr * dr + di * di;
    xRe[k] = (sr * dr + si * di) / dd;
    xIm[k] = (si * dr - sr * di) / dd;
  }
}
