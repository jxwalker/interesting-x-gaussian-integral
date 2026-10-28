/** Demo state, the slab/ring morph, needle springs and the scripted opening. Rendering-free. */
import { HALF, rings, slabs, throwDarts, totals, type Darts, type Ring, type Slab, type Totals } from "./bell";

export type Mode = "slabs" | "rings";
export type Show = "hill" | "slabs" | "rings";

export const DEFAULTS = {
  mode: "slabs" as Mode,
  slices: 24,
  width: 1,
  dims: 3,
  showErf: false,
  showConv: false,
};
export const MIN_SLICES = 4;
export const MAX_SLICES = 200;
export const MIN_W = 0.5;
export const MAX_W = 2;
export const FLAT_W = 2;
export const N_DARTS = 2000;

const FAN_OPEN = 0.6;
const FAN_CLOSE = 0.4;
const RETURN = 0.55;
/** One ring's own lift → unroll → fly → settle takes this long; the cascade spreads the starts. */
const RING_DUR = 0.7;
/** Phase at which a flying ring counts as landed in the tray. */
export const LANDED = 0.92;

export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** How long the full cascade takes for N rings (seconds). */
export const peelTime = (N: number) => 1.4 + 1.2 * clamp((N - 6) / 54, 0, 1);

class Spring {
  v = 0;
  vel = 0;
  step(target: number, dt: number, k = 70, z = 0.62): number {
    if (dt <= 0) return this.v;
    const c = 2 * Math.sqrt(k) * z;
    // a few sub-steps keep it stable at 1/30 s
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (k * (target - this.v) - c * this.vel) * h;
      this.v += this.vel * h;
    }
    if (!Number.isFinite(this.v)) this.v = target, this.vel = 0;
    // needles rest on their stop pin at 0
    if (this.v < 0 && target >= 0) this.v = 0, this.vel = Math.max(0, this.vel);
    return this.v;
  }
  snap(v: number): void {
    this.v = v;
    this.vel = 0;
  }
}

type EvKey = "slices" | "width" | "mode" | "darts" | "dims" | "erf" | "conv" | "reset" | "flatten" | "undo" | "pick";

export class Model {
  time = 0;
  mode: Mode = DEFAULTS.mode;
  show: Show = "hill";
  slices = DEFAULTS.slices;
  s = DEFAULTS.width;
  dims = DEFAULTS.dims;
  showErf = DEFAULTS.showErf;
  showConv = DEFAULTS.showConv;
  reducedMotion = false;

  /** 0 = slabs pushed together into the hill, 1 = fanned out (linear; views ease it) */
  fan = 0;
  /** 0 = every ring nested in the hill, 1 = every ring landed in the tray */
  peel = 0;
  /** rings flying home before a fresh cascade */
  private returning = false;
  slabsMeasured = false;
  ringsMeasured = false;

  hover = -1;
  picked = -1;
  sliding = false;

  darts: Darts | null = null;
  dartsT = -Infinity;
  dartThrows = 0;

  flattenStash: number | null = null;

  wowActive = false;
  wowT = 0;
  private holdHill = false;
  private wowFired = new Set<string>();

  ev: Record<EvKey, number> = { slices: -1e9, width: -1e9, mode: -1e9, darts: -1e9, dims: -1e9, erf: -1e9, conv: -1e9, reset: -1e9, flatten: -1e9, undo: -1e9, pick: -1e9 };

  slabNeedle = new Spring();
  ringNeedle = new Spring();
  odo = new Spring();
  /** a "version" bump whenever the cut (N or s) changes, so views rebuild geometry */
  cutVersion = 0;

  private cache: { key: string; tot: Totals; slabs: Slab[]; rings: Ring[] } | null = null;

  private ensure() {
    const key = `${this.slices}|${this.s}`;
    if (!this.cache || this.cache.key !== key) {
      this.cache = { key, tot: totals(this.slices, this.s), slabs: slabs(this.slices, this.s), rings: rings(this.slices, this.s) };
      this.cutVersion++;
    }
    return this.cache;
  }
  get tot(): Totals {
    return this.ensure().tot;
  }
  get slabList(): Slab[] {
    return this.ensure().slabs;
  }
  get ringList(): Ring[] {
    return this.ensure().rings;
  }

  // ───────────────────────── rings in flight ─────────────────────────

