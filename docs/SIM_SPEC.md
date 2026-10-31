# Inverter & BESS Concept Simulator — Build Spec

A specification for generating **interactive HTML simulations** that explain power-electronic grid concepts (GFL, GFM, droop, PLL, ride-through, BESS) and that can be **rendered frame-by-frame into LinkedIn/YouTube videos**.

---

## 0. Setup (Windows 11)
1. Install Node.js LTS (≥ 20), ffmpeg (on PATH), and Git.
2. Clone the repository and run `npm install` (only needed for video rendering).
3. `npm run serve`, then open `http://localhost:5173/`.
4. `npm test` runs the physics and episode checks.

---

## 1. Goals and non-goals

### Goals
1. **Understanding first.** Every page must make one concept *visibly obvious*: what changes, why, and what the takeaway is.
2. **Physically credible.** Models are averaged EMT (electromagnetic transient) models with real controller structures. A power-electronics engineer watching the video should not find a wrong sign, a wrong order of magnitude, or a missing physical effect (such as DC offset at fault inception or PLL loss of lock at near-zero voltage).
3. **Two modes from one page.**
   - **Interactive mode:** sliders, buttons, hover readouts, CSV export. A learning tool.
   - **Render mode** (`?render=1`): deterministic, driven frame-by-frame by a script, output to MP4.
4. **Consistent visual identity** across all episodes (a series look).
5. **Reusable engine.** New episodes are mostly a `scenarios.js` file plus some layout.

### Non-goals (generation 1)
- No switching-level (PWM ripple) models. These are averaged models only, with an optional control delay.
- No unbalanced faults in gen 1. The αβ complex solver assumes balanced conditions (see §4.9 for the gen-2 abc upgrade).
- No protection relays, transformer saturation, or detailed DC-link or battery models in gen 1 (DC link and battery come in gen 2, §10).
- No claim of grid-code compliance. Grid-code curves are labelled **"illustrative — verify against the current standard"**.

---

## 2. Repository layout

```
sims/
├─ docs/
│  └─ SIM_SPEC.md                # this file
├─ lib/
│  ├─ engine/                    # pure JS ES modules, NO DOM access (runs in Node and in the browser)
│  │  ├─ complex.js              # tiny complex-number helpers (add, mul, div, exp(jθ), abs, arg)
│  │  ├─ transforms.js           # Clarke/Park, abc<->αβ<->dq, moving-average phasor estimator
│  │  ├─ network.js              # EMTP-style trapezoidal nodal solver (§4.3)
│  │  ├─ pll.js                  # SRF-PLL (§4.5)
│  │  ├─ currentloop.js          # dq PI current controller with decoupling, saturation, anti-windup (§4.6)
│  │  ├─ gfl.js                  # grid-following inverter (§4.7)
│  │  ├─ gfm.js                  # grid-forming inverter: droop, VSM, virtual impedance, limiters (§4.8)
│  │  ├─ grid.js                 # grid source + events (sag, phase jump, freq ramp) (§4.4)
│  │  ├─ events.js               # fault apply/clear, breaker open, setpoint steps
│  │  ├─ simulate.js             # run(caseConfig) -> TimeSeries (warm-up, logging, decimation)
│  │  └─ metrics.js              # first peak, settling, P/Q, δ drift, mode log
│  ├─ ui/
│  │  ├─ theme.css               # design tokens (§6)
│  │  ├─ fonts/                  # local woff2 (Inter, JetBrains Mono) for deterministic rendering
│  │  ├─ plot.js                 # canvas waveform plot with progressive reveal + cursor
│  │  ├─ phasor.js               # SVG phasor dial
│  │  ├─ sld.js                  # SVG single-line diagram with animated fault marker
│  │  ├─ readout.js              # mono key/value table
│  │  ├─ controls.js             # segmented buttons, sliders, keyboard shortcuts
│  │  ├─ scenariocard.js         # "n/N · description · progress · t = …" card
│  │  ├─ explain.js              # "What you see / Why / Takeaway" panel and caption cards
│  │  └─ timeline.js             # video timeline: intro, scenarios, holds, outro (§7)
│  └─ app.js                     # bootstraps a page: loads scenarios, runs sims, wires UI, exposes window.SIM
├─ episodes/
│  ├─ e01-gfl-anatomy/
│  │  ├─ index.html
│  │  ├─ scenarios.js
│  │  └─ episode.json            # title, subtitle, credit, layout, timeline settings
│  ├─ e02-gfl-vs-gfm-fault/
│  ├─ e03-gfm-droop-islanded/
│  └─ e04-ride-through-kfactor/
├─ tools/
│  ├─ serve.mjs                  # static server on :5173 (ES modules need http://, not file://)
│  ├─ render.mjs                 # Playwright -> ffmpeg (§8)
│  ├─ build-single.mjs           # bundle an episode into ONE self-contained HTML (esbuild) for sharing
│  └─ snap.mjs                   # screenshot at given times (layout self-check)
├─ test/
│  ├─ engine.test.mjs            # node --test; physics sanity checks (§9)
│  └─ episodes.test.mjs          # each episode's expected numbers
└─ output/                       # mp4, png, single-file html
```

