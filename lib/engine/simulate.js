// run(caseConfig) → TimeSeries (SIM_SPEC §4.9, §4.10).
//
// Network (§4.2):
//   e ──[Rf+jXf]── c (PCC) ──[m·Zg]── n (fault node) ──[(1−m)·Zg]── g
//                  │ Bc ‖ Rc_damp                │ R_fault (while active)
//                  │ optional load R_L + jX_L
// 'line1' (c–n) is the breaker side: removing it islands the inverter.
import { abs, arg, add, mul, div, conj, polar, rot, wrapPi } from './complex.js';
import { invClarke, PhasorEstimator } from './transforms.js';
import { Network } from './network.js';
import { GridSource } from './grid.js';
import { sortEvents, applyEvent, clipM, FAULT_R_DEFAULT } from './events.js';
import { GFLInverter, GFL_DEFAULTS } from './gfl.js';
import { GFMInverter, GFM_DEFAULTS } from './gfm.js';
import { MODES } from './modes.js';

export { MODES };

export const DEFAULTS = {
  fb: 60,
  dtNet: 10e-6,
  logDt: 1e-4,
  warm: 0.5,
  window: [-0.02, 0.1],
  grid: { SCR: 5, XR: 10, Vg: 1.0 },
  filter: { Xf: 0.15, Rf: 0.005, Bc: 0.05, RcDamp: 30 },
  // ffHz: dq LPF on the current loop's v_c feedforward. Raw sampled feedforward
  // through the 1.5·Ts delay oscillates (0.6–1 kHz) in weak grids, for the GFM
  // and for a GFL injecting K-factor Iq; see docs/ENGINE_NOTES.md.
  ctrl: { fctrl: 10000, delay: true, Imax: 1.2, Emax: 1.15, fc: 800, ffHz: 150 },
  network: { breaker: 'closed', faultM: 0.5, Vpcc: 1.0 },   // Vpcc: islanded initial |v_c|
  load: null,                                               // { R_L, X_L } series, at the PCC
  inverter: { type: 'GFL' },
  events: [],
  steadyTol: 0.01,
};

// ---- config helpers ----------------------------------------------------------------
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Deep merge; arrays and scalars in b replace those in a. Returns a new object. */
export function merge(a, b) {
  if (!isObj(b)) return b === undefined ? a : b;
  const out = isObj(a) ? { ...a } : {};
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : (isObj(v) ? merge({}, v) : v);
  return out;
}

export function resolveConfig(cfgIn = {}) {
  const cfg = merge(DEFAULTS, cfgIn);
  const type = (cfg.inverter.type || 'GFL').toUpperCase();
  const base = type === 'GFM' ? GFM_DEFAULTS : GFL_DEFAULTS;
  const islanded = cfg.network.breaker === 'open';
  const invDefaults = islanded && type === 'GFM' ? { ...base, P: 'auto', Q: 'auto' } : base;
  cfg.inverter = merge(invDefaults, { ...cfg.inverter, type });
  if (islanded && type === 'GFL') throw new Error('simulate: a GFL inverter cannot start islanded');
  return cfg;
}

const TOP_LEVEL = new Set(['fb', 'dtNet', 'logDt', 'warm', 'window', 'grid', 'filter', 'ctrl', 'network', 'load', 'events', 'steadyTol']);

/**
 * Build a run() config from an episode's scenarios.js (SIM_SPEC §11).
 * Merge order: common ← cases[i] ← scenario.overrides[case.id].
 * Override keys that name a top-level section (grid, ctrl, load, …) merge there;
 * anything else merges into the inverter.
 */