  /** Fraction of the cascade each ring's own animation spans. */
  get ringSpan(): number {
    return clamp(RING_DUR / peelTime(this.slices), 0.2, 0.55);
  }
  /** Phase of ring i (0 = innermost): 0 nested … 1 landed. Outermost peels first. */
  ringPhase(i: number): number {
    if (this.show !== "rings") return 0;
    const N = this.slices;
    const d = this.ringSpan;
    const k = N - 1 - i;
    const start = N > 1 ? (k / (N - 1)) * (1 - d) : 0;
    return clamp((this.peel - start) / d, 0, 1);
  }
  /** Total volume of the rings that have landed (the skirt joins with the last one). */
  get landed(): { sum: number; count: number; current: number } {
    const R = this.ringList;
    let sum = 0, count = 0, current = -1;
    for (let i = R.length - 1; i >= 0; i--) {
      const p = this.ringPhase(i);
      if (p >= LANDED) {
        sum += R[i].volume;
        count++;
      } else if (p > 0 && current < 0) current = i;
    }
    if (count === R.length) sum += this.tot.ringSkirt;
    return { sum, count, current };
  }
  get isReturning(): boolean {
    return this.show === "rings" && (this.returning || this.mode === "slabs");
  }
  get peelDone(): boolean {
    return this.show === "rings" && this.peel >= 1 && !this.returning;
  }
  get morphing(): boolean {
    if (this.mode === "slabs") return this.show !== "slabs" || this.fan < 1;
    return this.show !== "rings" || this.peel < 1 || this.returning;
  }

  // ───────────────────────── user actions ─────────────────────────

  /** Any hand on the controls ends the opening where it is. */
  interrupt(): void {
    if (!this.wowActive) return;
    this.wowActive = false;
    this.holdHill = false;
    this.slabsMeasured = this.ringsMeasured = true;
  }

  setSlices(n: number, fromUser = true): void {
    const v = clamp(Math.round(n), MIN_SLICES, MAX_SLICES);
    if (!Number.isFinite(v) || v === this.slices) return;
    this.slices = v;
    if (this.picked >= v) this.picked = -1;
    if (this.hover >= v) this.hover = -1;
    if (fromUser) this.ev.slices = this.time;
  }

  setWidth(s: number, fromUser = true): void {
    const v = clamp(s, MIN_W, MAX_W);
    if (!Number.isFinite(v) || Math.abs(v - this.s) < 1e-9) return;
    this.s = v;
    if (this.darts) this.darts = null;
    if (fromUser) this.ev.width = this.time;
  }

  setMode(m: Mode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.returning = false;
    this.ev.mode = this.time;
    if (m === "rings") this.ringsMeasured = true;
  }
  toggleMode(): void {
    this.setMode(this.mode === "slabs" ? "rings" : "slabs");
  }

  /** Watch it again, or the opening on load. */
  startWow(): void {
    this.applyDefaults();
    this.wowActive = true;
    this.wowT = 0;
    this.wowFired.clear();
    this.holdHill = true;
    this.show = "hill";
    this.fan = 0;
    this.peel = 0;
    this.slices = 6;
    this.slabsMeasured = this.ringsMeasured = false;
    this.slabNeedle.snap(0);
    this.ringNeedle.snap(0);
    this.odo.snap(0);
  }

  private applyDefaults(): void {
    this.mode = DEFAULTS.mode;
    this.slices = DEFAULTS.slices;
    this.s = DEFAULTS.width;
    this.dims = DEFAULTS.dims;
    this.showErf = DEFAULTS.showErf;
    this.showConv = DEFAULTS.showConv;
    this.darts = null;
    this.dartThrows = 0;
    this.flattenStash = null;
    this.hover = this.picked = -1;
    this.returning = false;
  }

  reset(): void {
    this.wowActive = false;
    this.holdHill = false;
    this.applyDefaults();
    this.slabsMeasured = this.ringsMeasured = true;
    if (this.show === "hill") this.show = "slabs";
    this.ev.reset = this.time;
  }

  flatten(): void {
    if (this.flattenStash === null) this.flattenStash = this.s;
    this.setWidth(FLAT_W);
    this.ev.flatten = this.time;
  }
  undoFlatten(): void {
    if (this.flattenStash === null) return;
    this.setWidth(this.flattenStash);
    this.flattenStash = null;
    this.ev.undo = this.time;
  }

  throwDarts(): void {
    this.dartThrows++;
    this.darts = throwDarts(N_DARTS, this.s, 1000 + this.dartThrows);
    this.dartsT = this.time;
    this.ev.darts = this.time;
  }
  /** Darts visible so far (they rain in over ~1.2 s). */
  get dartsShown(): { n: number; under: number } {
    const d = this.darts;
    if (!d) return { n: 0, under: 0 };
    const n = Math.min(d.thrown, Math.floor(d.thrown * clamp((this.time - this.dartsT) / 1.2, 0, 1)));
    if (n === d.thrown) return { n, under: d.under };
    let u = 0;
    for (let i = 0; i < n; i++) u += d.pts[i * 4 + 3];
    return { n, under: u };
  }

  setDims(n: number): void {
    const v = clamp(Math.round(n), 1, 8);
    if (v === this.dims) return;
    this.dims = v;
    this.ev.dims = this.time;
  }
  setErf(on: boolean): void {
    this.showErf = on;
    this.ev.erf = this.time;
  }
  setConv(on: boolean): void {
    this.showConv = on;
    this.ev.conv = this.time;
  }
  pick(i: number): void {
    this.picked = i;
    this.ev.pick = this.time;
  }

