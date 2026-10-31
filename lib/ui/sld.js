// SVG single-line diagram (SIM_SPEC §5.1): inverter — PCC — breaker — line
// (0–100 % scale, measured from the PCC) — grid source, with an animated fault
// marker. update() is a pure function of its inputs (pulse from sim time).
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const X0 = 300, X1 = 840;   // line extent in the viewBox

export class SLD {
  constructor(host, { gridLabel = 'Grid' } = {}) {
    const s = el('svg', { viewBox: '0 0 1000 150', role: 'img', 'aria-label': 'single-line diagram' }, host);
    const txt = { 'font-family': 'var(--font-ui)', 'font-size': 24, fill: 'var(--muted)', 'text-anchor': 'middle' };
    const stroke = { stroke: 'var(--ink)', 'stroke-width': 3, fill: 'none' };
    // inverter
    el('rect', { x: 40, y: 38, width: 110, height: 64, rx: 6, ...stroke }, s);
    el('line', { x1: 40, y1: 102, x2: 150, y2: 38, stroke: 'var(--ink)', 'stroke-width': 2 }, s);
    el('text', { x: 66, y: 64, 'font-size': 22, 'font-weight': 700, fill: 'var(--ink)', 'font-family': 'var(--font-ui)' }, s, '=');
    el('text', { x: 116, y: 94, 'font-size': 22, 'font-weight': 700, fill: 'var(--ink)', 'font-family': 'var(--font-ui)' }, s, '~');
    el('text', { x: 95, y: 138, ...txt }, s, 'Inverter');
    el('line', { x1: 150, y1: 70, x2: 220, y2: 70, ...stroke }, s);
    // PCC bus
    el('line', { x1: 220, y1: 34, x2: 220, y2: 106, stroke: 'var(--ink)', 'stroke-width': 7 }, s);
    el('text', { x: 220, y: 138, ...txt }, s, 'PCC');
    // breaker
    el('line', { x1: 220, y1: 70, x2: 250, y2: 70, ...stroke }, s);
    el('rect', { x: 250, y: 58, width: 24, height: 24, fill: 'var(--ink)' }, s);
    el('line', { x1: 274, y1: 70, x2: X0, y2: 70, ...stroke }, s);
    // line with scale
    el('line', { x1: X0, y1: 70, x2: X1, y2: 70, ...stroke }, s);
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const x = X0 + f * (X1 - X0);
      el('line', { x1: x, y1: 76, x2: x, y2: 86, stroke: 'var(--axis)', 'stroke-width': 2 }, s);
      el('text', { x, y: 108, ...txt, 'font-size': 22 }, s, `${f * 100}%`);
    }
    el('text', { x: (X0 + X1) / 2, y: 140, ...txt }, s, 'fault location from PCC');
    // grid source
    el('line', { x1: X1, y1: 70, x2: 880, y2: 70, ...stroke }, s);
    el('circle', { cx: 912, cy: 70, r: 32, ...stroke }, s);
    el('text', { x: 912, y: 79, 'font-size': 28, fill: 'var(--ink)', 'text-anchor': 'middle', 'font-family': 'var(--font-ui)' }, s, '~');
    el('text', { x: 912, y: 138, ...txt }, s, gridLabel);
    // fault marker
    this.fault = el('g', { visibility: 'hidden' }, s);
    this.halo = el('circle', { cx: 0, cy: 70, r: 18, fill: 'var(--limit)', opacity: 0.18 }, this.fault);
    this.bolt = el('text', { x: 0, y: 52, 'font-size': 40, 'text-anchor': 'middle' }, this.fault, '⚡');
    this.flabel = el('text', { x: 0, y: 18, ...txt, fill: 'var(--limit)', 'font-weight': 600 }, this.fault, '');
  }

  /** marker: { m, label } or null; active: fault applied; t: sim time (s) for the pulse. */
  update(marker, active, t) {
    if (!marker) { this.fault.setAttribute('visibility', 'hidden'); return; }
    const x = X0 + marker.m * (X1 - X0);
    this.fault.setAttribute('visibility', 'visible');
    this.fault.setAttribute('transform', `translate(${x.toFixed(1)},0)`);
    const pulse = active ? 0.5 + 0.5 * Math.sin(2 * Math.PI * 30 * Math.max(0, t)) : 0;   // 30 Hz in sim time
    this.halo.setAttribute('r', active ? (18 + 10 * pulse).toFixed(1) : '0');
    this.halo.setAttribute('opacity', active ? (0.15 + 0.2 * pulse).toFixed(2) : '0');
    this.fault.setAttribute('opacity', active ? '1' : '0.35');
    this.flabel.textContent = marker.label || '';
  }
}
