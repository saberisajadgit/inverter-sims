// Video timeline (SIM_SPEC §7.1): intro, one segment per scenario (cursor sweep
// + hold), outro. at() is a pure function of video time.
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const EASE = {
  linear: (x) => x,
  // slow through the first part of the window, then faster
  easeIn: (x) => x * x,
};

export class Timeline {
  constructor(tl, nScenarios, simWindow) {
    this.tl = { intro: 1.5, perScenario: 5, holdAtEnd: 1, outro: 2, captions: true, easing: 'linear', ...tl };
    this.n = nScenarios;
    this.win = simWindow;
    this.seg = this.tl.perScenario + this.tl.holdAtEnd;
    this.duration = this.tl.intro + this.n * this.seg + this.tl.outro;
  }

  /**
   * Returns { kind: 'intro'|'scenario'|'outro', i, simT, sweep (0..1), progress (0..1 of the segment),
   *           captionAlpha, overlayAlpha }.
   */
  at(v) {
    const { intro, perScenario, outro, captions, easing } = this.tl;
    const [w0, w1] = this.win;
    const fade = 0.4;
    if (v < intro) {
      return { kind: 'intro', i: 0, simT: w0, sweep: 0, progress: 0, captionAlpha: 0, overlayAlpha: clamp01((intro - v) / fade) };
    }
    const u = v - intro;
    const i = Math.floor(u / this.seg);
    if (i >= this.n) {
      const o = u - this.n * this.seg;
      return { kind: 'outro', i: this.n - 1, simT: w1, sweep: 1, progress: 1, captionAlpha: 0, overlayAlpha: clamp01(o / fade), outroT: Math.min(o, outro) };
    }
    const local = u - i * this.seg;
    const sweep = clamp01(local / perScenario);
    const simT = w0 + (EASE[easing] || EASE.linear)(sweep) * (w1 - w0);
    const capStart = 0.6 * this.seg;
    const captionAlpha = captions ? clamp01((local - capStart) / 0.3) : 0;
    return { kind: 'scenario', i, simT, sweep, progress: local / this.seg, captionAlpha, overlayAlpha: 0 };
  }

  /** Video time at which scenario i starts. */
  start(i) { return this.tl.intro + i * this.seg; }
}
