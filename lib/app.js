// Bootstraps an episode page (SIM_SPEC §5, §7.2): runs every scenario × case,
// builds the layout, wires the UI and exposes window.SIM.
//
//   interactive: buttons, keyboard, playback, CSV export
//   ?render=1&w=&h=: fixed pixel size, no animation loop; renderAt(videoTime)
//                    draws a complete frame synchronously.
import { run, buildCase } from './engine/simulate.js';
import { MODES } from './engine/modes.js';
import { WavePlot, niceCeil } from './ui/plot.js';
import { PhasorDial } from './ui/phasor.js';
import { SLD } from './ui/sld.js';
import { Readout } from './ui/readout.js';
import { Controls } from './ui/controls.js';
import { ScenarioCard } from './ui/scenariocard.js';
import { ExplainPanel, Caption } from './ui/explain.js';
import { Timeline } from './ui/timeline.js';

const h = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

// a credit still holding the template placeholder is not shown
const creditOf = (ep) => (ep.credit && !/<[^>]*>/.test(ep.credit) ? ep.credit : '');
const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FOOTNOTE = 'Peak per-unit; phasors and readouts at the cursor. Sign convention: Q > 0 = inverter injects reactive power (i<sub>q</sub> < 0); φ = arg(I) − arg(V<sub>PCC</sub>), φ < 0 = current lags = injecting Q.';

