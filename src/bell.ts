/**
 * The maths of "Squaring the Bell". Pure functions, no rendering, no DOM.
 *
 * The hill is h(x, y; s) = exp(-(x² + y²) / s²). Its volume is measured two ways:
 *  - slabs across x: slab i at x_i is the bell curve in y scaled by g(x_i), area g(x_i)·I_y, so the
 *    slabs hold Σ g(x_i)·I_y·dx → I_x·I_y = I²;
 *  - nested rings: ring i at mid-radius r_i holds 2π r_i g(r_i) dr, and 2π r e^(-r²/s²) is exactly the
 *    slope of -π s² e^(-r²/s²), so the rings add up to π s² (1 - e^(-R²/s²)) → π s².
 * Nothing in here uses √π to compute a sum; √π only appears as the comparison value and inside erf.
 */

/** The plate is the square |x|, |y| ≤ HALF·s; the thin skirt beyond it is summed out to FAR·s (e^-64). */
export const HALF = 3;
export const FAR = 8;
export const SQRT_PI = Math.sqrt(Math.PI);

/** The 1D bell g(x; s) = e^(-x²/s²). */
export const g = (x: number, s = 1) => Math.exp(-(x * x) / (s * s));
/** The hill h(x, y; s) = g(x)·g(y) = e^(-(x² + y²)/s²). */
export const hill = (x: number, y: number, s = 1) => Math.exp(-(x * x + y * y) / (s * s));
/** g' and g''' (for the Euler–Maclaurin edge terms where the plate cuts the hill off). */
export const g1 = (x: number, s = 1) => ((-2 * x) / (s * s)) * g(x, s);
export const g3 = (x: number, s = 1) => {
  const u = x / s;
  return ((-8 * u * u * u + 12 * u) / (s * s * s)) * Math.exp(-u * u);
};

type F1 = (x: number) => number;
type F2 = (x: number, y: number) => number;

/** Midpoint sum: n equal cells, each weighted by its centre value. */
export function midpoint(f: F1, a: number, b: number, n: number): number {
  const h = (b - a) / n;
  let t = 0;
  for (let i = 0; i < n; i++) t += f(a + (i + 0.5) * h);
  return t * h;
}

/** Equal-width (trapezoid) sum: n equal cells, half weight on the two end points. */
export function trapezoid(f: F1, a: number, b: number, n: number): number {
  const h = (b - a) / n;
  let t = 0.5 * (f(a) + f(b));
  for (let i = 1; i < n; i++) t += f(a + i * h);
  return t * h;
}

export function midpoint2D(f: F2, ax: number, bx: number, ay: number, by: number, nx: number, ny: number): number {
  const hx = (bx - ax) / nx, hy = (by - ay) / ny;
  let t = 0;
  for (let i = 0; i < nx; i++) {
    const x = ax + (i + 0.5) * hx;
    for (let j = 0; j < ny; j++) t += f(x, ay + (j + 0.5) * hy);
  }
  return t * hx * hy;
}

export function trapezoid2D(f: F2, ax: number, bx: number, ay: number, by: number, nx: number, ny: number): number {
  const hx = (bx - ax) / nx, hy = (by - ay) / ny;
  let t = 0;
  for (let i = 0; i <= nx; i++) {
    const wx = i === 0 || i === nx ? 0.5 : 1;
    const x = ax + i * hx;
    for (let j = 0; j <= ny; j++) t += wx * (j === 0 || j === ny ? 0.5 : 1) * f(x, ay + j * hy);
  }
  return t * hx * hy;
}

/**
 * Midpoint sum of the bell over [-L, L] plus the Euler–Maclaurin edge terms at the cut
 * (they use the bell's slope at the edge, never its area). At L = 8s they are ~e^-64.
 */
export function bellMidpoint(s: number, L: number, n: number): number {
  const h = (2 * L) / n;
  const m = midpoint((x) => g(x, s), -L, L, n);
  const edge = ((h * h) / 24) * (g1(L, s) - g1(-L, s)) - ((7 * h ** 4) / 5760) * (g3(L, s) - g3(-L, s));
  return m + edge;
}

/** The bell curve's area I over |x| ≤ L, from a fine equal-width sum (default: the whole line, |x| ≤ 8s). */
export function bellArea(s: number, L = FAR * s, n = 2400): number {
  return trapezoid((x) => g(x, s), -L, L, n);
}

/** Slab i's own area I_y: the bell curve in y across the slab, summed on a fine grid. */
const iyCache = new Map<string, number>();
export function slabOwnArea(s: number, L: number): number {
  const k = `${s}|${L}`;
  let v = iyCache.get(k);
  if (v === undefined) {
    v = L >= FAR * s - 1e-12 ? bellArea(s, L) : bellMidpoint(s, L, 4000);
    if (iyCache.size > 400) iyCache.clear();
    iyCache.set(k, v);
  }
  return v;
}