**Rule:** `lib/engine/*` must never touch `window`, `document`, `Date.now`, or unseeded `Math.random`. That is what lets the same code run in Node tests and in the browser deterministically.

---

## 3. Per-unit and sign conventions (must be followed everywhere)

- Nominal frequency `f_b` is configurable per episode: **60 Hz default** (North America), 50 Hz optional. ω_b = 2π f_b.
- **Amplitude-invariant Clarke transform.** The space vector magnitude equals the phase **peak** value.
  - x_α = (2/3)(x_a − ½x_b − ½x_c), x_β = (2/3)(√3/2)(x_b − x_c)
  - Inverse: x_a = x_α, x_b = −½x_α + (√3/2)x_β, x_c = −½x_α − (√3/2)x_β
- **Bases:** V_base = rated phase-voltage peak, I_base = rated phase-current peak, S_base = (3/2)·V_base·I_base, Z_base = V_base/I_base.
- With these bases: **S = P + jQ = v · conj(i)** directly in pu (no 3/2 factor).
- All waveform plots are **peak-per-unit**: 1.0 = rated peak.
- Reactances are in pu at ω_b. In differential equations, inductance L = X/ω_b and capacitance C = B/ω_b (time in seconds).
- Rotating complex vector: x_αβ = x_α + j x_β. Park transform into a frame at angle θ: x_dq = x_αβ · e^(−jθ).
- **Reactive sign.** Q > 0 means the inverter **injects** reactive power (capacitive, voltage-supporting). With the d axis aligned to v (v_q = 0): P = v_d i_d and Q = −v_d i_q. So voltage support means **i_q < 0**. Document this on every page that shows Q or Iq.
- **Phasor angle φ** = arg(I) − arg(V_PCC). Negative φ means the current lags the voltage, which means the inverter is injecting reactive power. Print this convention as a footnote on every page with a phasor dial.

---

## 4. Physics engine

### 4.1 Model fidelity level
These are **averaged EMT models in the αβ frame**:
- The inverter is an ideal controllable voltage source `e`, optionally with a one-control-period transport delay and a modulation (voltage) limit.
- The network uses lumped R, L and C.
- Control is digital: sampled at `f_ctrl` (default 10 kHz) with zero-order hold.
- Network step: `dt_net` (default 10 µs). Control runs every `round(1/(f_ctrl·dt_net))` network steps.

### 4.2 Default network topology (gen 1)

```
 inverter e ──[Rf + jXf]──●── PCC (v_c) ──[m·(Rg + jXg)]──●── fault node (v_n) ──[(1−m)·(Rg + jXg)]── v_g (grid source)
                          │                               │
                       [Bc ‖ Rc_damp]                  [R_fault]  (only while fault active)
                          │                               │
                         gnd                             gnd
                          │
                     [optional local load R_L + jX_L]
```

- Grid impedance from SCR and X/R: |Z_g| = 1/SCR (pu on the inverter rating). X_g = |Z_g|·(X/R)/√(1+(X/R)²) and R_g = X_g/(X/R).
- Fault location `m ∈ [0.02, 0.98]`. "Close-in" = 0.02, "Mid" = 0.5, "Far" = 0.98. Clip to that range to avoid zero-length branches.
- An optional breaker between the PCC and the line represents **islanded** operation (the grid branch is removed).
- Default parameters: Xf = 0.15, Rf = 0.005, Bc = 0.05, Rc_damp = 30 (parallel damping), SCR = 5, X/R = 10, R_fault = 0.005 (bolted). All values in pu.

### 4.3 Network solver: trapezoidal companion models and nodal analysis
**Do not integrate the network with explicit RK4.** Small fault resistances and small reactances make it stiff. Use the EMTP method:

Because the system is balanced and the network is linear with real R, L and C, the α and β networks are identical. Solve **one complex nodal system** where every voltage and current is the complex αβ value.

Companion models (Δt = dt_net):
- **Series RL branch** k→m: i(n+1) = G·v_km(n+1) + I_h, with G = 1/(2L/Δt + R) and I_h = G·[v_km(n) + (2L/Δt − R)·i(n)].
- **Capacitor** to ground: i(n+1) = G·v(n+1) + I_h, with G = 2C/Δt and I_h = −(G·v(n) + i(n)).
- **Resistor:** G = 1/R, no history.
- **Ideal voltage sources** (e and v_g) sit at the far ends of RL branches. Their known voltages move to the right-hand side.

