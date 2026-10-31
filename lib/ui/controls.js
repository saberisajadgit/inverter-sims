// Segmented buttons and parameter chips (SIM_SPEC §5.1 item 3).
// In render mode the buttons only reflect the active scenario.
export class Controls {
  /**
   * groups: { Model: ['Ideal', 'Realistic'], Fault: [...] }
   * onPick(group, value) is called on click (interactive only).
   */
  constructor(host, groups, onPick) {
    this.buttons = {};
    for (const [name, values] of Object.entries(groups)) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.innerHTML = `<span>${name}:</span>`;
      const opts = document.createElement('span');
      opts.className = 'opts';
      this.buttons[name] = {};
      for (const v of values) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = v;
        b.onclick = () => onPick && onPick(name, v);
        opts.appendChild(b);
        this.buttons[name][v] = b;
      }
      seg.appendChild(opts);
      host.appendChild(seg);
    }
    this.chips = document.createElement('div');
    this.chips.className = 'chips';
    host.appendChild(this.chips);
  }

  /** ui: { Model: 'Realistic', ... }; chips: { Xv: 0.15, ... }; changed: Set of chip keys to highlight. */
  update(ui, chips, changed = new Set()) {
    for (const [name, map] of Object.entries(this.buttons)) {
      for (const [v, b] of Object.entries(map)) b.classList.toggle('on', ui[name] === v);
    }
    const label = { Xv: 'Xv', K: 'K', mp: 'mp', limit: 'GFM limit' };
    const unit = { Xv: ' pu' };
    const html = Object.entries(chips || {}).map(([k, v]) => {
      const txt = `${label[k] || k} = ${typeof v === 'number' ? (k === 'K' ? v.toFixed(1) : k === 'Xv' ? v.toFixed(2) : v) : v}${unit[k] || ''}`;
      return changed.has(k) ? `<span class="changed">${txt}</span>` : txt;
    }).join(' · ');
    if (this.chips.innerHTML !== html) this.chips.innerHTML = html;
  }
}
