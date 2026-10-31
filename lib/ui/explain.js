// "What you see / Why / Takeaway" (SIM_SPEC §5.2): a panel in interactive
// mode, a lower-third caption card in render mode.
export class ExplainPanel {
  constructor(host) {
    host.classList.add('explain');
    host.innerHTML = ['What you see', 'Why', 'Takeaway'].map((h) => `<div><h4>${h}</h4><p></p></div>`).join('');
    this.p = [...host.querySelectorAll('p')];
    this.p.forEach((p) => { p.style.margin = '0'; });
  }

  update(ex = {}) {
    // authored episode text; may contain <sub> markup
    [ex.see, ex.why, ex.takeaway].forEach((txt, k) => { if (this.p[k].innerHTML !== (txt || '')) this.p[k].innerHTML = txt || ''; });
  }
}

export class Caption {
  constructor(host) {
    this.el = document.createElement('div');
    this.el.className = 'caption';
    this.el.style.opacity = '0';
    host.appendChild(this.el);
  }

  update(ex, alpha) {
    this.el.style.opacity = alpha.toFixed(3);
    this.el.style.visibility = alpha > 0 ? 'visible' : 'hidden';
    const html = ex ? `<div><span class="k">Why</span>${ex.why}</div><div class="tk"><span class="k">Takeaway</span>${ex.takeaway}</div>` : '';
    if (this.el.innerHTML !== html) this.el.innerHTML = html;
  }
}
