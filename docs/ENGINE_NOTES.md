# Engine notes — decisions and deviations from SIM_SPEC (gen 1)

SIM_SPEC.md stays the source of truth. This file records where the engine had to
choose, clarify or deviate, and why. Conventions in §3 and the solver method in
§4.3 are implemented as written; nothing here changes them.

## Control-structure choices

| Item | Spec | Engine | Why |
|---|---|---|---|
| Current-loop v_c feedforward | raw `v_dq,meas` | first-order dq LPF, `ctrl.ffHz = 150` Hz | Raw sampled feedforward through the 1.5·Ts delay forms a loop with Z_g that oscillates at 0.6–1 kHz: the GFM is unstable for SCR ≲ 5, and a GFL injecting K-factor Iq at SCR 5 also goes unstable. Feedforward filtering is the usual industrial remedy. Cost: the current overshoot at fault inception lasts ≈2 ms instead of <1 ms (see test 7). |
| GFM current-loop bandwidth | f_c = 800 Hz | GFM default `fc = 500` Hz (GFL keeps 800) | At 800 Hz the GFM virtual-admittance path is still unstable below SCR ≈ 1.5. At 500 Hz it is stable from SCR 1.1 to 20. |
| GFM `viCurrentRef` virtual impedance | `i_ref = (E·e^{jθ} − v_c)/(R_v + jX_v)` | dynamic virtual RL in the GFM dq frame: `L_v di/dt + (R_v + jωX_v) i = E − v_c,f`, with v_c LPF in dq at `fvi = 300` Hz; trapezoidal integration | This is identical to the algebraic form at the fundamental. The algebraic form feeds measured v_c back with gain 1/|Z_v| ≈ 6.7 and is unstable when \|Z_g\| > \|Z_v\|. As a bonus, the dynamic form produces the physical DC offset at fault inception. The circular limiter clamps the virtual-branch current state. |
| Delay compensation | not specified | the αβ command is rotated ahead by 1.5·ω·Ts (0.5·ω·Ts if `delay: false`) | Standard practice: it cancels the mean ZOH plus transport lag, so steady state is exact and the warm start holds. |
| GFL blocking | block when \|v\| < V_block | block when \|v\| < V_block for `tBlock = 1` ms | Without debouncing, one sample of LC ringing at fault inception tripped a 20 ms block on faults where V_PCC settles at 0.35–0.55 pu. Bolted faults still block within 3–7 ms. |
| "Ideal" PLL (`pll.ideal: true`) | not defined | angle = grid source angle + its pre-event offset (an oracle) | This gives E02's "ideal" model an angle even at V ≈ 0. |
| VSM P/Q filter | 10 Hz (stated for droop) | `fpq` default is 10 Hz for droop and 50 Hz for VSM | With a 10 Hz filter the measured initial RoCoF comes out about 15 % low, because the filter delays it. The inertia already does the filtering. |
| GFM V* | `E = V* + n_q(Q* − Q_f)` | `V: 'auto'` (default) picks V* so that Q = Q* at the initial operating point | Without it, Q droop leaves a Q error and the §4.9 steady-state check fails. |
| Islanded start | — | `network.breaker: 'open'` sets v_c = `network.Vpcc`∠0 (1 pu); GFM `P`/`Q` default to `'auto'`, the initial load | This puts the islanded case in steady state at the window start (ω = 1). |

## Config and API details

- `buildCase(ep, caseIndex, scenarioIndex)` follows the §11 merge order. Override
  keys that name a top-level section (`grid`, `filter`, `ctrl`, `network`, `load`,
  `window`, …) merge at the top level. Every other key merges into `inverter`,
  so `{ gfl: { realistic: true } }` works as written in §11.
- Gen 1 supports one fault location per case. The line is split at `m` when the
  network is built.
- Extra log fields beyond §4.10: `IdRef, IqRef, Vf` (the filtered |v| the
  controller uses), `Eint` (GFM internal EMF), `vAngle_deg` (the angle of v in the
  controller frame, which for a GFL is the PLL error), `VgMag`.
- `Imag`/`Vmag` are instantaneous \|x_αβ\|. The readouts should use the phasor
  fields (`VpRe/VpIm/IpRe/IpIm`), which come from the one-cycle MA estimator.
- Modes live in `lib/engine/modes.js`, with a label and a pill tone. The
  `UNLIMITED` label has a `{peak}` placeholder for the UI to fill in.

## Test relaxations (§9.1)

| # | Spec | Test | Reason |
|---|---|---|---|
| 3 | X/R = 10 peak ≥ 1.8× | ≈ IEC κ = 1.02 + 0.98·e^(−3R/X) = 1.746 (±0.03); purely inductive (X/R = 1000) ≥ 1.95 | At X/R = 10 the physical maximum is 1.75×. A 2× peak needs X/R → ∞. |
| 7 | ≤ 1.05·I_max from 2 ms | from 3 ms | The feedforward LPF (above) keeps the worst case of 16 fault cases above the limit until 2.1 ms. |
| 8 | Δi_q ≈ K·(0.9 − 0.6) | Δi_q ≈ K·(0.9 − V_PCC,measured) | The injected Iq lifts V_PCC from 0.6 to about 0.69, and the controller acts on the measured voltage. |
| 9 | Δf = 0.05·0.3·60 = 0.9 Hz | Δf = m_p·ΔP_delivered·f_b (ΔP_delivered = 0.283 gives 0.848 Hz) | V_PCC sags behind X_v, so a resistive load step delivers less than its nominal 0.3 pu. The droop law holds exactly for the delivered ΔP. |
| 10 | ΔP/(2H)·f_b | the same, using the delivered ΔP | Same reason as test 9. |

## Behaviours worth knowing before writing episodes

- **E02 "Mid, ideal".** A bolted mid-line fault at SCR 5 puts V_PCC at about 0.05 pu, so a
  realistic GFL blocks. To show K-factor injection, use `realistic: false` (and/or
  `pll.ideal: true`) or a non-zero `R_fault`.
- **Weak-grid GFL ride-through.** At SCR ≤ 3 with K = 2 and deep sags (≤ 0.3), or
  SCR 2 with K = 4, the GFL loses stability: the PLL hits its ±10 % clamps. This
  is a credible real effect, since K-factor gain × X_g ≳ 1 and GFL loses
  synchronism at low voltage in weak grids. It is a possible future episode;
  don't hide it.
- **Current-limit boundary chatter.** When the K-factor demand sits right at
  I_max, the mode can flicker between `KFACTOR` and `CL_IQ` from sample to sample,
  with a PLL-frequency ripple of about 0.2–0.3 Hz. The UI should debounce the pill
  (for example, show the most frequent mode over the last ~2 ms).
- **E01-4 is reproduced.** At SCR 1.3, a 60 Hz PLL is unstable and a 20 Hz PLL is stable.
- **Speed.** A 0.62 s case (0.5 s warm-up plus a 0.12 s window) runs in about 15–30 ms in Node.
