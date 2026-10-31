// Tiny complex-number helpers. Values are plain { re, im } objects.
// Used for αβ space vectors (x_α + j x_β) and phasors.

export const cx = (re = 0, im = 0) => ({ re, im });
export const ZERO = Object.freeze({ re: 0, im: 0 });

export const add = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const scale = (a, k) => ({ re: a.re * k, im: a.im * k });
export const conj = (a) => ({ re: a.re, im: -a.im });
export const neg = (a) => ({ re: -a.re, im: -a.im });

export function div(a, b) {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

export const abs = (a) => Math.sqrt(a.re * a.re + a.im * a.im);
export const abs2 = (a) => a.re * a.re + a.im * a.im;
export const arg = (a) => Math.atan2(a.im, a.re);

/** e^(jθ) */
export const expj = (th) => ({ re: Math.cos(th), im: Math.sin(th) });
/** r·e^(jθ) */
export const polar = (r, th) => ({ re: r * Math.cos(th), im: r * Math.sin(th) });

/** a·e^(jθ) */
export function rot(a, th) {
  const c = Math.cos(th), s = Math.sin(th);
  return { re: a.re * c - a.im * s, im: a.re * s + a.im * c };
}

/** Wrap an angle to (−π, π]. */
export function wrapPi(x) {
  x = (x + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
}

/** Scale a so that |a| ≤ max. Returns [limited vector, wasLimited]. */
export function limitMag(a, max) {
  const m = abs(a);
  if (m > max && m > 0) return [scale(a, max / m), true];
  return [a, false];
}
