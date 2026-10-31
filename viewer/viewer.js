// Debug viewer for raw engine output. Not an episode page: no timeline, no
// render mode. Pick a preset (or edit the JSON), run, inspect the traces.
import { run, buildCase } from '../lib/engine/simulate.js';
import E02 from '../episodes/e02-gfl-vs-gfm-fault/scenarios.js';
import * as M from '../lib/engine/metrics.js';
import { MODES } from '../lib/engine/modes.js';

const fault = (m, R) => [{ t: 0, type: 'fault', m, ...(R ? { R } : {}) }];
const island = { network: { breaker: 'open' }, load: { R_L: 2, X_L: 0 }, events: [{ t: 0, type: 'loadStep', R_L: 1.25, X_L: 0 }] };

const PRESETS = [
  ['GFL · steady state P=0.5 Q=0.2', 'Should be flat: P = 0.5, Q = 0.2, balanced currents.',
    { inverter: { type: 'GFL', P: 0.5, Q: 0.2 } }],
  ['GFL · close-in bolted fault (realistic)', 'V_PCC ≈ 0 → PLL lost → BLOCKED, current → 0 within a few ms.',
    { inverter: { type: 'GFL', P: 0.5, Q: 0 }, events: fault(0.02) }],
  ['GFL · resistive mid fault (R=0.025)', 'V_PCC ≈ 0.37: K-factor Iq injection, clamped at 1.2 pu with Iq priority.',
    { inverter: { type: 'GFL', P: 0.5, Q: 0 }, events: fault(0.5, 0.025) }],
  ['GFL · far fault, ideal PLL', 'Non-realistic GFL (no blocking, oracle angle) during a far bolted fault.',
    { inverter: { type: 'GFL', P: 0.5, Q: 0, realistic: false, pll: { ideal: true } }, events: fault(0.98) }],
  ['GFL · sag to 0.6 pu', 'Iq ≈ −K·(0.9 − V). V_PCC settles near 0.69 because the injected Iq lifts it.',
    { inverter: { type: 'GFL', P: 0.5, Q: 0, K: 2 }, window: [-0.02, 0.3], events: [{ t: 0, type: 'sag', V: 0.6 }] }],
  ['GFL · 30° phase jump, SCR 10', 'PLL error (v angle) spikes to ~25°, back near 0 within 3 cycles.',
    { grid: { SCR: 10 }, inverter: { type: 'GFL', P: 0.5, Q: 0 }, window: [-0.02, 0.15], events: [{ t: 0, type: 'phaseJump', deg: 30 }] }],
  ['GFL · SCR 1.3, PLL 60 Hz (unstable)', 'Fast PLL on a very weak grid: a small 5° jump grows into loss of synchronism.',
    { grid: { SCR: 1.3 }, inverter: { type: 'GFL', P: 0.5, Q: 0, pll: { fn: 60 } }, window: [-0.02, 0.5], events: [{ t: 0, type: 'phaseJump', deg: 5 }] }],
  ['GFL · SCR 1.3, PLL 20 Hz (stable)', 'Same grid, slower PLL: the jump is absorbed.',
    { grid: { SCR: 1.3 }, inverter: { type: 'GFL', P: 0.5, Q: 0, pll: { fn: 20 } }, window: [-0.02, 0.5], events: [{ t: 0, type: 'phaseJump', deg: 5 }] }],
  ['GFM · close-in fault, circular limiter', 'Overshoot in the first ms, then held at 1.2 pu; δ drifts because P cannot be delivered.',
    { inverter: { type: 'GFM', P: 0.5, Q: 0 }, events: fault(0.02) }],
  ['GFM · close-in fault, voltage source (unlimited)', 'No limit: DC offset, first peak ~6 pu, settles ~3.4 pu.',
    { inverter: { type: 'GFM', P: 0.5, Q: 0, inner: 'voltageSource', limiter: 'none' }, window: [-0.02, 0.15], events: fault(0.02) }],
  ['GFM · far (remote) fault, Xv = 0.15', 'Remote fault = grid dips to 0.7 pu. Below the limit, current is set by the virtual impedance (~0.96 pu).',
    { inverter: { type: 'GFM', P: 0.5, Q: 0, Xv: 0.15 }, events: [{ t: 0, type: 'sag', V: 0.7 }] }],
  ['GFM · islanded droop, load +0.3 pu', 'Frequency drops by m_p·ΔP·f_b ≈ 0.85 Hz and settles.',
    { ...island, inverter: { type: 'GFM', outer: 'droop', mp: 0.05 }, window: [-0.02, 1.0] }],
  ['GFM · islanded VSM H=3, load +0.3 pu', 'Initial RoCoF ≈ ΔP/(2H)·f_b ≈ −2.8 Hz/s, then settles.',
    { ...island, inverter: { type: 'GFM', outer: 'vsm', H: 3, D: 20 }, window: [-0.02, 1.0] }],
];

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// E02 episode: every scenario × case, built exactly as the episode will run them
E02.scenarios.forEach((sc, si) => E02.cases.forEach((c, ci) => {
  PRESETS.push([`E02 ${si + 1}/${E02.scenarios.length} · ${sc.short} (${sc.ui.Model}) · ${c.id.toUpperCase()}`,
    `${sc.desc}. What you should see: ${sc.explain.see}`, buildCase(E02, ci, si), 'E02 · GFL vs GFM fault']);
}));