export async function boot() {
  const q = new URLSearchParams(location.search);
  const RENDER = q.get('render') === '1';
  const W = +q.get('w') || 1080, H = +q.get('h') || 1350;
  const root = document.documentElement;

  const SIM = (window.SIM = { ready: false, videoDuration: 0, scenarios: [] });

  const ep = await (await fetch(new URL('episode.json', location.href))).json();
  const S = (await import(new URL('scenarios.js', location.href).href)).default;
  const layout = RENDER ? (W > H ? 'landscape169' : ep.layout || 'portrait45') : 'interactive-stack';
  root.classList.add(RENDER ? 'render' : 'interactive', `layout-${layout}`);
  if (RENDER) root.setAttribute('data-theme', 'light');
  document.title = ep.title;

  // ---- layout -----------------------------------------------------------------
  const page = h('div', 'page', document.body);
  if (RENDER) { Object.assign(document.body.style, { width: W + 'px', height: H + 'px', overflow: 'hidden' }); Object.assign(page.style, { width: W + 'px', height: H + 'px' }); }
  h('header', 'hdr', page, `<h1>${ep.title}</h1><p class="sub">${ep.subtitle}</p><div class="rule"></div>`);
  const status = RENDER ? null : h('div', 'status', page, 'computing…');
  const card = new ScenarioCard(h('section', null, page));
  const ctlHost = h('section', 'controls', page);
  const groups = {};
  for (const sc of S.scenarios) for (const [g, v] of Object.entries(sc.ui || {})) { groups[g] ||= []; if (!groups[g].includes(v)) groups[g].push(v); }
  const controls = new Controls(ctlHost, groups, RENDER ? null : (g, v) => pickByUi(g, v));

  let toolbar = null;
  if (!RENDER) {
    toolbar = h('div', 'toolbar', page);
    toolbar.innerHTML = `<button data-a="prev">◀ Prev</button><button data-a="play" class="primary">❚❚ Pause</button><button data-a="restart">Restart</button><button data-a="next">Next ▶</button><button data-a="csv">Export CSV</button><span class="hint">Space play/pause · ←/→ 1 ms · 1–${Math.min(9, S.scenarios.length)} scenario · R restart · drag on a plot to scrub</span>`;
  }

  const sldCard = h('section', 'card sld', page);
  const sld = new SLD(sldCard, { gridLabel: `Grid · SCR ${S.common?.grid?.SCR ?? 5}` });
  h('div', 'legend', sldCard,
    `<span><i style="border-color:var(--phase-a)"></i>Phase A</span><span><i style="border-color:var(--phase-b)"></i>Phase B</span><span><i style="border-color:var(--phase-c)"></i>Phase C</span>` +
    `<span><i class="dash" style="border-color:var(--vref)"></i>V<sub>PCC</sub> phase A</span><span><i class="dash" style="border-color:var(--limit)"></i>Current limit ±${(S.common?.ctrl?.Imax ?? 1.2).toFixed(1)} pu</span>`);

  const panelsHost = h('section', 'panels', page);
  const panels = S.cases.map((c) => {
    const p = h('div', 'panel', panelsHost);
    const hd = h('div', 'panel-hd', p);
    h('span', 'lbl', hd, c.label).style.color = c.color;
    const pill = h('span', 'pill ok', hd, 'NORMAL');
    const body = h('div', 'panel-body', p);
    const cv = h('canvas', null, h('div', 'plotwrap', body));
    const plot = new WavePlot(cv, {
      series: [
        { key: 'ia', color: '--phase-a' }, { key: 'ib', color: '--phase-b' }, { key: 'ic', color: '--phase-c' },
        { key: 'va', color: '--vref', width: 2, dash: [6, 5] },
      ],
    });
    const dial = new PhasorDial(h('div', 'dial', body));
    const isGFM = (c.inverter?.type || '').toUpperCase() === 'GFM';
    const readout = new Readout(h('div', null, body), [
      { key: 'V', label: '|V PCC|' }, { key: 'I', label: '|I|' }, { key: 'phi', label: 'φ (I vs V)' },
      { key: 'P', label: 'P' }, { key: 'Q', label: 'Q' },
      { key: 'pk', label: 'peak i', extra: true },
      isGFM ? { key: 'd', label: 'δ drift' } : { key: 'f', label: 'PLL f' },
    ]);
    return { c, pill, plot, dial, readout, cv, isGFM };
  });

  const explain = RENDER ? null : new ExplainPanel(h('section', null, page));
  h('footer', 'foot', page, `<div>${FOOTNOTE}</div><div class="credit">${esc(creditOf(ep))}</div>`);
  const caption = RENDER ? new Caption(page) : null;
  const overlay = RENDER ? h('div', 'overlay', page) : null;

  // ---- simulate everything ------------------------------------------------------
  await new Promise((r) => setTimeout(r, 0));   // let "computing…" paint
  const t0c = performance.now();
  const R = S.scenarios.map((sc, si) => S.cases.map((c, ci) => prepare(run(buildCase(S, ci, si)))));
  const scenInfo = S.scenarios.map((sc, si) => {
    const runs = R[si];
    let maxAbs = 1.5, maxI = 1.2;
    for (const r of runs) { maxAbs = Math.max(maxAbs, r.maxAbs * 1.05); maxI = Math.max(maxI, r.maxIph); }
    const yMax = Math.min(4, niceCeil(maxAbs));
    const tEv = sc.events?.length ? Math.min(...sc.events.map((e) => e.t)) : 0;
    return { yMax, dialScale: niceCeil(maxI * 1.05), bands: bandsOf(sc.events || []), tEv };
  });
  runsDone(performance.now() - t0c);

  const ref = S.scenarios[0].chips || {};
  const changedChips = S.scenarios.map((sc) => new Set(Object.keys(sc.chips || {}).filter((k) => sc.chips[k] !== ref[k])));
  // ?only=N renders a single scenario (1-based) as its own short video
  const only = RENDER && q.get('only') ? Math.max(0, Math.min(S.scenarios.length - 1, +q.get('only') - 1)) : null;
  const timeline = only == null
    ? new Timeline(ep.timeline, S.scenarios.length, S.window || [-0.02, 0.1])
    : new Timeline({ ...ep.timeline, ...ep.singleTimeline }, 1, S.window || [-0.02, 0.1]);

  SIM.videoDuration = timeline.duration;
  SIM.scenarios = S.scenarios.map(({ id, short, desc, ui, explain: ex }) => ({ id, short, desc, ui, explain: ex }));

  // ---- one frame --------------------------------------------------------------------
  let curS = -1;
  function frame(si, simT, { progress = 0, captionAlpha = 0 } = {}) {
    const sc = S.scenarios[si], info = scenInfo[si];
    if (si !== curS) {
      curS = si;
      panels.forEach((p, ci) => {
        const r = R[si][ci];
        p.plot.setData(r.ts, { yMax: info.yMax, limit: r.ts.meta.Imax, bands: info.bands, clipPeak: r.peak.v > info.yMax ? r.peak : null });
      });
      explain && explain.update(sc.explain);
    }
    card.update({ i: si, n: S.scenarios.length, short: sc.short, desc: sc.desc, tSim: simT, progress });
    controls.update(sc.ui || {}, sc.chips || {}, changedChips[si]);
    sld.update(sc.marker || null, simT >= info.tEv, simT - info.tEv);
    panels.forEach((p, ci) => {
      const r = R[si][ci], ts = r.ts;
      const j = idxAt(ts, simT);
      p.plot.draw(simT);
      const m = pillMode(ts, j);
      const label = m.label.replace('{peak}', r.peakSince[j].toFixed(2));
      if (p.pill.textContent !== label) p.pill.textContent = label;
      p.pill.className = `pill ${m.tone}`;
      const V = Math.hypot(ts.VpRe[j], ts.VpIm[j]), I = Math.hypot(ts.IpRe[j], ts.IpIm[j]);
      const phi = ts.phi_deg[j];
      const valid = V > 0.05 && I > 0.02;   // below ~0.05 pu the voltage angle is meaningless
      p.dial.update(V, I, valid ? phi : null, info.dialScale);
      p.readout.set({
        V: V.toFixed(3), I: I.toFixed(3),
        phi: valid ? `${phi >= 0 ? '+' : '−'}${Math.abs(phi).toFixed(1)}°` : '—',
        P: signed(ts.P[j]), Q: signed(ts.Q[j]),
        pk: ts.t[j] >= 0 ? r.peakSince[j].toFixed(2) : '—',
        d: `${signed(ts.delta_deg[j], 1)}°`,
        f: `${ts.pllFreqHz[j].toFixed(2)} Hz`,
      });
    });
    caption && caption.update(sc.explain, captionAlpha);
  }

  // ---- render mode ---------------------------------------------------------------------
  function overlayFor(st) {
    if (!overlay) return;
    overlay.style.opacity = st.overlayAlpha.toFixed(3);
    overlay.style.visibility = st.overlayAlpha > 0 ? 'visible' : 'hidden';
    const kind = st.kind === 'intro' ? 'intro' : st.kind === 'outro' ? 'outro' : overlay.dataset.kind;
    if (overlay.dataset.kind === kind) return;
    overlay.dataset.kind = kind;
    const credit = [esc(creditOf(ep)), ep.interactiveNote].filter(Boolean).join(' · ');
    if (only != null) {
      const sc = S.scenarios[only];
      overlay.innerHTML = kind === 'intro'
        ? `<div class="meta">${ep.title} · scenario ${only + 1} of ${S.scenarios.length}</div><h2>${sc.short}</h2><div class="hook">${sc.desc.charAt(0).toUpperCase() + sc.desc.slice(1)}.</div><div class="meta">${ep.subtitle}</div>`
        : `<h2>Takeaway</h2><div class="hook">${sc.explain.takeaway}</div><div class="credit">${credit}</div>`;
    } else {
      overlay.innerHTML = kind === 'intro'
        ? `<h2>${ep.title}</h2><div class="hook">${ep.hook || ''}</div><div class="meta">${ep.subtitle}</div>`
        : `<h2>Takeaways</h2><ul>${(ep.outro || []).map((l) => `<li>${l}</li>`).join('')}</ul><div class="credit">${credit}</div>`;
    }
  }

  // keep the plots and readouts visible: portrait covers the single-line
  // diagram; landscape uses the free space under the left column
  function placeCaption() {
    const cs = caption.el.style;
    if (layout === 'landscape169') {
      const foot = page.querySelector('.foot');
      Object.assign(cs, { left: '40px', right: 'auto', width: '700px', top: foot.offsetTop + foot.offsetHeight + 24 + 'px', minHeight: '220px' });
    } else {
      Object.assign(cs, { top: sldCard.offsetTop + 'px', minHeight: sldCard.offsetHeight + 'px' });
    }
  }

  SIM.renderAt = (v) => {
    const st = timeline.at(v);
    if (only != null) st.i = only;
    frame(st.i, st.simT, st);
    placeCaption();
    overlayFor(st);
  };

  // ---- interactive -------------------------------------------------------------------
  let si0 = Math.max(0, Math.min(S.scenarios.length - 1, (+q.get('scenario') || 1) - 1));
  const play = { si: si0, simT: S.window[0], playing: false, wall0: 0, sim0: 0, raf: 0 };
  const span = S.window[1] - S.window[0];
  const sweepSec = ep.timeline?.perScenario ?? 5;

  function show() { frame(play.si, play.simT, { progress: (play.simT - S.window[0]) / span }); }
  function tick(now) {
    play.simT = Math.min(S.window[1], play.sim0 + ((now - play.wall0) / 1000) * (span / sweepSec));
    show();
    if (play.simT < S.window[1]) play.raf = requestAnimationFrame(tick); else setPlaying(false);
  }
  function setPlaying(on) {
    play.playing = on;
    cancelAnimationFrame(play.raf);
    if (toolbar) toolbar.querySelector('[data-a="play"]').textContent = on ? '❚❚ Pause' : '▶ Play';
    if (on) {
      if (play.simT >= S.window[1]) play.simT = S.window[0];
      play.wall0 = performance.now(); play.sim0 = play.simT;
      play.raf = requestAnimationFrame(tick);
    }
  }
  function setScenario(i) {
    play.si = (i + S.scenarios.length) % S.scenarios.length;
    play.simT = S.window[0];
    const u = new URL(location.href); u.searchParams.set('scenario', play.si + 1); history.replaceState(null, '', u);
    show();
    setPlaying(true);
  }
  function pickByUi(group, value) {
    const cur = { ...(S.scenarios[play.si].ui || {}), [group]: value };
    let k = S.scenarios.findIndex((sc) => Object.entries(cur).every(([g, v]) => sc.ui?.[g] === v));
    if (k < 0) k = S.scenarios.findIndex((sc) => sc.ui?.[group] === value);
    if (k >= 0) setScenario(k);
  }
  function setSimTime(t) { setPlaying(false); play.simT = Math.max(S.window[0], Math.min(S.window[1], t)); show(); }

  SIM.setScenario = setScenario;
  SIM.setSimTime = setSimTime;
  SIM.exportCSV = (ci = 0) => exportCSV(R[play.si][ci].ts, `${S.scenarios[play.si].id}_${S.cases[ci].id}.csv`);

  if (!RENDER) {
    toolbar.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'play') setPlaying(!play.playing);
      if (a === 'restart') setScenario(play.si);
      if (a === 'prev') setScenario(play.si - 1);
      if (a === 'next') setScenario(play.si + 1);
      if (a === 'csv') S.cases.forEach((c, ci) => SIM.exportCSV(ci));
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select')) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!play.playing); }
      else if (e.key === 'ArrowLeft') setSimTime(play.simT - 0.001);
      else if (e.key === 'ArrowRight') setSimTime(play.simT + 0.001);
      else if (e.key === 'r' || e.key === 'R') setScenario(play.si);
      else if (/^[1-9]$/.test(e.key) && +e.key <= S.scenarios.length) setScenario(+e.key - 1);
    });
    for (const p of panels) {
      const scrub = (e) => { const r = p.cv.getBoundingClientRect(); const t = p.plot.timeAtX(e.clientX - r.left); if (t != null) setSimTime(t); };
      p.cv.addEventListener('pointerdown', (e) => { p.cv.setPointerCapture(e.pointerId); scrub(e); });
      p.cv.addEventListener('pointermove', (e) => { if (e.buttons) scrub(e); });
    }
    window.addEventListener('resize', show);
  }

  await document.fonts.ready;
  if (RENDER) SIM.renderAt(+q.get('t') || 0);   // ?t= opens at a video time (snapshots)
  else setScenario(play.si);
  SIM.ready = true;

  function runsDone(ms) {
    if (status) status.textContent = `${S.scenarios.length * S.cases.length} simulations computed in ${ms.toFixed(0)} ms · averaged EMT model · SCR ${S.common?.grid?.SCR ?? 5} · I_max ${S.common?.ctrl?.Imax ?? 1.2} pu`;
  }
}