Unknown nodes in gen 1: {v_c, v_n}, a 2×2 complex system solved directly (Cramer's rule is fine). Write the solver generically (build Y from a branch list, Gaussian elimination) so that gen 2 can add nodes.

- **Topology change** (fault on or off, breaker): rebuild Y at that step.
- **Numerical-oscillation damping:** the trapezoidal rule rings after switching. For the 2 steps after any topology change, use backward Euler companions instead: RL G = 1/(L/Δt + R), I_h = G·(L/Δt)·i(n); capacitor G = C/Δt, I_h = −G·v(n). Then return to trapezoidal. This is the standard "critical damping adjustment" idea.
- After solving the node voltages, update every branch current and history term.

### 4.4 Grid source and events (`grid.js`, `events.js`)
v_g(t) = V_g(t)·e^(jθ_g(t)), with dθ_g/dt = ω_b·ω_g(t).

Supported events (each `{t, type, ...params}`):
| type | params | effect |
|---|---|---|
| `fault` | `m, R` | adds shunt R_fault at the fault node, at fraction m along the line |
| `clear` | – | removes the fault |
| `sag` | `V, ramp?` | steps or ramps the grid source magnitude (an alternative to a fault) |
| `phaseJump` | `deg` | θ_g += deg |
| `freqRamp` | `rocof_Hz_s, duration` | ω_g ramps |
| `freqStep` | `df_Hz` | ω_g steps |
| `breakerOpen` / `breakerClose` | – | island / reconnect |
| `setpoint` | `{P?, Q?, V?, ...}` | inverter reference steps |
| `loadStep` | `{R_L, X_L}` | changes the local load |

### 4.5 SRF-PLL (`pll.js`)
- Input: v_c. v_dq = v_c·e^(−jθ_pll).
- Optional pre-normalisation by |v| (toggle, default **off**, so that low-voltage loss of lock is shown honestly).
- Δω_pu = K_p·v_q + K_i·∫v_q dt and dθ_pll/dt = ω_b·(1 + Δω_pu). Clamp Δω_pu to ±0.1 (±10 % frequency).
- Gain design for bandwidth ω_n and damping ζ (linearised at V = 1): K_p = 2ζω_n/ω_b and K_i = ω_n²/ω_b. Default f_n = 20 Hz, ζ = 0.707.
- Expose `pllFreqHz`, `pllAngle`, and a `locked` flag (|v_q|/|v| < 0.05 for 2 cycles).
- **Loss-of-lock behaviour:** when |v| < V_block (default 0.15 pu), the voltage angle is undefined. In "realistic" mode the inverter enters **BLOCKED · PLL LOST** (current reference = 0, PLL integrator frozen). It resumes when |v| > V_block + 0.05 for `t_resume` (default 20 ms).

### 4.6 Inner current loop (`currentloop.js`)
In the controller's dq frame (θ = PLL angle for GFL, internal angle for GFM):
- e_dq* = v_dq,meas + (K_pc + K_ic/s)(i_dq* − i_dq) + j·X_f·i_dq (decoupling) + R_f·i_dq
- Pole–zero cancellation design for closed-loop bandwidth ω_c: K_pc = ω_c·X_f/ω_b and K_ic = ω_c·R_f. Default f_c = 800 Hz (must stay ≤ f_ctrl/10).
- **Modulation limit:** |e_dq*| ≤ E_max (default 1.15 pu). Scale the vector, and stop integration (conditional anti-windup) while saturated.
- e_αβ = e_dq*·e^(jθ), applied with ZOH and an optional one-sample delay (`delay: true` default).

### 4.7 Grid-following inverter (`gfl.js`)
State machine modes (logged every sample and shown as the panel's status pill):
`NORMAL`, `CURRENT LIMIT · Iq PRIORITY`, `K-FACTOR Iq INJECTION`, `DEADBAND · CONSTANT P`, `BLOCKED · PLL LOST`, `RECOVERY · P RAMP`.

Outer references (V = filtered |v_c|, with a 1-cycle moving average or LPF at 100 Hz):
- Normal: i_d* = P*/max(V, 0.5) and i_q* = −Q*/max(V, 0.5).
- **Ride-through K-factor** (when V < V_deadband_low, default 0.9): Δi_q = K·(V_deadband_low − V), K default 2. i_q* = −(Q*/max(V, 0.5) + Δi_q). Symmetric overvoltage behaviour applies above V_deadband_high (default 1.1), with the opposite sign.
- **Inside the deadband** (0.9 ≤ V ≤ 1.1): mode `DEADBAND · CONSTANT P` if the episode wants to label it, otherwise `NORMAL`.
- **Current limit** I_max (default 1.2 pu peak):
  - Iq priority: i_q* clamped to ±I_max, then i_d* ≤ √(I_max² − i_q*²).
  - Id priority is optional (a toggle for comparison).
- **Blocking** below V_block (§4.5) in "realistic" mode only.
- **Recovery:** after V returns, P ramps at `P_ramp` (default 2 pu/s, configurable). Mode `RECOVERY · P RAMP`.

### 4.8 Grid-forming inverter (`gfm.js`)
Outer loop options (`gfm.outer`):
1. **`droop`** (default):
   - P and Q measured: S = v_c·conj(i_f), then a first-order LPF with f_pq = 10 Hz.
   - ω = ω_ref + m_p·(P* − P_f), with m_p = 0.05 (a 5 % frequency drop per 1 pu P).
   - E = V* + n_q·(Q* − Q_f), with n_q = 0.05.
   - dθ/dt = ω_b·ω.
2. **`vsm`**: 2H·dω/dt = P* − P_f − D·(ω − ω_ref), with H = 3 s and D = 20 pu. Optionally reduce droop: D = 1/m_p.
3. **`dvoc`** (gen 2).

Inner options (`gfm.inner`):
- **`voltageSource`** (labelled `VOLTAGE SOURCE · NOT LIMITED`): e = E·e^(jθ) − (R_v + jX_v)·i_f. A virtual impedance implemented on the measured current, with no current limit. This shows why a plain voltage source gives 3–7 pu fault currents.
- **`viCurrentRef`** (realistic, default): i_ref = (E·e^(jθ) − v_c)/(R_v + jX_v), then the current limiter, then the inner current loop (§4.6). Defaults X_v = 0.15 and R_v = 0.02.
- Current limiters (`gfm.limiter`):
  - `circular`: if |i_ref| > I_max, i_ref ← I_max·i_ref/|i_ref|. Mode `CURRENT LIMIT`.
  - `adaptiveVI`: X_v increases with overcurrent: X_v,eff = X_v + k_vi·max(0, |i| − I_th). Mode `ADAPTIVE VIRTUAL Z`.
  - `none`: mode `CURRENT LIMIT (UNLIMITED x.xx pu)`, showing the peak reached.
- **Synchronisation-stability awareness:** while current-limited, a GFM behaves like a current source, and its angle can drift (loss of synchronism). Log **δ drift** = (θ − θ_g) − (θ − θ_g)_prefault in degrees and show it in the readout. Optional `freezeAngleOnLimit` toggle (a mitigation strategy) for comparison.

### 4.9 Warm-up and initial conditions
- Every case runs a hidden **warm-up** from t = −T_warm (default 0.5 s) to the window start, so that the visible window begins in steady state.
- Initialise near steady state to shorten warm-up: θ_pll = θ_g = 0, i_f from the P*/Q* phasor solution, and v_c = v_g + Z·i.
- Assert steady state at the window start: |P − P*| < 0.01 and |Q − Q*| < 0.01 (warn in the console and fail the test if not).

### 4.10 Simulation output (`simulate.js`)
`run(caseConfig) → TimeSeries` with decimated logging (default every 0.1 ms, configurable). Arrays (Float32Array):
`t, va, vb, vc, ia, ib, ic, Vmag, Imag, phi_deg, P, Q, freqHz, pllFreqHz, delta_deg, Vpcc_phasor(re, im), I_phasor(re, im), Id, Iq, mode(Uint8)`.

**Fundamental phasor estimator** for the dials and readouts. Rotate into a frame at nominal ω_b and take a one-cycle moving average: X̂ = MA_T[x_αβ·e^(−jω_b t)]. This removes the DC offset (which appears at −f) and negative sequence (−2f), so the phasor stays clean during fault transients.

Performance budget: one 0.6 s case at dt_net = 10 µs is about 60k steps, and must run in < 150 ms in the browser. All scenarios are computed on load. Show a small "computing…" state, and set `SIM.ready = true` when done.

### 4.11 Gen-2 upgrade path: abc solver
For unbalanced faults (SLG, LL, LLG) and negative-sequence control, replace the complex αβ solver with a **real 3-phase nodal solver** that uses the same trapezoidal method (3× nodes, real arithmetic). Controllers gain positive- and negative-sequence extraction (DSOGI or delayed signal cancellation). Keep the `run()` interface unchanged.

---

## 5. Episode page anatomy

Two layout presets in `episode.json`:
- **`portrait45`**: 1080×1350 (LinkedIn feed). Stacked: header, scenario card, controls, SLD, panel 1, panel 2, footer.
- **`landscape169`**: 1920×1080 (YouTube, slides). Header across the top. SLD and explain panel on the left, plot panels stacked on the right.

Interactive mode is responsive (min width 360 px). Render mode locks to the exact pixel size from `?w=&h=`.

### 5.1 Components (top to bottom, portrait)
1. **Header:** title (e.g. "GFL vs GFM Fault Response"). Subtitle with conditions ("Inverter current during a 3-phase fault · 60 Hz · peak per-unit"). Thin rule.
2. **Scenario card:** `n / N`, the scenario's short title in bold, a one-line description, a progress bar across the scenario's video duration, and `t = +53.8 ms` (sim time at the cursor, mono font).
3. **Controls row** (segmented buttons): e.g. `Model: [Ideal][Realistic]`, `Fault: [Close-in][Mid][Far]`. Parameter chips on the right (`Xv = 0.15 pu · K = 2.0 · mp = 5 %`). In render mode the buttons reflect the active scenario, so the viewer sees what changed.
4. **Single-line diagram (SVG):** grid source, breaker, PCC, inverter symbol, line with a 0–100 % scale, and an animated ⚡ marker at the fault location (pulses while the fault is active). Legend for phase colours, V reference and current limit.
5. **Plot panel** (one per case, typically 2):
   - Left label (e.g. `GRID-FOLLOWING`, coloured) and a right **status pill** showing the controller mode at the cursor.
   - Canvas waveform: phases A, B, C current; dashed V_PCC phase A; dashed red ±I_max lines; a shaded fault band; a vertical cursor line. Traces are drawn only up to the cursor (progressive reveal).
   - Phasor dial (SVG): V_PCC (black, reference pointing right) and I (blue) at the cursor time.
   - Readout table (mono): `|V PCC|, |I|, φ (I vs V), P, Q`, plus case-specific values (`1st peak`, `δ drift`, `PLL f`).
6. **Footnote:** sign conventions (φ, Q) and "phasors shown at the cursor".
7. **Credit line:** from `episode.json → credit` (placeholder `Content by <Your Name>`).

### 5.2 Explain layer (the learning part)
Each scenario has:
```js
explain: {
  see: "GFL current collapses to zero within one cycle.",
  why: "At V_PCC ≈ 0 the PLL has no angle to lock to; the inverter blocks.",
  takeaway: "Close-in faults: GFL contributes almost no fault current; GFM still does."
}
```
- Interactive mode: shown in a side or bottom panel.
- Render mode: optionally shown as a **caption card** (lower third) for the last 40 % of each scenario (`timeline.captions: true`).

### 5.3 Interactive-mode extras
- Sliders for the episode's key parameters (e.g. SCR, X_v, K, m_p, fault m, R_fault, PLL bandwidth). Re-run on change, debounced at 150 ms.
- Hover crosshair on plots, with values at that time.
- Buttons: Play/Pause, Restart, Export CSV (current case), Copy PNG (canvas snapshot).
- Keyboard: `Space` play/pause, `←/→` step 1 ms, `1–9` select scenario, `R` restart.
- URL state: `?scenario=3&SCR=2.5` reproduces a view (shareable).

---

## 6. Design system (`lib/ui/theme.css`)

Light, clean, engineering-report look. All colours are CSS variables. Dark theme is optional in interactive mode via `prefers-color-scheme`. **Render mode always uses light.**

```css
:root {
  --bg: #ffffff;        --panel: #ffffff;      --panel-border: #d1d5db;
  --ink: #111827;       --muted: #6b7280;      --rule: #111827;
  --grid: #eef0f3;      --axis: #9ca3af;
  --accent: #0f766e;    /* active buttons, progress bar */
  --gfl: #b91c1c;       /* GRID-FOLLOWING label */
  --gfm: #15803d;       /* GRID-FORMING label */
  --phase-a: #2563eb;   --phase-b: #dc2626;    --phase-c: #d4a017;
  --vref: #374151;      /* dashed voltage */
  --limit: #dc2626;     /* dashed current limit */
  --fault-band: rgba(253, 230, 138, 0.35);
  --pill-warn-bg: #fff7ed;  --pill-warn-ink: #9a3412;
  --pill-ok-bg:   #f0fdf4;  --pill-ok-ink:   #166534;
  --pill-bad-bg:  #fef2f2;  --pill-bad-ink:  #991b1b;
  --font-ui: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

Typography at 1080 px width (scale proportionally): title 44 px/700, subtitle 22 px, panel labels 22 px/700 uppercase, status pill 16 px/600 uppercase, axis ticks 16 px, readouts 20 px mono, footnote 15 px. **Nothing below 15 px**, because LinkedIn is mostly watched on phones.

Margins: 40 px outer. Panels have 1 px border, 10 px radius, 16 px padding.

Mode → pill colour: `NORMAL`/`DEADBAND` = ok, `K-FACTOR`/`CURRENT LIMIT`/`VOLTAGE SOURCE · NOT LIMITED` = warn, `BLOCKED`/`UNLIMITED` = bad.

Plot rules: line width 2.5 px (phases), 2 px dashed (V ref, limit). Y axis is symmetric and auto-scaled to the case's max |i|, rounded to a nice number, with a minimum range of ±1.5. Clamp extreme peaks visually but always print the true peak in the readout. X axis in ms relative to the fault inception (t = 0).

Fonts are loaded from `lib/ui/fonts/` (local woff2). Await `document.fonts.ready` before setting `SIM.ready`.

---

## 7. Timeline and render contract

### 7.1 `episode.json`
```json
{
  "title": "GFL vs GFM Fault Response",
  "subtitle": "Inverter current during a 3-phase fault · 60 Hz · peak per-unit",
  "credit": "Content by <Your Name>",
  "layout": "portrait45",
  "fb": 60,
  "timeline": {
    "intro": 1.5,
    "perScenario": 5.0,
    "holdAtEnd": 1.0,
    "outro": 2.0,
    "captions": true,
    "easing": "linear"
  }
}
```

- During each scenario's `perScenario` seconds, the cursor sweeps the scenario's sim window (e.g. −20 ms → +100 ms), then holds for `holdAtEnd`. That is roughly 1/40× slow motion; it is computed, not hard-coded.
- Intro: title card with a one-sentence hook. Outro: a three-line summary, the credit, and an optional "interactive version" note.

### 7.2 `window.SIM` API (implemented in `lib/app.js`)
```js
window.SIM = {
  ready: false,                 // true after all sims computed AND fonts loaded
  videoDuration: 0,             // seconds, from timeline
  scenarios: [...],             // metadata
  setScenario(i),               // interactive
  setSimTime(tSec),             // interactive: move cursor in current scenario
  renderAt(videoTimeSec),       // render mode: draw the complete frame for this video time, synchronously
  exportCSV(caseIndex),
};
```
- In render mode (`?render=1`), there is **no requestAnimationFrame loop, no CSS transitions, no hover**. All animation is a pure function of `videoTimeSec`. Pulses and fades are computed from the time value.
- No `Date.now`, no `performance.now`, no unseeded randomness anywhere in drawing.

---

## 8. Tools

### 8.1 `tools/serve.mjs`
A minimal static server (Node `http` with correct MIME types for `.js`, `.mjs`, `.css`, `.woff2`, `.json`) on port 5173, with caching disabled.

### 8.2 `tools/render.mjs`
```js
// usage: node tools/render.mjs episodes/e02-gfl-vs-gfm-fault output/e02_linkedin.mp4 linkedin [--final]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const [,, ep, out, fmt = 'linkedin', flag] = process.argv;
const SIZES = { linkedin: [1080, 1350], youtube: [1920, 1080], square: [1080, 1080] };
const [W, H] = SIZES[fmt];
const FPS = 30;
const preset = flag === '--final' ? 'slow' : 'veryfast';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`http://localhost:5173/${ep}/index.html?render=1&w=${W}&h=${H}`);
await page.waitForFunction(() => window.SIM && window.SIM.ready === true, null, { timeout: 120000 });
const duration = await page.evaluate(() => window.SIM.videoDuration);

const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', preset, '-crf', '18', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });

const N = Math.round(duration * FPS);
for (let f = 0; f < N; f++) {
  await page.evaluate(t => window.SIM.renderAt(t), f / FPS);
  const buf = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 30 === 0) process.stdout.write(`\rframe ${f}/${N}`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await browser.close();
console.log(`\nwrote ${out}`);
```
Optional: `--audio music.mp3` muxes a background track (`-shortest`, −18 LUFS).

### 8.3 `tools/snap.mjs`
`node tools/snap.mjs <episode> 0,3.2,7.5 [linkedin]` writes PNG screenshots at those video times into `output/snaps/`. Use it to review the output after every layout change.

### 8.4 `tools/build-single.mjs`
Bundles `lib/` and the episode with esbuild (`--bundle --format=iife`), and inlines CSS and fonts (base64) into `output/<episode>.html`. The result is one self-contained file you can share or upload.

### 8.5 npm scripts
```json
"scripts": {
  "serve": "node tools/serve.mjs",
  "test": "node --test test/",
  "snap": "node tools/snap.mjs",
  "render": "node tools/render.mjs",
  "single": "node tools/build-single.mjs"
}
```

---

## 9. Validation (definition of done for the engine and each episode)

### 9.1 Engine tests (`test/engine.test.mjs`)
1. **Transforms:** abc → αβ → abc round-trip error < 1e-9. A balanced 1 pu set gives |x_αβ| = 1.
2. **Network, steady-state RL:** an ideal source behind R + jX feeding a short circuit reaches current magnitude 1/|Z| within 0.5 %, and its phase matches arg.
3. **Network, DC offset:** a fault applied at the voltage zero crossing of phase A in a purely inductive circuit gives a phase-A peak ≈ 2× the symmetrical peak (≥ 1.8× with X/R = 10).
4. **Trapezoidal ringing:** after a topology change with the backward-Euler damping steps, no step-to-step oscillation above 1 % of signal.
5. **PLL:** a 30° phase jump at SCR = 10 is tracked within 3 cycles with 20 Hz bandwidth. Frequency estimate error < 0.01 Hz in steady state.
6. **GFL steady state:** P* = 0.5, Q* = 0.2 gives measured values within 0.01 pu, a balanced current, and |I| = |S|/|V| within 1 %.
7. **GFL current limit:** after 2 ms from fault inception, |i_αβ| ≤ 1.05·I_max (realistic mode).
8. **GFL K-factor:** at a sustained sag to V = 0.6 (a sag event, not a fault), Δi_q ≈ K·(0.9 − 0.6) = 0.6 pu (±5 %), limited by I_max with Iq priority.
9. **GFM droop, islanded:** a load step ΔP = 0.3 pu with m_p = 5 % gives a steady-state frequency drop Δf = 0.05·0.3·f_b (0.9 Hz at 60 Hz) within 2 %.
10. **GFM VSM:** the initial RoCoF after a load step ≈ ΔP/(2H)·f_b Hz/s within 10 %.
11. **GFM unlimited bolted close-in fault:** steady fault current ≈ |E|/|R_v + R_f + j(X_v + X_f) + Z_1| within 10 % (Z_1 = m·Z_g).
12. **Energy/power sanity:** P computed from v·conj(i) matches the instantaneous abc power in pu, (2/3)·Σ v_k·i_k (abc values in peak-pu), to within 1e-6 in balanced steady state.
13. **Determinism:** two runs of the same config are bit-identical.

### 9.2 Episode checks
Each episode's `scenarios.js` carries an `expect` block per case (e.g. `{firstPeakMax: 1.3, Vpcc_at_50ms: [0, 0.1]}`). `test/episodes.test.mjs` runs all scenarios headless in Node and asserts these. If a scenario's text claims something ("GFL blocks", "GFM settles near 0.75 pu"), there must be an `expect` that proves it.

### 9.3 Visual checks (review with `snap.mjs`)
- No text overlap or clipping at 1080×1350 and 1920×1080.
- Pills and readouts are legible. Nothing smaller than 15 px.
- Traces stop exactly at the cursor. The fault band aligns with t = 0.
- Phasor dial: V points right. I's angle matches the printed φ.

---

## 10. Episode catalogue

### Generation 1 (build these first)

#### E01 — GFL anatomy: PLL plus current control
- **Hook:** "A grid-following inverter is a current source that needs a voltage to follow."
- Cases (single panel and a PLL panel showing θ error and estimated f):
  1. P* step 0 → 0.8 pu (current loop speed, about 1 ms).
  2. Q* step 0 → 0.4 pu (i_q goes negative, V_PCC rises on a weak grid).
  3. Grid phase jump of 20° (PLL transient, then current transient).
  4. Weak grid SCR sweep: SCR 5 → 2 → 1.3 with PLL bandwidth 20 Hz vs 60 Hz. Shows growing oscillation and instability at low SCR with a fast PLL.
- Explain: "PLL bandwidth vs grid strength" is the headline takeaway.
- Expect: E01-4 at SCR = 1.3 with 60 Hz PLL is unstable (the oscillation envelope grows). SCR = 5 is stable.

#### E02 — GFL vs GFM: 3-phase fault response
- Two panels (GFL, GFM). Model toggle `[Ideal][Realistic]`, fault `[Close-in][Mid][Far]`.
- Scenarios (8):
  1. Close-in, ideal: both clamp at I_max.
  2. Close-in, realistic: GFL blocks (PLL lost, V < 0.15). GFM overshoots on the first cycle, then limits. δ drift is shown.
  3. Mid, ideal: GFL K-factor Iq injection. GFM limited.
  4. Mid, realistic: slower GFL rise (PLL and filter). GFM DC offset in the first cycles.
  5. Far, ideal: GFL in deadband (V > 0.9), constant P.
  6. Far, realistic: GFM settles at a current set by X_v.
  7. Far, X_v = 0.10: higher GFM current.
  8. Far, X_v = 0.20: lower GFM current.
- Window: −20 ms … +100 ms. The fault stays on (no clearing) in gen 1. Option: clear at 100 ms.
- Takeaway: "GFL contribution depends on the PLL and grid code settings. GFM contribution is set by its virtual impedance and current limiter, and it's there from the first cycle."
- Expect: realistic close-in GFL |I| < 0.05 pu after 20 ms. GFM 'unlimited' first peak > 3 pu. Far-fault GFM current decreases monotonically with X_v.

#### E03 — GFM droop: islanded load sharing with frequency
- One GFM feeding a local RL load, breaker open (islanded). Panels: (a) abc current and voltage, (b) frequency and P vs time (a different plot type, using the same plot.js with a `series` config).
- Cases: load step +0.3 pu with m_p = 2 %, 5 % and 8 %; then the same step with VSM H = 1, 3 and 8 s.
- Visual extra: a **P–f droop line** chart with the operating point dot moving along the line in sync with the cursor.
- Expect: Δf_ss = m_p·ΔP·f_b. VSM RoCoF ∝ 1/H.

#### E04 — Ride-through and K-factor reactive current
- One GFL panel plus a **V–t ride-through envelope** chart, labelled "illustrative envelope — verify against current IEEE 2800 / local grid code tables", with the V_PCC trajectory drawn on it.
- Second extra chart: **ΔIq vs ΔV** line (slope K), with the operating point moving.
- Cases: sags to 0.8, 0.6, 0.3 and 0.1 pu (via the `sag` event with grid-side retained voltage); K = 2 vs K = 4; Iq priority vs Id priority.
- Expect: Δi_q = K·(0.9 − V) until the I_max clamp; at V < V_block, BLOCKED (realistic mode).

### Generation 2 (backlog; add as needed)
- E05 Two GFMs sharing load by droop (multi-node network, P and Q sharing errors from line impedance mismatch, X/R effect).
- E06 GFM current limiting and loss of synchronism: circular vs adaptive VI vs angle freeze; equal-area intuition with a P–δ curve.
- E07 Phase jump: GFL vs GFM (the GFM's instant inherent response vs the GFL's PLL delay).
- E08 BESS fast frequency response: droop/FFR from a BESS with SOC limits. Battery = OCV(SOC) + R0 + one RC; DC link C·v_dc·dv_dc/dt = P_dc − P_ac with a DC-voltage loop.
- E09 Unbalanced faults (abc solver, §4.11): negative-sequence current injection, double-frequency DC-link ripple.
- E10 LCL resonance and active damping: harmonics, control delay, resonance frequency vs f_ctrl/6 rule of thumb.
- E11 Impedance-based stability: inverter output impedance vs grid impedance Bode/Nyquist (frequency-domain plot module).
- E12 Black start and islanding transition of a BESS PCS.
- E13 Synthetic inertia vs FFR vs primary droop: a timeline comparison on one frequency event.

---

## 11. Scenario schema (`episodes/*/scenarios.js`)

```js
export default {
  window: [-0.020, 0.100],            // seconds relative to the first event at t = 0
  common: {
    fb: 60,
    grid: { SCR: 5, XR: 10, Vg: 1.0 },
    filter: { Xf: 0.15, Rf: 0.005, Bc: 0.05, RcDamp: 30 },
    ctrl: { fctrl: 10000, delay: true, Imax: 1.2, Emax: 1.15 },
  },
  cases: [                              // panels, in order
    { id: 'gfl', label: 'GRID-FOLLOWING', color: 'var(--gfl)', inverter: { type: 'GFL', P: 0.5, Q: 0, K: 2, Vblock: 0.15, pll: { fn: 20, zeta: 0.707 } } },
    { id: 'gfm', label: 'GRID-FORMING',   color: 'var(--gfm)', inverter: { type: 'GFM', P: 0.5, Q: 0, outer: 'droop', mp: 0.05, nq: 0.05, inner: 'viCurrentRef', Xv: 0.15, Rv: 0.02, limiter: 'circular' } },
  ],
  scenarios: [
    {
      id: 'close-realistic',
      short: 'Close-in',
      desc: 'realistic: GFL blocks (PLL lost at V ≈ 0); GFM overshoots, then drifts',
      ui: { Model: 'Realistic', Fault: 'Close-in' },   // which segmented buttons light up
      chips: { Xv: 0.15, K: 2.0, mp: '5 %' },
      overrides: { gfl: { realistic: true }, gfm: { limiter: 'circular' } },
      events: [{ t: 0, type: 'fault', m: 0.02, R: 0.005 }],
      explain: {
        see: 'GFL current collapses within a cycle; GFM spikes, then is held at 1.2 pu.',
        why: 'With V_PCC ≈ 0 the PLL has no angle; GFM is a voltage source until its limiter acts.',
        takeaway: 'Close to the inverter, only the GFM keeps contributing fault current.'
      },
      expect: { gfl: { IafterMs: [20, 0, 0.05] }, gfm: { firstPeakMin: 1.5 } }
    },
    // ...
  ]
};
```
Merge order: `common` ← `cases[i]` ← `scenario.overrides[case.id]`.

---

## 12. Content production checklist (per video)

1. Pick one concept and one takeaway sentence. Write it in `explain.takeaway` first.
2. Choose 4–8 scenarios that each change **one** thing.
3. `npm test` passes, including the episode's `expect` checks.
4. Snap review at both formats.
5. Independent review: check every number shown against a hand calculation, sign conventions against §3, and whether any explain text overclaims.
6. Render: `npm run render -- episodes/eXX output/eXX_linkedin.mp4 linkedin --final`.
7. Post copy: the hook, three bullets matching the scenarios, the model assumptions in one line ("averaged EMT model, 60 Hz, SCR 5, Imax 1.2 pu"), and an offer to share the interactive file.
8. Keep `output/eXX.html` (single-file build) to share as the interactive version.

---

## 13. Glossary (for explain texts and tooltips)

- **GFL (grid-following):** controls current; synchronises with a PLL; needs an existing grid voltage.
- **GFM (grid-forming):** controls voltage magnitude and angle behind an impedance; synchronises through power (droop or VSM); can operate islanded.
- **PLL:** phase-locked loop; estimates the grid voltage angle by driving v_q → 0.
- **Droop (P–f, Q–V):** proportional sharing law. Frequency drops with active power, voltage drops with reactive power.
- **VSM:** virtual synchronous machine; emulates rotor inertia H and damping D.
- **Virtual impedance (X_v):** an impedance implemented in control. It sets GFM fault current and power sharing.
- **K-factor:** reactive current injection gain during voltage deviations, ΔIq = K·ΔV.
- **LVRT/HVRT:** low/high voltage ride-through; the requirement to stay connected through voltage excursions.
- **SCR:** short-circuit ratio; grid strength at the PCC relative to the inverter rating.
- **PCC:** point of common coupling.
- **δ drift:** change in the GFM internal angle relative to the grid during a disturbance; an early sign of loss of synchronism.
- **RoCoF:** rate of change of frequency.
- **FFR:** fast frequency response.