  /** The slab in the spotlight: hovered, tapped, or the one nearest x = 0.75 s. */
  get focusSlab(): number {
    const h = this.hover >= 0 ? this.hover : this.picked;
    if (h >= 0 && h < this.slices) return h;
    const L = this.slabList;
    let best = 0;
    for (const sl of L) if (Math.abs(sl.x - 0.75 * this.s) < Math.abs(L[best].x - 0.75 * this.s)) best = sl.i;
    return best;
  }
  get highlight(): number {
    const h = this.hover >= 0 ? this.hover : this.picked;
    return h < this.slices ? h : -1;
  }

  // ───────────────────────── readouts ─────────────────────────

  get slabTarget(): number {
    return this.slabsMeasured ? this.tot.slabSum : 0;
  }
  get ringTarget(): number {
    if (this.show === "rings") return this.landed.sum;
    return this.ringsMeasured ? this.tot.ringSum : 0;
  }
  /** The odometer: √ of what the active route has measured so far. */
  get odoTarget(): number {
    if (this.show === "rings") return Math.sqrt(this.landed.sum);
    return Math.sqrt(this.slabTarget);
  }

  // ───────────────────────── the clock ─────────────────────────

  step(dt: number): void {
    if (dt < 0 || !Number.isFinite(dt)) dt = 0;
    this.time += dt;
    if (this.wowActive) this.runWow(dt);
    this.ensure();

    // the morph between the two routes
    if (this.mode === "slabs") {
      if (this.show === "rings") {
        this.peel = Math.max(0, this.peel - dt / RETURN);
        if (this.peel <= 0) {
          this.show = "slabs";
          this.fan = 0;
        }
      } else if (this.show === "hill") {
        if (!this.holdHill) {
          this.show = "slabs";
          this.fan = 0;
          this.slabsMeasured = true;
        }
      } else this.fan = Math.min(1, this.fan + dt / FAN_OPEN);
    } else {
      if (this.show === "slabs") {
        this.fan = Math.max(0, this.fan - dt / FAN_CLOSE);
        if (this.fan <= 0) {
          this.show = "rings";
          this.peel = 0;
        }
      } else if (this.show === "hill") {
        this.show = "rings";
        this.peel = 0;
      } else if (this.returning) {
        this.peel = Math.max(0, this.peel - dt / RETURN);
        if (this.peel <= 0) this.returning = false;
      } else this.peel = Math.min(1, this.peel + dt / peelTime(this.slices));
    }

    this.slabNeedle.step(this.slabTarget, dt);
    this.ringNeedle.step(this.ringTarget, dt);
    const ot = this.odoTarget;
    // the odometer rolls (critically damped), never overshooting into nonsense digits
    this.odo.step(ot, dt, 40, 1);
    if (Math.abs(this.odo.v - ot) < 5e-7) this.odo.snap(ot);
  }

  /** Fly every ring home, then cascade them out again. */
  repeel(): void {
    if (this.show !== "rings") return;
    this.returning = true;
  }

  private once(key: string, at: number, f: () => void): void {
    if (this.wowT >= at && !this.wowFired.has(key)) {
      this.wowFired.add(key);
      f();
    }
  }

  /** The opening, all on the model clock so ?record=1 is frame-exact. */
  private runWow(dt: number): void {
    this.wowT += dt;
    const t = this.wowT;
    this.once("cut", 0.9, () => {
      this.holdHill = false;
    });
    this.once("rings", 2.2, () => this.setMode("rings"));
    if (t >= 4.0 && t < 6.2) this.setSlices(6 + 54 * ease((t - 4.0) / 2.2), false);
    this.once("sweep-end", 6.2, () => {
      this.setSlices(60, false);
      this.repeel();
    });
    this.once("home", 9.3, () => {
      this.setSlices(DEFAULTS.slices, false);
      this.setMode("slabs");
    });
    if (t >= 10.0 && t < 11.4) this.setWidth(1 + 0.5 * Math.sin((Math.PI * (t - 10.0)) / 1.4), false);
    this.once("width-end", 11.4, () => this.setWidth(1, false));
    if (t >= 11.75) {
      this.wowActive = false;
      this.slabsMeasured = this.ringsMeasured = true;
    }
  }

  /** Which wow beat is playing (for the caption). */
  get wowBeat(): string {
    const t = this.wowT;
    if (!this.wowActive) return "";
    if (t < 0.9) return "hill";
    if (t < 2.2) return "cut";
    if (t < 4.0) return "rings6";
    if (t < 6.2) return "sweep";
    if (t < 9.3) return "cascade";
    if (t < 10.0) return "home";
    if (t < 11.4) return "width";
    return "home";
  }

  finite(): boolean {
    const t = this.tot;
    const vals = [t.slabSum, t.ringSum, t.slabPlate, t.ringPlate, t.I, this.slabNeedle.v, this.ringNeedle.v, this.odo.v, this.fan, this.peel, this.s, this.landed.sum];
    return vals.every(Number.isFinite);
  }
}

export const plateHalfUnits = (s: number) => HALF * s;