// ---- helpers ------------------------------------------------------------------------------
function prepare(ts) {
  const n = ts.n;
  const peakSince = new Float32Array(n);
  let pk = 0, maxAbs = 0, maxIph = 0, peak = { t: 0, v: 0 };
  for (let j = 0; j < n; j++) {
    const a = Math.max(Math.abs(ts.ia[j]), Math.abs(ts.ib[j]), Math.abs(ts.ic[j]));
    maxAbs = Math.max(maxAbs, a, Math.abs(ts.va[j]));
    if (ts.t[j] >= 0) { if (a > pk) { pk = a; peak = { t: ts.t[j], v: a }; } }
    peakSince[j] = pk;
    maxIph = Math.max(maxIph, Math.hypot(ts.IpRe[j], ts.IpIm[j]));
  }
  return { ts, peakSince, maxAbs, maxIph, peak };
}

function bandsOf(events) {
  const out = []; let on = null;
  for (const ev of [...events].sort((a, b) => a.t - b.t)) {
    if ((ev.type === 'fault' || (ev.type === 'sag' && ev.V < 1)) && on === null) on = ev.t;
    if ((ev.type === 'clear' || (ev.type === 'sag' && ev.V >= 1)) && on !== null) { out.push([on, ev.t]); on = null; }
  }
  if (on !== null) out.push([on, Infinity]);
  return out;
}