export function buildCase(ep, caseIndex, scenarioIndex = null) {
  const c = ep.cases[caseIndex];
  const { id, label, color, ...caseRest } = c;
  let cfg = merge(ep.common || {}, caseRest);
  if (ep.window) cfg.window = ep.window;
  const s = scenarioIndex == null ? null : ep.scenarios[scenarioIndex];
  if (s) {
    const ov = (s.overrides && s.overrides[id]) || {};
    const top = {}, inv = {};
    for (const [k, v] of Object.entries(ov)) (TOP_LEVEL.has(k) ? top : inv)[k] = v;
    cfg = merge(cfg, top);
    cfg.inverter = merge(cfg.inverter || {}, inv);
    if (s.window) cfg.window = s.window;
    cfg.events = s.events || [];
  }
  return cfg;
}

// ---- run -----------------------------------------------------------------------------
const LOG_FIELDS = [
  't', 'va', 'vb', 'vc', 'ia', 'ib', 'ic', 'Vmag', 'Imag', 'phi_deg', 'P', 'Q',
  'freqHz', 'pllFreqHz', 'delta_deg', 'VpRe', 'VpIm', 'IpRe', 'IpIm', 'Id', 'Iq',
  'IdRef', 'IqRef', 'Vf', 'Eint', 'vAngle_deg', 'VgMag', 'VgAng_deg',
];

