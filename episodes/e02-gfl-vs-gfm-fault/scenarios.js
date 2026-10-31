// E02 — GFL vs GFM: 3-phase fault response (SIM_SPEC §10, §11).
//
// Fault definitions (see docs/ENGINE_NOTES.md, "E02 fault definitions"):
//   Close-in  bolted fault at m = 0.02
//   Mid       bolted fault at m = 0.5
//   Far       remote fault, modelled as a dip of the grid source to 0.7 pu
//             (no phase jump). A bolted fault anywhere on this SCR-5 tie line
//             collapses V_PCC below 0.2 pu and pins the GFM at I_max, so it
//             cannot show the X_v effect; a shallow remote dip can.
// The Model toggle only changes the GFL: Ideal = oracle angle, no blocking;
// Realistic = SRF-PLL with blocking below V_block. The GFM has no PLL, so it
// is the same in both.

const close = [{ t: 0, type: 'fault', m: 0.02, R: 0.005 }];
const mid = [{ t: 0, type: 'fault', m: 0.5, R: 0.005 }];
const far = [{ t: 0, type: 'sag', V: 0.7 }];

const IDEAL = { gfl: { realistic: false, pll: { ideal: true } } };
const REAL = { gfl: { realistic: true } };

export default {
  window: [-0.020, 0.100],
  common: {
    fb: 60,
    grid: { SCR: 5, XR: 10, Vg: 1.0 },
    filter: { Xf: 0.15, Rf: 0.005, Bc: 0.05, RcDamp: 30 },
    ctrl: { fctrl: 10000, delay: true, Imax: 1.2, Emax: 1.15 },
  },
  cases: [
    { id: 'gfl', label: 'GRID-FOLLOWING', color: 'var(--gfl)', inverter: { type: 'GFL', P: 0.5, Q: 0, K: 2, Vblock: 0.15, pll: { fn: 20, zeta: 0.707 } } },
    { id: 'gfm', label: 'GRID-FORMING', color: 'var(--gfm)', inverter: { type: 'GFM', P: 0.5, Q: 0, outer: 'droop', mp: 0.05, nq: 0.05, inner: 'viCurrentRef', Xv: 0.15, Rv: 0.02, limiter: 'circular' } },
  ],
  scenarios: [
    {
      id: 'close-ideal',
      short: 'Close-in',
      desc: 'ideal: both inverters clamp at the 1.2 pu current limit',
      ui: { Model: 'Ideal', Fault: 'Close-in' },
      chips: { Xv: 0.15, K: 2.0, mp: '5 %' },
      marker: { m: 0.02 },
      overrides: IDEAL,
      events: close,
      explain: {
        see: 'Both currents rise to the dashed 1.2 pu limit and stay there.',
        why: 'With a perfect angle reference the GFL keeps injecting K-factor Iq; the GFM limiter caps its current.',
        takeaway: 'On paper both contribute the same fault current: the limit.',
      },
      expect: {
        gfl: { IendRange: [1.14, 1.22], modeAtMs: [50, 'CL_IQ'] },
        gfm: { IendRange: [1.14, 1.22], modeAtMs: [50, 'CL'] },
      },
    },
    {
      id: 'close-realistic',
      short: 'Close-in',
      desc: 'realistic: GFL blocks (PLL lost at V ≈ 0); GFM overshoots, then is held at 1.2 pu',
      ui: { Model: 'Realistic', Fault: 'Close-in' },
      chips: { Xv: 0.15, K: 2.0, mp: '5 %' },
      marker: { m: 0.02 },
      overrides: REAL,
      events: close,
      explain: {
        see: 'GFL current collapses within half a cycle; GFM spikes in the first cycle, then sits at 1.2 pu.',
        why: 'With V_PCC ≈ 0 the PLL has no angle and the GFL blocks; the GFM is a voltage source until its limiter acts.',
        takeaway: 'Close to the inverter, only the GFM keeps contributing fault current.',
      },
      expect: {
        gfl: { IafterMs: [20, 0, 0.05], modeAtMs: [8, 'BLOCKED'] },   // half a cycle = 8.3 ms
        gfm: { firstPeakMin: 1.3, IendRange: [1.14, 1.22], deltaEndAbsMin: 30 },
      },
    },
    {
      id: 'close-unlimited',
      short: 'Close-in · no limit',
      desc: 'GFM as a plain voltage source with no current limit: why limiters exist',
      ui: { Model: 'Realistic', Fault: 'Close-in' },
      chips: { Xv: 0.15, K: 2.0, mp: '5 %' },
      marker: { m: 0.02 },
      overrides: { ...REAL, gfm: { inner: 'voltageSource', limiter: 'none' } },
      events: close,
      explain: {
        see: 'GFM current jumps to several pu with a DC offset; the GFL still blocks.',
        why: 'A voltage source behind X_v + X_f ≈ 0.3 pu drives about 1/0.3 ≈ 3.4 pu into a bolted fault.',
        takeaway: 'Real GFMs must limit current; the limiter, not X_v, then sets the close-in contribution.',
      },
      expect: {
        gfl: { IafterMs: [20, 0, 0.05] },
        gfm: { firstPeakMin: 5, IendRange: [3.0, 3.8], modeAtMs: [50, 'VS_UNLIMITED'] },   // peak ≫ steady ⇒ DC offset
      },
    },
    {
      id: 'mid-ideal',
      short: 'Mid-line',
      desc: 'ideal: GFL injects reactive current at the limit; GFM limited',
      ui: { Model: 'Ideal', Fault: 'Mid' },
      chips: { Xv: 0.15, K: 2.0, mp: '5 %' },
      marker: { m: 0.5 },
      overrides: IDEAL,
      events: mid,
      explain: {
        see: 'Both currents settle at 1.2 pu; the GFL current is almost purely reactive.',
        why: 'V_PCC falls to ~0.1 pu, so K·(0.9 − V) asks for more than I_max and Iq priority gives it all to Iq.',
        takeaway: 'An ideal GFL is a well-behaved reactive current source, if it can keep its angle.',
      },
      expect: {
        gfl: { IendRange: [1.14, 1.22], IqEndRange: [-1.22, -1.1], modeAtMs: [50, 'CL_IQ'] },
        gfm: { IendRange: [1.14, 1.22] },
      },
    },
    {
      id: 'mid-realistic',
      short: 'Mid-line',
      desc: 'realistic: on an SCR-5 tie line the PCC still collapses, so the GFL blocks again',
      ui: { Model: 'Realistic', Fault: 'Mid' },
      chips: { Xv: 0.15, K: 2.0, mp: '5 %' },
      marker: { m: 0.5 },
      overrides: REAL,
      events: mid,
      explain: {
        see: 'GFL injects briefly, then blocks; GFM current overshoots in the first cycle, then holds 1.2 pu.',
        why: 'The inverter alone cannot hold up V_PCC through half the line: V_PCC ≈ 0.05 pu < V_block.',
        takeaway: 'A bolted fault anywhere near a weak-grid inverter looks "close-in" to the PLL.',
      },
      expect: {
        gfl: { firstPeakMin: 1.0, IafterMs: [20, 0, 0.05], modeAtMs: [20, 'BLOCKED'] },
        gfm: { firstPeakMin: 1.3, IendRange: [1.14, 1.22], deltaEndAbsMin: 30 },
      },
    },
    {
      id: 'far',
      short: 'Far',
      desc: 'remote fault (grid dips to 0.7 pu): GFL K-factor injection; GFM current set by Xv = 0.15',
      ui: { Model: 'Realistic', Fault: 'Far' },
      chips: { Xv: 0.15, K: 2.0, mp: '5 %' },
      marker: { m: 0.98, label: 'remote fault' },
      overrides: REAL,
      events: far,
      explain: {
        see: 'GFL injects ~0.7 pu; GFM touches the limit for a few ms, then settles near 0.96 pu.',
        why: 'GFL: Iq = K·(0.9 − V). GFM: below the limit its current is (E − v)/Z_v, a voltage source behind X_v.',
        takeaway: 'For shallow dips the GFM contribution is set by its virtual impedance and arrives within the first cycle.',
      },
      expect: {
        gfl: { IendRange: [0.6, 0.8], modeAtMs: [50, 'KFACTOR'] },
        gfm: { IendRange: [0.9, 1.02], modeAtMs: [50, 'NORMAL'], modeVisited: 'CL' },
      },
    },
    {
      id: 'far-xv10',
      short: 'Far · Xv 0.10',
      desc: 'same remote fault, smaller virtual impedance Xv = 0.10 pu: more GFM current',
      ui: { Model: 'Realistic', Fault: 'Far' },
      chips: { Xv: 0.10, K: 2.0, mp: '5 %' },
      marker: { m: 0.98, label: 'remote fault' },
      overrides: { ...REAL, gfm: { Xv: 0.10 } },
      events: far,
      explain: {
        see: 'GFM current settles higher, about 1.05 pu; the GFL is unchanged.',
        why: 'A smaller X_v makes the GFM a stiffer voltage source: more current for the same voltage dip.',
        takeaway: 'X_v is the GFM designer’s knob for fault contribution below the limit.',
      },
      expect: {
        gfl: { IendRange: [0.6, 0.8] },
        gfm: { IendRange: [1.0, 1.12], modeAtMs: [50, 'NORMAL'] },
      },
    },
    {
      id: 'far-xv20',
      short: 'Far · Xv 0.20',
      desc: 'same remote fault, larger virtual impedance Xv = 0.20 pu: less GFM current',
      ui: { Model: 'Realistic', Fault: 'Far' },
      chips: { Xv: 0.20, K: 2.0, mp: '5 %' },
      marker: { m: 0.98, label: 'remote fault' },
      overrides: { ...REAL, gfm: { Xv: 0.20 } },
      events: far,
      explain: {
        see: 'GFM current settles lower, about 0.9 pu.',
        why: 'A larger X_v softens the voltage source, so the same dip drives less current.',
        takeaway: 'GFL contribution is set by PLL and grid-code settings; GFM contribution by X_v and its limiter.',
      },
      expect: {
        gfl: { IendRange: [0.6, 0.8] },
        gfm: { IendRange: [0.84, 0.95], modeAtMs: [50, 'NORMAL'] },
      },
    },
  ],
  // claims that compare scenarios
  expectAcross: [
    { what: 'Far-fault GFM current decreases with X_v', case: 'gfm', scenarios: ['far-xv10', 'far', 'far-xv20'], metric: 'Iend', order: 'decreasing', minStep: 0.03 },
  ],
};