export interface Slab {
  i: number;
  /** centre of the slab */
  x: number;
  dx: number;
  /** peak height g(x_i) */
  height: number;
  /** area of its face: g(x_i)·I_y (a bell curve in y, scaled down by g(x_i)) */
  area: number;
  /** area·dx */
  volume: number;
}

/** The N slabs cut across the plate, |x| ≤ 3s, each dx = 6s/N thick. */
export function slabs(N: number, s: number): Slab[] {
  const dx = (2 * HALF * s) / N;
  const Iy = slabOwnArea(s, FAR * s);
  const out: Slab[] = [];
  for (let i = 0; i < N; i++) {
    const x = -HALF * s + (i + 0.5) * dx;
    const height = g(x, s);
    out.push({ i, x, dx, height, area: height * Iy, volume: height * Iy * dx });
  }
  return out;
}

/**
 * The whole hill measured in slabs: the N plate slabs plus same-width slabs continued through the thin
 * skirt out to |x| ≤ 8s, each holding g(x_i)·I_y·dx. Converges to I² exponentially fast in N.
 */
export function slabSum(N: number, s: number): number {
  const dx = (2 * HALF * s) / N;
  const extra = Math.ceil(((FAR - HALF) * s) / dx);
  let t = 0;
  for (let i = -extra; i < N + extra; i++) t += g(-HALF * s + (i + 0.5) * dx, s);
  return t * dx * slabOwnArea(s, FAR * s);
}

/** Only the plate, |x|, |y| ≤ 3s: midpoint slabs with the edge terms where the plate cuts the hill. Exact: π s² erf(3)². */
export function slabSumPlate(N: number, s: number): number {
  return bellMidpoint(s, HALF * s, N) * slabOwnArea(s, HALF * s);
}

export interface Ring {
  i: number;
  /** mid-radius */
  r: number;
  dr: number;
  /** cup height g(r_i) */
  height: number;
  /** 2π r_i, how far round the ring is (the unrolled strip's length) */
  around: number;
  /** 2π r_i g(r_i): ring volume per unit thickness (the tray bar height) */
  perRadius: number;
  /** 2π r_i g(r_i) dr */
  volume: number;
}

/** The N nested ring cups over 0 ≤ r ≤ 3s, each dr = 3s/N wide, at mid-radius. */
export function rings(N: number, s: number): Ring[] {
  const dr = (HALF * s) / N;
  const out: Ring[] = [];
  for (let i = 0; i < N; i++) {
    const r = (i + 0.5) * dr;
    const height = g(r, s);
    const around = 2 * Math.PI * r;
    out.push({ i, r, dr, height, around, perRadius: around * height, volume: around * height * dr });
  }
  return out;
}

/** Rings on the plate only (r ≤ 3s): converges to π s² (1 - e^-9) as dr². */
export function ringSumPlate(N: number, s: number): number {
  let t = 0;
  for (const q of rings(N, s)) t += q.volume;
  return t;
}

/** The thin skirt of same-width rings beyond the plate, 3s < r ≤ 8s. */
export function ringSkirt(N: number, s: number): number {
  const dr = (HALF * s) / N;
  let t = 0;
  for (let i = N; (i + 0.5) * dr <= FAR * s; i++) {
    const r = (i + 0.5) * dr;
    t += 2 * Math.PI * r * g(r, s) * dr;
  }
  return t;
}

/** The whole hill measured in rings (plate + skirt). */
export const ringSum = (N: number, s: number) => ringSumPlate(N, s) + ringSkirt(N, s);

/** Exact ring total out to radius R: π s² (1 - e^(-R²/s²)). */
export const ringTotalExact = (R: number, s: number) => Math.PI * s * s * (1 - Math.exp(-(R * R) / (s * s)));
/** 2π r e^(-r²/s²): the ring profile. */
export const ringSlope = (r: number, s = 1) => 2 * Math.PI * r * g(r, s);
/** -π s² e^(-r²/s²): the simple thing whose slope is the ring profile. */
export const ringPotential = (r: number, s = 1) => -Math.PI * s * s * g(r, s);
/** Central finite difference. */
export const fdSlope = (F: F1, x: number, h = 1e-5) => (F(x + h) - F(x - h)) / (2 * h);

// ───────────────────────── error function ─────────────────────────

/**
 * erf(x): for |x| < 3 the all-positive series erf(x) = (2/√π) e^(-x²) Σ 2ⁿ x^(2n+1) / (1·3·…·(2n+1));
 * beyond, erfc from its continued fraction. Good to ~1e-15 everywhere.
 */
export function erf(x: number): number {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? NaN : Math.sign(x);
  if (x < 0) return -erf(-x);
  if (x < 3) {
    let term = x, sum = x;
    for (let n = 1; n < 300; n++) {
      term *= (2 * x * x) / (2 * n + 1);
      sum += term;
      if (term < 1e-17 * sum) break;
    }
    return (2 / SQRT_PI) * Math.exp(-x * x) * sum;
  }
  return 1 - erfc(x);
}

