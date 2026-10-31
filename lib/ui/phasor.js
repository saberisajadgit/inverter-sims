// SVG phasor dial (SIM_SPEC §5.1): V_PCC is the reference (pointing right),
// I is drawn at φ = arg(I) − arg(V). Positive φ is counter-clockwise (up).
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

export class PhasorDial {
  constructor(host) {
    const s = el('svg', { viewBox: '-100 -100 200 228', role: 'img', 'aria-label': 'phasor dial' }, host);
    el('circle', { cx: 0, cy: 0, r: 90, fill: 'none', stroke: 'var(--panel-border)', 'stroke-width': 1.5 }, s);
    el('circle', { cx: 0, cy: 0, r: 45, fill: 'none', stroke: 'var(--grid)', 'stroke-width': 1.5 }, s);
    el('line', { x1: -90, y1: 0, x2: 90, y2: 0, stroke: 'var(--grid)', 'stroke-width': 1.5 }, s);
    el('line', { x1: 0, y1: -90, x2: 0, y2: 90, stroke: 'var(--grid)', 'stroke-width': 1.5 }, s);
    const defs = el('defs', {}, s);
    for (const [id, c] of [['ah-v', 'var(--ink)'], ['ah-i', 'var(--phase-a)']]) {
      const m = el('marker', { id: id + this.uid(), viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', fill: c }, m);
      this[id] = m.id;
    }
    this.v = el('line', { x1: 0, y1: 0, stroke: 'var(--ink)', 'stroke-width': 5, 'marker-end': `url(#${this['ah-v']})` }, s);
    this.i = el('line', { x1: 0, y1: 0, stroke: 'var(--phase-a)', 'stroke-width': 5, 'marker-end': `url(#${this['ah-i']})` }, s);
    this.vl = el('text', { 'font-size': 24, 'font-weight': 700, fill: 'var(--ink)', 'font-family': 'var(--font-ui)' }, s);
    this.il = el('text', { 'font-size': 24, 'font-weight': 700, fill: 'var(--phase-a)', 'font-family': 'var(--font-ui)' }, s);
    this.vl.textContent = 'V'; this.il.textContent = 'I';
    this.cap = el('text', { x: 0, y: 120, 'text-anchor': 'middle', 'font-size': 22, fill: 'var(--muted)', 'font-family': 'var(--font-mono)' }, s);
  }

  uid() { PhasorDial.n = (PhasorDial.n || 0) + 1; return PhasorDial.n; }

  /** V, I magnitudes (pu), φ in degrees (null = undefined), scale = magnitude at the outer ring. */
  update(V, I, phiDeg, scale) {
    const MIN = 10;   // shorter arrows are hidden (an arrowhead alone reads as a real vector)
    const r = (x) => Math.min(88, (x / scale) * 88);
    const rv = r(V), ri = r(I), ph = ((phiDeg ?? 0) * Math.PI) / 180;
    const show = (line, label, len, ang, on, dy = 0) => {
      line.setAttribute('visibility', on ? 'visible' : 'hidden');
      label.setAttribute('visibility', on ? 'visible' : 'hidden');
      const x = len * Math.cos(ang), y = -len * Math.sin(ang);
      line.setAttribute('x2', x.toFixed(2)); line.setAttribute('y2', y.toFixed(2));
      label.setAttribute('x', (x + 12 * Math.cos(ang) - 6).toFixed(2));
      label.setAttribute('y', (y - 12 * Math.sin(ang) + 7 + dy).toFixed(2));
    };
    // V is the reference: whenever φ is defined, draw it at a readable minimum length
    show(this.v, this.vl, phiDeg != null ? Math.max(rv, 24) : rv, 0, phiDeg != null || rv >= MIN);
    // nudge the I label off the V label when the two arrows nearly overlap
    const near = phiDeg != null && Math.abs(phiDeg) < 25;
    show(this.i, this.il, ri, phiDeg == null ? 0 : ph, ri >= MIN && phiDeg != null, near ? (phiDeg < 0 ? 16 : -16) : 0);
    const parts = [];
    if (phiDeg == null && rv < MIN) parts.push('V ≈ 0');
    parts.push(phiDeg == null ? 'φ —' : `φ ${phiDeg >= 0 ? '+' : '−'}${Math.abs(phiDeg).toFixed(0)}°`);
    this.cap.textContent = parts.join(' · ');
  }
}