export function run(cfgIn) {
  const cfg = resolveConfig(cfgIn);
  const fb = cfg.fb, wb = 2 * Math.PI * fb, dt = cfg.dtNet;
  const nCtrl = Math.max(1, Math.round(1 / (cfg.ctrl.fctrl * dt)));
  const Ts = nCtrl * dt;
  const [tw0, tw1] = cfg.window;
  const t0 = tw0 - cfg.warm;
  const nStart = Math.round(cfg.warm / dt);
  const nEnd = Math.round((tw1 - t0) / dt);
  const nLog = Math.max(1, Math.round(cfg.logDt / dt));
  const N = Math.floor((nEnd - nStart) / nLog) + 1;

  const events = sortEvents(cfg.events);
  const faults = events.filter((e) => e.type === 'fault');
  const mRaw = faults.length ? faults[0].m ?? cfg.network.faultM : cfg.network.faultM;
  const m = clipM(mRaw);
  if (faults.some((f) => f.m !== undefined && clipM(f.m) !== m)) throw new Error('simulate: gen 1 supports one fault location per case');

  // ---- network ----
  const { SCR, XR, Vg } = cfg.grid;
  const Zg = 1 / SCR;
  const Xg = (Zg * XR) / Math.sqrt(1 + XR * XR), Rg = Xg / XR;
  const { Xf, Rf, Bc, RcDamp } = cfg.filter;
  const breakerClosed = cfg.network.breaker !== 'open';
  const net = new Network(dt);
  net.addNode('c').addNode('n').addSource('e').addSource('g');
  net.addRL('filt', 'e', 'c', Rf, Xf / wb);
  if (Bc > 0) net.addC('cf', 'c', 'gnd', Bc / wb);
  if (RcDamp > 0 && Number.isFinite(RcDamp)) net.addR('rd', 'c', 'gnd', RcDamp);
  net.addRL('line1', 'c', 'n', m * Rg, (m * Xg) / wb, breakerClosed);
  net.addRL('line2', 'n', 'g', (1 - m) * Rg, ((1 - m) * Xg) / wb);
  net.addR('fault', 'n', 'gnd', FAULT_R_DEFAULT, false);
  const ld = cfg.load;
  const loadOn = !!ld && Number.isFinite(ld.R_L) && (ld.R_L > 0 || ld.X_L > 0);
  net.addRL('load', 'c', 'gnd', loadOn ? ld.R_L : 1, loadOn ? (ld.X_L || 0) / wb : 0, loadOn);

  // ---- steady-state initial conditions (grid angle 0, then rotated to t0) ----
  const invCfg = cfg.inverter;
  const Zf = { re: Rf, im: Xf };
  net.setSource('g', { re: Vg, im: 0 });
  let e, sol;
  if (breakerClosed) {
    // inverter delivers S* into the PCC: fixed point on e
    const S = invCfg.type === 'GFM' && (invCfg.P === 'auto' || invCfg.Q === 'auto')
      ? (() => { throw new Error('simulate: grid-connected GFM needs numeric P and Q'); })()
      : { re: invCfg.P, im: invCfg.Q };
    e = { re: Vg, im: 0 };
    for (let k = 0; k < 2000; k++) {
      net.setSource('e', e);
      sol = net.phasorSolve(wb);
      const vcp = sol.v.c;
      const iT = conj(div(S, vcp));
      const eNew = add(vcp, mul(Zf, iT));
      const d = abs({ re: eNew.re - e.re, im: eNew.im - e.im });
      e = eNew;
      if (d < 1e-13) break;
    }
    net.setSource('e', e);
    sol = net.phasorSolve(wb);
  } else {
    // islanded: choose e so that v_c = Vpcc∠0 (network is linear: v_c = a·e + b·v_g)
    net.setSource('e', { re: 0, im: 0 });
    const b = net.phasorSolve(wb).v.c;
    net.setSource('e', { re: 1, im: 0 });
    const a = { ...net.phasorSolve(wb).v.c };
    a.re -= b.re; a.im -= b.im;
    e = div({ re: cfg.network.Vpcc - b.re, im: -b.im }, a);
    net.setSource('e', e);
    sol = net.phasorSolve(wb);
  }

  const th0 = wb * t0;                 // θ_g(t0), so that θ_g(0) = 0
  const rotAll = (z) => rot(z, th0);
  for (const k of Object.keys(sol.v)) sol.v[k] = rotAll(sol.v[k]);
  for (const k of Object.keys(sol.i)) sol.i[k] = rotAll(sol.i[k]);
  e = rotAll(e);
  const vg0 = { re: Vg * Math.cos(th0), im: Vg * Math.sin(th0) };
  net.setSource('e', e);
  net.setSource('g', vg0);
  net.setState(sol);

  const grid = new GridSource({ fb, V: Vg, theta: th0 });
  const env = { fb, Ts, filter: cfg.filter, ctrl: cfg.ctrl };
  const inv = invCfg.type === 'GFM' ? new GFMInverter(invCfg, env) : new GFLInverter(invCfg, env);
  inv.init({ vc: sol.v.c, iF: sol.i.filt, e, thetaG: th0 });

  const delay = !!cfg.ctrl.delay;
  // ZOH (½ Ts) + one-sample transport delay (1 Ts): rotate the αβ command ahead
  // by the mean lag so the applied fundamental lands on the intended angle.
  const compSamples = delay ? 1.5 : 0.5;
  let ePrev = rot(e, wb * 0.5 * Ts);
  let eApplied = ePrev;

  const pe = { v: new PhasorEstimator(dt, fb), i: new PhasorEstimator(dt, fb) };
  pe.v.fill(rot(sol.v.c, -th0));
  pe.i.fill(rot(sol.i.filt, -th0));

  // ---- logs ----
  const L = {};
  for (const f of LOG_FIELDS) L[f] = new Float32Array(N);
  L.mode = new Uint8Array(N);
  const thetaRel = new Float64Array(N);   // θ_inv − θ_g, unwrapped later

  let steady = null;
  let evPtr = 0, tSample = t0, logK = 0;
  const ctx = { net, grid, inv, fb };

  function logAt(k, tk) {
    if (logK >= N) return;
    const j = logK++;
    const vcN = net.nodeV('c'), iN = net.branchI('filt');
    const [va, vb, vcc] = invClarke(vcN);
    const [ia, ib, ic] = invClarke(iN);
    const S = mul(vcN, conj(iN));
    const Vp = pe.v.value(), Ip = pe.i.value();
    L.t[j] = tw0 + (k - nStart) * dt;
    L.va[j] = va; L.vb[j] = vb; L.vc[j] = vcc;
    L.ia[j] = ia; L.ib[j] = ib; L.ic[j] = ic;
    L.Vmag[j] = abs(vcN); L.Imag[j] = abs(iN);
    L.P[j] = S.re; L.Q[j] = S.im;
    L.VpRe[j] = Vp.re; L.VpIm[j] = Vp.im; L.IpRe[j] = Ip.re; L.IpIm[j] = Ip.im;
    L.phi_deg[j] = abs(Ip) > 1e-4 && abs(Vp) > 1e-4 ? (wrapPi(arg(Ip) - arg(Vp)) * 180) / Math.PI : 0;
    L.freqHz[j] = fb * inv.omegaPu;
    L.pllFreqHz[j] = inv.pllFreqHz;
    L.Id[j] = inv.idq.re; L.Iq[j] = inv.idq.im;
    L.IdRef[j] = inv.idqRef.re; L.IqRef[j] = inv.idqRef.im;
    L.Vf[j] = inv.Vf ?? abs(vcN);
    L.Eint[j] = inv.E ?? NaN;
    L.vAngle_deg[j] = (Math.atan2(inv.vdq.im, inv.vdq.re) * 180) / Math.PI;
    L.VgMag[j] = grid.V;
    // grid source phasor angle in the estimator frame (rotating at ω_b): a reference when V_PCC ≈ 0
    L.VgAng_deg[j] = (wrapPi(grid.theta - wb * tk) * 180) / Math.PI;
    L.mode[j] = inv.mode;
    // inverter angle extrapolated from its last control sample to t_k
    const thInv = inv.frameTheta + wb * inv.omegaPu * (tk - tSample);
    thetaRel[j] = wrapPi(thInv - grid.theta);

    if (k === nStart) {
      const dP = S.re - inv.Pstar, dQ = S.im - inv.Qstar;
      const ok = Math.abs(dP) < cfg.steadyTol && Math.abs(dQ) < cfg.steadyTol;
      steady = { ok, P: S.re, Q: S.im, Pstar: inv.Pstar, Qstar: inv.Qstar, dP, dQ };
      if (!ok) console.warn(`simulate: not in steady state at window start (dP=${dP.toFixed(4)}, dQ=${dQ.toFixed(4)})`);
    }
  }
  if (nStart === 0) logAt(0, t0);

  for (let n = 0; n < nEnd; n++) {
    const t = t0 + n * dt;
    while (evPtr < events.length && events[evPtr].t <= t + dt * 0.5) applyEvent(events[evPtr++], ctx);

    if (n % nCtrl === 0) {
      const eCmd = inv.control({ vc: net.nodeV('c'), iF: net.branchI('filt'), thetaG: grid.theta, omegaG: grid.omega, t });
      const eRot = rot(eCmd, compSamples * wb * inv.omegaPu * Ts);
      if (delay) { eApplied = ePrev; ePrev = eRot; } else eApplied = eRot;
      tSample = t;
    }
    net.setSource('e', eApplied);
    grid.step(dt);
    net.setSource('g', grid.voltage());
    net.step();

    const k = n + 1;
    const tk = t0 + k * dt;
    pe.v.push(net.nodeV('c'), tk); pe.i.push(net.branchI('filt'), tk);
    if (k >= nStart && (k - nStart) % nLog === 0) logAt(k, tk);
  }

  // δ drift = (θ − θ_g) − (θ − θ_g)_pre-event, unwrapped, in degrees
  for (let j = 1; j < N; j++) {
    let d = thetaRel[j] - thetaRel[j - 1];
    d = wrapPi(d);
    thetaRel[j] = thetaRel[j - 1] + d;
  }
  const tEv = events.length ? events[0].t : 0;
  let jRef = 0;
  for (let j = 0; j < N; j++) if (L.t[j] < tEv - 1e-9) jRef = j;
  for (let j = 0; j < N; j++) L.delta_deg[j] = ((thetaRel[j] - thetaRel[jRef]) * 180) / Math.PI;

  return {
    ...L,
    n: N,
    meta: {
      fb, Ts, dt, type: invCfg.type,
      Imax: cfg.ctrl.Imax,
      window: cfg.window,
      modes: MODES,
      faultM: m,
      Zg: { R: Rg, X: Xg },
      events,
      steady,
      cfg,
    },
  };
}
