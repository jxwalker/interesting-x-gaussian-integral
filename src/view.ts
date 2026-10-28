/** Renderer-agnostic view interface, palette and shared helpers. */
import type { Model } from "./model";

export const CREAM = "#efe6cf";
export const INK = "#2a2a2a";
export const LIME = "#9bd83a";
export const AMBER = "#e3a13a";
export const BRASS = "#d4a955";
export const TEAL = "#16706b";

export interface Layout {
  /** free rectangle (CSS px) the instrument is framed into */
  x: number;
  y: number;
  w: number;
  h: number;
  phone: boolean;
}

export type Anchor = { x: number; y: number; on: boolean };
export type Anchors = Record<string, Anchor | undefined>;

export interface View {
  readonly kind: "webgl" | "2d";
  readonly canvas: HTMLCanvasElement;
  resize(w: number, h: number, layout: Layout): void;
  render(dt: number, model: Model): void;
  /** advance the camera without drawing (fast-forward) */
  settle?(dt: number, model: Model): void;
  anchors(): Anchors;
  /** slab index under a screen point, or -1 */
  pick(x: number, y: number, model: Model): number;
  /** frame the default view for the model's current route */
  resetCamera(model?: Model): void;
  cameraPose(): number[];
  setCameraPose(p: number[]): void;
  /** a hand is on the scene: stop the idle drift for a while */
  poke(): void;
  dispose(): void;
}

/** Dial range that keeps π s² on the face: 0–4, 0–8 or 0–16. */
export const dialRange = (s: number) => {
  const v = Math.PI * s * s;
  return v <= 3.9 ? 4 : v <= 7.8 ? 8 : 16;
};
/** Dial sweep: 0 at lower-left, full scale at lower-right, 270°. Angle in radians, clockwise from up. */
export const dialAngle = (v: number, range: number) => -0.75 * Math.PI + 1.5 * Math.PI * Math.max(0, Math.min(1.04, v / range));

/** The odometer wheel positions (one integer digit, five decimals) with the carry roll. */
export function odoWheels(v: number): number[] {
  const x = Math.max(0, Math.min(9.99999, Number.isFinite(v) ? v : 0)) * 1e5;
  const out: number[] = [];
  let lower = x % 10;
  out.unshift(lower);
  let scaled = x;
  for (let p = 1; p < 6; p++) {
    scaled = scaled / 10;
    const carry = lower > 9 ? lower - 9 : 0;
    const d = Math.floor(scaled) % 10;
    const pos = d + carry;
    out.unshift(pos);
    lower = pos;
  }
  return out;
}

export const fx = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
