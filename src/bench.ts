/** World layout of the instrument, shared by the WebGL and Canvas2D views. Units: world metres-ish. */
import { HALF } from "./bell";
import { ease } from "./model";

export type V3 = [number, number, number];

/** world units per unit of x (the hill's horizontal scale) */
export const K = 0.62;
/** world height of h = 1 */
export const HW = 1.05;
export const PLATE_T = 0.07;
export const Y0 = PLATE_T;
/** how far the slabs spread when fanned (fraction of their spacing) */
export const FAN_DESK = 0.5;
export const FAN_PHONE = 0.5;

export const plateHalf = (s: number) => K * HALF * s + 0.14;

export interface Tray {
  /** graph origin (r = 0, value 0) on the tray surface */
  o: V3;
  /** unit vector along r */
  ax: V3;
  /** unit vector up the tray surface */
  up: V3;
  /** unit normal out of the tray */
  n: V3;
  /** world length of r ∈ [0, 3s] */
  gw: number;
  /** world height of the graph's full scale */
  gh: number;
  /** the tray plate's centre, size, tilt and yaw */
  centre: V3;
  w: number;
  h: number;
  tilt: number;
  yaw: number;
  /** gauge column (running total) x offset along ax, and its width */
  gx: number;
  gwid: number;
}

/** Tray value scale: bar heights are (2π r e^(-r²/s²))/s on 0..VMAX; the gauge is total/(π s²) on 0..GMAX. */
export const VMAX = 3.0;
export const GMAX = 1.22;

export interface Bench {
  phone: boolean;
  s: number;
  P: number;
  tray: Tray;
  dials: { a: V3; b: V3; r: number; yaw: number };
  odo: { p: V3; yaw: number; w: number };
  az: number;
  el: number;
  benchW: number;
  benchD: number;
  benchC: V3;
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export function makeBench(s: number, phone: boolean): Bench {
  const P = plateHalf(s);
  const az = phone ? -0.6 : -0.42;
  const el = phone ? 0.62 : 0.5;
  let tray: Tray;
  if (!phone) {
    const w = 2.75, h = 1.9, tilt = 1.05, yaw = -0.38;
    const centre: V3 = [P + 0.75 + (w / 2) * Math.cos(yaw), 0, -0.75];
    tray = trayFrame(centre, w, h, tilt, yaw);
  } else {
    const w = Math.max(2.9, 2 * P + 0.2), h = 1.75, tilt = 1.18, yaw = az;
    const back = P * 1.25 + 0.45;
    const centre: V3 = [-Math.sin(az) * back, 0, -Math.cos(az) * back];
    tray = trayFrame(centre, w, h, tilt, yaw);
  }
  const dz = P + 0.6;
  return {
    phone,
    s,
    P,
    tray,
    dials: { a: [-P - 0.5, 0, dz - 0.85], b: [-P + 0.15, 0, dz - 0.5], r: 0.28, yaw: -0.36 },
    odo: { p: [-0.85, 0, dz - 0.05], yaw: -0.3, w: 1.0 },
    az,
    el,
    benchW: phone ? 9 : 12,
    benchD: phone ? 9 : 7,
    benchC: phone ? [0.6, 0, -0.6] : [0.3, 0, 0.4],
  };
}

function trayFrame(centre: V3, w: number, h: number, tilt: number, yaw: number): Tray {
  // the tray leans back by `tilt` from flat; its surface faces the viewer (+z rotated by yaw)
  const ax: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const fwd: V3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const up: V3 = [-fwd[0] * Math.cos(tilt), Math.sin(tilt), -fwd[2] * Math.cos(tilt)];
  const n: V3 = [fwd[0] * Math.sin(tilt), Math.cos(tilt), fwd[2] * Math.sin(tilt)];
  // `centre` is where the tray's lower lip rests on the bench; the plate leans back from there
  const cc = add([centre[0], 0.06, centre[2]], up, h / 2);
  const gw = w * 0.7, gh = h * 0.72;
  const o = add(add(add(cc, ax, -w / 2 + w * 0.1), up, -h / 2 + h * 0.15), n, 0.012);
  return { o, ax, up, n, gw, gh, centre: cc, w, h, tilt, yaw, gx: gw + w * 0.07, gwid: w * 0.08 };
}

/** World point on the tray graph: r as a fraction of 3s along, v as a fraction of full height up, lifted d off the plate. */
export function trayPoint(t: Tray, fr: number, fv: number, d = 0): V3 {
  return add(add(add(t.o, t.ax, fr * t.gw), t.up, fv * t.gh), t.n, d);
}

/** World x of slab i's centre for fan amount f (0..1, linear; eased here). */
export function slabX(x: number, _s: number, f: number, phone: boolean): number {
  const e = ease(f);
  return K * x * (1 + (phone ? FAN_PHONE : FAN_DESK) * e);
}

/** Points the camera must keep in view for a given route. */
export function framePoints(b: Bench, route: "slabs" | "rings" | "hill", tight = false): V3[] {
  const P = b.P;
  const pts: V3[] = [
    [-P, 0, -P],
    [P, 0, -P],
    [-P, 0, P],
    [P, 0, P],
    [0, Y0 + HW * 1.05, 0],
  ];
  if (tight) {
    pts.splice(0, 4, [-P * 0.8, 0, P * 0.6], [P * 0.8, 0, P * 0.6], [-P * 0.8, 0, -P * 0.6]);
    pts.push(add(b.dials.a, [-0.3, 0.8, 0.2]), add(b.dials.a, [-0.3, 0, 0.3]), add(b.odo.p, [0, 0.35, 0.2]));
  } else if (!b.phone) {
    pts.push(add(b.dials.a, [-0.5, 0, 0.25]), add(b.dials.a, [-0.35, 0.9, 0]), add(b.odo.p, [0.55, 0, 0.2]), add(b.odo.p, [0, 0.4, 0]));
  }
  if (route === "slabs") {
    const xr = K * HALF * b.s * (1 + (b.phone ? FAN_PHONE : FAN_DESK)) + 0.05;
    const xl = -xr;
    pts.push([xl, 0, -P * 0.8], [xl, 0, P * 0.8], [xr, 0, P * 0.8], [xl * 0.3, Y0 + HW, 0]);
  } else if (route === "rings" || b.phone) {
    const t = b.tray;
    const corner = (u: number, v: number) => add(add(t.centre, t.ax, (u * t.w) / 2), t.up, (v * t.h) / 2);
    pts.push(corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, 1), add(corner(1, 1), [0, 0.1, 0]));
    if (b.phone) pts.push([0, Y0 + HW + 0.5, 0.4]);
  }
  return pts;
}