const groups = {};
PRESETS.forEach(([name, , , group = 'Engine checks'], i) => {
  if (!groups[group]) { groups[group] = document.createElement('optgroup'); groups[group].label = group; $('preset').append(groups[group]); }
  groups[group].append(new Option(name, i));
});
$('preset').onchange = () => loadPreset(+$('preset').value);
$('run').onclick = () => simulate();

function loadPreset(i) {
  const [, desc, cfg] = PRESETS[i];
  $('desc').textContent = desc;
  $('cfg').value = JSON.stringify(cfg, null, 2);
  simulate();
}

let TS = null, PLOTS = [];
// playback: traces are drawn only up to the cursor time CUR
let CUR = null, playing = false, raf = 0, wallStart = 0, curStart = 0;

function simulate() {
  let cfg;
  try { cfg = JSON.parse($('cfg').value); } catch (e) { $('status').textContent = 'JSON error: ' + e.message; return; }
  $('status').textContent = 'computing…';
  setTimeout(() => {
    try {
      const t0 = performance.now();
      TS = run(cfg);
      $('status').textContent = `ran in ${(performance.now() - t0).toFixed(0)} ms · ${TS.n} samples`;
      draw();
      CUR = TS.t[0];
      play();
    } catch (e) { $('status').textContent = 'error: ' + e.message; console.error(e); }
  }, 10);
}

// ---- plotting ---------------------------------------------------------------------
const PANELS = [
  { title: 'Inverter current (phases)', unit: 'pu', series: [['ia', '--a', 'i_a'], ['ib', '--b', 'i_b'], ['ic', '--c', 'i_c']], limits: true, sym: true },
  { title: 'PCC voltage (phases)', unit: 'pu', series: [['va', '--a', 'v_a'], ['vb', '--b', 'v_b'], ['vc', '--c', 'v_c']], sym: true },
  { title: 'Magnitudes', unit: 'pu', series: [['Imag', '#111827', '|i|'], ['Vmag', '#0f766e', '|v|'], ['Vf', '#0f766e', 'V filt', [4, 3]]], limits: true },
  { title: 'Power at PCC', unit: 'pu', series: [['P', '#2563eb', 'P'], ['Q', '#dc2626', 'Q (>0 inj.)']] },
  { title: 'Controller-frame current', unit: 'pu', series: [['Id', '#2563eb', 'Id'], ['IdRef', '#2563eb', 'Id*', [4, 3]], ['Iq', '#dc2626', 'Iq'], ['IqRef', '#dc2626', 'Iq*', [4, 3]]] },
  { title: 'Frequency', unit: 'Hz', series: [['freqHz', '#7c3aed', 'f (ctrl)'], ['pllFreqHz', '#d4a017', 'PLL f', [4, 3]]] },
  { title: 'Angles', unit: '°', series: [['delta_deg', '#111827', 'δ drift'], ['vAngle_deg', '#dc2626', 'v angle in ctrl frame (PLL err)']] },
];

function draw() {
  const host = $('plots');
  host.innerHTML = '';
  PLOTS = [];
  for (const p of PANELS) {
    const series = p.series.filter(([k]) => TS[k].some((x) => Number.isFinite(x)));
    if (!series.length) continue;
    const div = document.createElement('div');
    div.className = 'plot';
    div.innerHTML = `<div class="ttl">${p.title} <span>[${p.unit}]</span>${series.map(([, c, l, d]) =>
      `<span><i class="sw" style="background:${c.startsWith('--') ? css(c) : c};${d ? 'opacity:.6' : ''}"></i>${l}</span>`).join('')}</div>`;
    const cv = document.createElement('canvas');
    div.appendChild(cv); host.appendChild(div);
    PLOTS.push({ cv, p, series });
  }
  const div = document.createElement('div');
  div.className = 'plot';
  div.innerHTML = '<div class="ttl">Controller mode</div>';
  const cv = document.createElement('canvas'); cv.id = 'modes';
  div.appendChild(cv); host.appendChild(div);
  PLOTS.push({ cv, modes: true });
  renderAll(null);
  numbers();
}

