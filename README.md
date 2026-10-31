# Inverter concept simulator

Interactive, browser-based simulations of grid-following (GFL) and grid-forming (GFM) inverter behaviour, built on an averaged EMT engine. They also render to video.

**Live:** open `index.html` on the deployed site, or go straight to the episode:

- **E02 · GFL vs GFM fault response.** 8 scenarios covering close-in, mid-line and remote faults. Scrub through time, read phasors, P and Q, and export CSV.
- **Engine viewer.** Raw traces for any preset or a hand-edited config.

Simulation by **Sam Saberi**: [linkedin.com/in/saberisam](https://www.linkedin.com/in/saberisam/)

## The model

- Averaged EMT in the αβ frame, with a trapezoidal companion-model nodal solver (EMTP style) and backward-Euler damping steps after switching.
- 10 kHz digital control with a one-sample delay; SRF-PLL; dq current loops with decoupling, anti-windup and a modulation limit.
- GFL: K-factor ride-through, Iq/Id priority current limiting, PLL-loss blocking, P ramp recovery.
- GFM: P–f / Q–V droop or VSM, dynamic virtual impedance, circular or adaptive current limiting.
- Per-unit with an amplitude-invariant Clarke transform. Q > 0 means the inverter injects reactive power; φ = arg(I) − arg(V).

Every claim shown in a scenario is backed by an automated check (`npm test`, 26 tests): network solver accuracy, DC offset against IEC κ, PLL tracking, K-factor, droop and VSM physics, and each scenario's expected numbers. Design decisions and deviations from the spec are documented in [`docs/ENGINE_NOTES.md`](docs/ENGINE_NOTES.md).

Results are illustrative, not vendor-specific.

## Run locally

```
npm install          # only needed to render videos (Playwright)
npm run serve        # http://localhost:5173/
npm test
```

Render a video, with the server running and ffmpeg on PATH:

```
node tools/render.mjs episodes/e02-gfl-vs-gfm-fault output/e02_linkedin.mp4 linkedin --final
node tools/render.mjs episodes/e02-gfl-vs-gfm-fault output/e02_s6.mp4 linkedin --final --only 6
```