function idxAt(ts, t) {
  const tt = ts.t;
  let lo = 0, hi = ts.n - 1;
  if (t <= tt[0]) return 0;
  if (t >= tt[hi]) return hi;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tt[mid] <= t + 1e-9) lo = mid; else hi = mid; }
  return lo;
}

/** Pill mode, debounced: most frequent mode over the last 2 ms (ties → the newest). */
function pillMode(ts, j) {
  const n = Math.max(1, Math.round(0.002 / (ts.t[1] - ts.t[0])));
  const count = new Map();
  let best = ts.mode[j], bestN = 0;
  for (let k = j; k > j - n && k >= 0; k--) {
    const m = ts.mode[k], c = (count.get(m) || 0) + 1;
    count.set(m, c);
    if (c > bestN) { bestN = c; best = m; }
  }
  return MODES[best];
}

const signed = (x, d = 3) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;

function exportCSV(ts, name) {
  const cols = ['t', 'ia', 'ib', 'ic', 'va', 'vb', 'vc', 'P', 'Q', 'Id', 'Iq', 'freqHz', 'delta_deg'];
  const lines = [cols.join(',') + ',mode'];
  for (let j = 0; j < ts.n; j++) lines.push(cols.map((c) => +ts[c][j].toPrecision(6)).join(',') + ',' + MODES[ts.mode[j]].key);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