function renderAll(marker) { for (const pl of PLOTS) render(pl, marker); }

// ---- playback ---------------------------------------------------------------------
function play() {
  if (!TS) return;
  if (CUR >= TS.t[TS.n - 1]) CUR = TS.t[0];
  playing = true;
  wallStart = performance.now(); curStart = CUR;
  $('play').textContent = '❚❚ Pause';
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  cancelAnimationFrame(raf);
  $('play').textContent = '▶ Play';
}

function tick(now) {
  const t0 = TS.t[0], t1 = TS.t[TS.n - 1];
  const rate = (t1 - t0) / +$('sweep').value;          // sim seconds per wall second
  CUR = Math.min(t1, curStart + ((now - wallStart) / 1000) * rate);
  renderAll(CUR);
  showValues(CUR);
  if (CUR < t1) raf = requestAnimationFrame(tick); else pause();
}

$('play').onclick = () => (playing ? pause() : play());
$('all').onclick = () => { pause(); CUR = TS.t[TS.n - 1]; renderAll(null); };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); playing ? pause() : play(); }
});

function faultBands() {
  const bands = []; let on = null;
  for (const ev of TS.meta.events) {
    if ((ev.type === 'fault' || (ev.type === 'sag' && ev.V < 1)) && on === null) on = ev.t;
    if (ev.type === 'clear' && on !== null) { bands.push([on, ev.t]); on = null; }
  }
  if (on !== null) bands.push([on, Infinity]);
  return bands;
}

const L = 48, R = 8, T = 6, B = 18;

function render(pl, hoverT) {
  const { cv } = pl;
  const jC = CUR == null ? TS.n - 1 : M.idxAt(TS, CUR);   // last sample revealed
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const t = TS.t, n = TS.n, t0 = t[0], t1 = t[n - 1];
  const X = (x) => L + ((x - t0) / (t1 - t0)) * (W - L - R);
  g.font = '11px system-ui'; g.fillStyle = css('--muted');

  const tC = t[jC];
  for (const [a, b] of faultBands()) {
    if (a > tC) continue;
    g.fillStyle = css('--fault');
    g.fillRect(X(Math.max(a, t0)), T, X(Math.min(b, tC)) - X(Math.max(a, t0)), H - T - B);
  }

  if (pl.modes) {
    let j0 = 0;
    for (let j = 1; j <= jC + 1; j++) {
      if (j === jC + 1 || TS.mode[j] !== TS.mode[j0]) {
        const m = MODES[TS.mode[j0]];
        g.fillStyle = m.tone === 'ok' ? '#bbf7d0' : m.tone === 'warn' ? '#fed7aa' : '#fecaca';
        const x0 = X(t[j0]), x1 = X(t[Math.min(j, jC)]);
        g.fillRect(x0, T, Math.max(1, x1 - x0), H - T - 4);
        g.fillStyle = css('--ink');
        const lbl = m.label.replace('{peak}', M.maxOf(TS, 'Imag').toFixed(2));
        if (x1 - x0 > g.measureText(lbl).width + 6) g.fillText(lbl, x0 + 4, T + 16);
        j0 = j;
      }
    }
    if (hoverT != null) { g.strokeStyle = '#111'; g.beginPath(); g.moveTo(X(hoverT), T); g.lineTo(X(hoverT), H - 4); g.stroke(); }
    return;
  }

  let lo = Infinity, hi = -Infinity;
  for (const [k] of pl.series) for (let j = 0; j < n; j++) { const v = TS[k][j]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (pl.p.limits) { hi = Math.max(hi, TS.meta.Imax * 1.05); if (pl.p.sym) lo = Math.min(lo, -TS.meta.Imax * 1.05); }
  if (pl.p.sym) { const m = Math.max(Math.abs(lo), Math.abs(hi), 1.2); lo = -m; hi = m; }
  if (hi - lo < 1e-3) { const c = (hi + lo) / 2; lo = c - 0.5; hi = c + 0.5; }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const Y = (y) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);

  // grid + ticks
  g.strokeStyle = css('--grid'); g.lineWidth = 1; g.fillStyle = css('--muted');
  for (const y of niceTicks(lo, hi, 5)) {
    g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(W - R, Y(y)); g.stroke();
    g.fillText(fmt(y), 4, Y(y) + 4);
  }
  for (const x of niceTicks(t0 * 1e3, t1 * 1e3, 8)) {
    g.beginPath(); g.moveTo(X(x / 1e3), T); g.lineTo(X(x / 1e3), H - B); g.stroke();
    g.fillText(fmt(x) + ' ms', X(x / 1e3) - 12, H - 4);
  }
  if (pl.p.limits) {
    g.strokeStyle = '#dc2626'; g.setLineDash([5, 4]); g.lineWidth = 1.5;
    for (const y of pl.p.sym ? [TS.meta.Imax, -TS.meta.Imax] : [TS.meta.Imax]) { g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(W - R, Y(y)); g.stroke(); }
    g.setLineDash([]);
  }
  for (const [k, c, , dash] of pl.series) {
    g.strokeStyle = c.startsWith('--') ? css(c) : c;
    g.globalAlpha = dash ? 0.7 : 1;
    g.setLineDash(dash || []); g.lineWidth = dash ? 1.5 : 1.8;
    g.beginPath();
    let pen = false;
    for (let j = 0; j <= jC; j++) {
      const v = TS[k][j];
      if (!Number.isFinite(v)) { pen = false; continue; }
      pen ? g.lineTo(X(t[j]), Y(v)) : g.moveTo(X(t[j]), Y(v)); pen = true;
    }
    g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  }
  if (hoverT != null) { g.strokeStyle = '#111'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(hoverT), T); g.lineTo(X(hoverT), H - B); g.stroke(); }
}

