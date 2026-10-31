// Mono key/value readout table (SIM_SPEC §5.1).
export class Readout {
  /** rows: [{ key, label, extra? }] */
  constructor(host, rows) {
    this.table = document.createElement('table');
    this.table.className = 'readout';
    this.cells = {};
    for (const r of rows) {
      const tr = this.table.insertRow();
      if (r.extra) tr.className = 'extra';
      tr.insertCell().textContent = r.label;
      this.cells[r.key] = tr.insertCell();
    }
    host.appendChild(this.table);
  }

  set(values) {
    for (const [k, v] of Object.entries(values)) if (this.cells[k] && this.cells[k].textContent !== v) this.cells[k].textContent = v;
  }
}
