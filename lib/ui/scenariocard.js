// "n / N · short · description · progress · t = …" card (SIM_SPEC §5.1 item 2).
export class ScenarioCard {
  constructor(host) {
    host.classList.add('card', 'scen');
    host.innerHTML = '<span class="num"></span><span class="title"></span><span class="time"></span><div class="bar"><i></i></div>';
    this.num = host.querySelector('.num');
    this.title = host.querySelector('.title');
    this.time = host.querySelector('.time');
    this.bar = host.querySelector('.bar i');
  }

  update({ i, n, short, desc, tSim, progress }) {
    const num = `${i + 1} / ${n}`;
    if (this.num.textContent !== num) this.num.textContent = num;
    const html = `<b>${short}</b> · ${desc}`;
    if (this.title.innerHTML !== html) this.title.innerHTML = html;
    const ms = tSim * 1000;
    this.time.textContent = `t = ${ms >= 0 ? '+' : '−'}${Math.abs(ms).toFixed(1)} ms`;
    this.bar.style.width = `${(Math.max(0, Math.min(1, progress)) * 100).toFixed(2)}%`;
  }
}