function niceTicks(a, b, count) {
  a = Math.round(a * 1e6) / 1e6; b = Math.round(b * 1e6) / 1e6;   // Float32 times: −19.9999 → −20
  const span = b - a, step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return out;
}
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : +v.toFixed(2)).toString();

// ---- hover ------------------------------------------------------------------------
function showValues(t) {
  const j = M.idxAt(TS, t);
  const ph = M.phasorAt(TS, t);
  $('hover').textContent = `t = ${(TS.t[j] * 1e3).toFixed(2)} ms · |V| ${ph.V.toFixed(3)} · |I| ${ph.I.toFixed(3)} · φ ${ph.phi.toFixed(1)}° · P ${TS.P[j].toFixed(3)} · Q ${TS.Q[j].toFixed(3)} · Id ${TS.Id[j].toFixed(3)} · Iq ${TS.Iq[j].toFixed(3)} · f ${TS.freqHz[j].toFixed(3)} Hz · δ ${TS.delta_deg[j].toFixed(1)}° · ${MODES[TS.mode[j]].label}`;
  return TS.t[j];
}

function plotTime(e) {
  const cv = e.target.closest('canvas');
  if (!cv || !TS) return null;
  const r = cv.getBoundingClientRect();
  const frac = (e.clientX - r.left - L) / (r.width - L - R);
  if (frac < 0 || frac > 1) return null;
  return TS.t[0] + frac * (TS.t[TS.n - 1] - TS.t[0]);
}

// hover reads values (only inside the revealed part); click moves the cursor there
$('plots').addEventListener('mousemove', (e) => {
  if (playing) return;
  const t = plotTime(e);
  if (t == null || (CUR != null && t > CUR)) return;
  renderAll(showValues(t));
});
$('plots').addEventListener('click', (e) => {
  const t = plotTime(e);
  if (t == null) return;
  pause();
  CUR = t;
  renderAll(showValues(t));
});
window.addEventListener('resize', () => { if (TS) renderAll(playing ? CUR : null); });

// ---- key numbers ------------------------------------------------------------------
function numbers() {
  const ts = TS, end = ts.t[ts.n - 1], s = ts.meta.steady;
  const pEnd = M.phasorAt(ts, end), pPre = M.phasorAt(ts, Math.min(-0.001, end));
  const rows = [
    ['inverter', ts.meta.type],
    ['steady at start', s ? `<span class="${s.ok ? 'ok' : 'bad'}">${s.ok ? 'yes' : 'NO'} (ΔP ${s.dP.toExponential(1)}, ΔQ ${s.dQ.toExponential(1)})</span>` : '—'],
    ['pre-event |V| / |I|', `${pPre.V.toFixed(3)} / ${pPre.I.toFixed(3)}`],
    ['first peak (1 cycle)', M.firstPeak(ts).toFixed(3)],
    ['max |i| after t=0', M.maxOf(ts, 'Imag', 0, end).toFixed(3)],
    ['end |V| / |I|', `${pEnd.V.toFixed(3)} / ${pEnd.I.toFixed(3)}`],
    ['end φ', `${pEnd.phi.toFixed(1)}°`],
    ['end P / Q', `${M.at(ts, 'P', end).toFixed(3)} / ${M.at(ts, 'Q', end).toFixed(3)}`],
    ['end f', `${M.at(ts, 'freqHz', end).toFixed(3)} Hz`],
    ['end δ drift', `${M.at(ts, 'delta_deg', end).toFixed(1)}°`],
    ['modes after t=0', M.modesVisited(ts, 0, end).join(' → ')],
  ];
  $('nums').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

loadPreset(0);