/** erfc(x) = (e^(-x²)/√π) / (x + (1/2)/(x + (2/2)/(x + (3/2)/(x + …)))), for x ≥ 3; via erf below that. */
export function erfc(x: number): number {
  if (x < 3) return 1 - erf(x);
  let t = x;
  for (let k = 80; k >= 1; k--) t = x + k / 2 / t;
  return Math.exp(-x * x) / (SQRT_PI * t);
}

/** Running area of a bell curve of width s from -∞ to y: (s√π/2)(1 + erf(y/s)). */
export const runningArea = (y: number, s = 1) => ((s * SQRT_PI) / 2) * (1 + erf(y / s));

// ───────────────────────── Gamma and n-balls ─────────────────────────

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Γ(z) by the Lanczos approximation (g = 7, 9 terms), with reflection for z < 1/2. */
export function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
}

/** Volume of the unit n-ball: π^(n/2) / Γ(n/2 + 1). */
export const ballVolume = (n: number) => Math.pow(Math.PI, n / 2) / gamma(n / 2 + 1);

/** The n-dimensional bell's volume: Iⁿ with I measured numerically (→ π^(n/2) sⁿ). */
export const bellVolumeND = (n: number, s = 1) => Math.pow(bellArea(s), n);

/** Dimension with the biggest unit-ball volume among 1..maxN. */
export function ballPeak(maxN = 20): number {
  let best = 1;
  for (let n = 2; n <= maxN; n++) if (ballVolume(n) > ballVolume(best)) best = n;
  return best;
}

// ───────────────────────── darts ─────────────────────────

/** mulberry32: a tiny seeded 32-bit RNG, uniform on [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Darts {
  thrown: number;
  under: number;
  /** box volume × fraction under the hill */
  estimate: number;
  /** one standard error of the estimate */
  se: number;
  boxVolume: number;
  /** x, y, z (z as a fraction of the box height 1) and a 1/0 "under" flag, for the first `keep` darts */
  pts: Float32Array;
}

/** Throw n darts uniformly into the box |x|, |y| ≤ 3s, 0 ≤ z ≤ 1 and count those under the hill. */
export function throwDarts(n: number, s: number, seed: number, keep = n): Darts {
  const rnd = mulberry32(seed);
  const L = HALF * s;
  const pts = new Float32Array(Math.min(n, keep) * 4);
  let under = 0;
  for (let i = 0; i < n; i++) {
    const x = (rnd() * 2 - 1) * L, y = (rnd() * 2 - 1) * L, z = rnd();
    const u = z < hill(x, y, s) ? 1 : 0;
    under += u;
    if (i < keep) pts.set([x, y, z, u], i * 4);
  }
  const box = 4 * L * L;
  const p = under / n;
  return { thrown: n, under, estimate: box * p, se: box * Math.sqrt((p * (1 - p)) / n), boxVolume: box, pts };
}

// ───────────────────────── convergence ─────────────────────────

export interface ConvRow {
  N: number;
  slab: number;
  ring: number;
  slabErr: number;
  ringErr: number;
}

/** Equal-width slab and ring sums of the whole hill against π s², for a list of slice counts. */
export function convergenceTable(s: number, Ns = [4, 6, 8, 10, 12, 16, 24, 48, 100, 200]): ConvRow[] {
  const exact = Math.PI * s * s;
  return Ns.map((N) => {
    const slab = slabSum(N, s), ring = ringSum(N, s);
    return { N, slab, ring, slabErr: Math.abs(slab - exact), ringErr: Math.abs(ring - exact) };
  });
}

/** Everything the readouts need for one (N, s). */
export interface Totals {
  N: number;
  s: number;
  slabSum: number;
  ringSum: number;
  slabPlate: number;
  ringPlate: number;
  ringSkirt: number;
  exactVolume: number;
  exactSlabPlate: number;
  exactRingPlate: number;
  /** slab's own area (≈ s√π), measured */
  Iy: number;
  /** √(slab sum) */
  I: number;
}

export function totals(N: number, s: number): Totals {
  const erf3 = erf(HALF);
  const ringPlate = ringSumPlate(N, s), skirt = ringSkirt(N, s);
  const slab = slabSum(N, s);
  return {
    N,
    s,
    slabSum: slab,
    ringSum: ringPlate + skirt,
    slabPlate: slabSumPlate(N, s),
    ringPlate,
    ringSkirt: skirt,
    exactVolume: Math.PI * s * s,
    exactSlabPlate: Math.PI * s * s * erf3 * erf3,
    exactRingPlate: ringTotalExact(HALF * s, s),
    Iy: slabOwnArea(s, FAR * s),
    I: Math.sqrt(slab),
  };
}
