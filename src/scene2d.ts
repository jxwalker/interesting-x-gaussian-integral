/** Canvas2D fallback: the same instrument in a fixed oblique view, same model, same controls. */
import { HALF, erf as erfApprox } from "./bell";
import { GMAX, HW, K, VMAX, Y0, framePoints, makeBench, slabX, trayPoint, type Bench, type V3 } from "./bench";
import { LANDED, ease, type Model } from "./model";
import { AMBER, CREAM, LIME, dialAngle, dialRange, odoWheels, type Anchor, type Anchors, type Layout, type View } from "./view";

type P2 = [number, number];

export class Scene2D implements View {
  readonly kind = "2d" as const;
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private layout: Layout = { x: 0, y: 0, w: 1, h: 1, phone: false };
  private bench: Bench = makeBench(1, false);
  private az = -0.5;
  private el = 0.44;
  private sc = 100;
  private ox = 0;
  private oy = 0;
  private route: "slabs" | "rings" = "slabs";
  private slabPolys: { i: number; poly: P2[] }[] = [];
  private anchorPts: Record<string, V3 | null> = {};
  private fitKey = "";

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    host.appendChild(this.canvas);
    this.g = this.canvas.getContext("2d")!;
  }

  resize(w: number, h: number, layout: Layout): void {
    this.W = w;
    this.H = h;
    this.layout = layout;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.fitKey = "";
  }

  private basis() {
    const a = this.az, e = this.el;
    const r: V3 = [Math.cos(a), 0, -Math.sin(a)];
    const u: V3 = [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)];
    const d: V3 = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
    return { r, u, d };
  }
  private raw(p: V3): P2 {
    const { r, u } = this.basis();
    return [p[0] * r[0] + p[1] * r[1] + p[2] * r[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2]];
  }
  private depth(p: V3): number {
    const { d } = this.basis();
    return p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  }
  private pr(p: V3): P2 {
    const q = this.raw(p);
    return [this.ox + q[0] * this.sc, this.oy - q[1] * this.sc];
  }

  private fit(model: Model): void {
    const route = model.mode === "rings" || model.show === "rings" ? "rings" : "slabs";
    const key = `${route}|${model.s}|${this.W}|${this.H}|${this.layout.x}|${this.layout.y}|${this.layout.w}|${this.layout.h}`;
    if (key === this.fitKey) return;
    this.fitKey = key;
    this.route = route;
    this.bench = makeBench(model.s, this.layout.phone);
    this.az = this.bench.az;
    this.el = this.bench.el;
    const pts = framePoints(this.bench, route).map((p) => this.raw(p));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const L = this.layout;
    this.sc = Math.min((L.w * 0.92) / (x1 - x0), (L.h * 0.9) / (y1 - y0));
    this.ox = L.x + L.w / 2 - ((x0 + x1) / 2) * this.sc;
    this.oy = L.y + L.h / 2 + ((y0 + y1) / 2) * this.sc;
  }

  private poly(pts: V3[], fill: string | null, stroke: string | null, lw = 1.2): P2[] {
    const g = this.g;
    const q = pts.map((p) => this.pr(p));
    g.beginPath();
    q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = lw;
      g.stroke();
    }
    return q;
  }
  private circle(c: V3, r: number, y: number, n = 48): V3[] {
    const out: V3[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      out.push([c[0] + Math.cos(a) * r, y, c[2] + Math.sin(a) * r]);
    }
    return out;
  }

  render(_dt: number, model: Model): void {
    this.lastModel = model;
    this.fit(model);
    const g = this.g;
    const b = this.bench;
    const s = model.s;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, this.H);
    bg.addColorStop(0, "#0b1324");
    bg.addColorStop(1, "#07080c");
    g.fillStyle = bg;
    g.fillRect(0, 0, this.W, this.H);
    for (const k of Object.keys(this.anchorPts)) this.anchorPts[k] = null;

    // bench and plate
    const [cx, , cz] = b.benchC;
    const bw = b.benchW / 2, bd = b.benchD / 2;
    this.poly([[cx - bw, 0, cz - bd], [cx + bw, 0, cz - bd], [cx + bw, 0, cz + bd], [cx - bw, 0, cz + bd]], "#3a2416", null);
    const P = b.P;
    this.poly([[-P, Y0, -P], [P, Y0, -P], [P, Y0, P], [-P, Y0, P]], "#b88a3d", "#6b4d1c", 2);
    g.strokeStyle = "rgba(55,35,8,0.45)";
    g.lineWidth = 1;
    for (let k = -6; k <= 6; k++) {
      const v = K * s * k * 0.5;
      const a = this.pr([v, Y0, -K * HALF * s]), c = this.pr([v, Y0, K * HALF * s]);
      const d = this.pr([-K * HALF * s, Y0, v]), e = this.pr([K * HALF * s, Y0, v]);
      g.beginPath();
      g.moveTo(...a);
      g.lineTo(...c);
      g.moveTo(...d);
      g.lineTo(...e);
      g.stroke();
    }

    // darts on the plate
    const ds = model.dartsShown.n;
    if (model.darts && ds) {
      for (let i = 0; i < ds; i++) {
        const p = model.darts.pts;
        const [x, y] = this.pr([K * p[i * 4], Y0, K * p[i * 4 + 1]]);
        g.fillStyle = p[i * 4 + 3] ? LIME : "#4a5160";
        g.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    // tray (always on the phone; on the desk only in ring mode)
    this.drawTray(model);

    // the hill, slabs or rings
    this.slabPolys = [];
    if (model.show === "hill") {
      for (let k = 1; k <= 20; k++) {
        const h = k / 20;
        const r = K * s * Math.sqrt(-Math.log(Math.max(1e-4, h - 0.025)));
        this.poly(this.circle([0, 0, 0], r, Y0 + HW * (h - 0.05)), CREAM, k % 2 === 0 ? "#2a2a2a" : null, 1.2);
      }
    } else if (model.show === "slabs") {
      const SL = model.slabList;
      const order = SL.map((sl) => sl.i).sort((a, c) => this.depth([slabX(SL[a].x, s, model.fan, b.phone), 0, 0]) - this.depth([slabX(SL[c].x, s, model.fan, b.phone), 0, 0]));
      const hl = model.highlight;
      for (const i of order) {
        const sl = SL[i];
        const x = slabX(sl.x, s, model.fan, b.phone);
        const pts: V3[] = [[x, Y0, -K * HALF * s]];
        for (let k = 0; k <= 40; k++) {
          const v = -HALF * s + (2 * HALF * s * k) / 40;
          pts.push([x, Y0 + HW * sl.height * Math.exp(-(v * v) / (s * s)), K * v]);
        }
        pts.push([x, Y0, K * HALF * s]);
        const q = this.poly(pts, i === hl ? LIME : CREAM, "#2a2a2a", 1.3);
        this.slabPolys.push({ i, poly: q });
        if (model.showErf && i === model.focusSlab) {
          g.strokeStyle = "#0f5f5a";
          g.lineWidth = 2.5;
          g.beginPath();
          for (let k = 0; k <= 60; k++) {
            const v = -HALF * s + (2 * HALF * s * k) / 60;
            const fr = (1 + erfApprox(v / s)) / 2;
            const p = this.pr([x - 0.01, Y0 + HW * sl.height * fr, K * v]);
            if (k) g.lineTo(...p);
            else g.moveTo(...p);
          }
          g.stroke();
        }
      }
      const j = Math.floor(SL.length * 0.35);
      this.anchorPts.slabs = [slabX(SL[j].x, s, model.fan, b.phone), Y0 + HW * SL[j].height, 0];
      if (hl >= 0) this.anchorPts.hl = [slabX(SL[hl].x, s, model.fan, b.phone), Y0 + HW * SL[hl].height, 0];
    } else {
      const R = model.ringList;
      for (let i = R.length - 1; i >= 0; i--) {
        if (model.ringPhase(i) > 0) continue;
        const q = R[i];
        this.poly(this.circle([0, 0, 0], K * (q.r + q.dr / 2), Y0 + HW * q.height), CREAM, "#2a2a2a", 1);
      }
      let jn = -1;
      for (let i = R.length - 1; i >= 0; i--) if (model.ringPhase(i) <= 0) {
        jn = Math.floor(i * 0.6);
        break;
      }
      if (jn >= 0) this.anchorPts.rings = [-K * R[jn].r * 0.7, Y0 + HW * R[jn].height, K * R[jn].r * 0.7];
      // rings in flight / landed
      for (let i = R.length - 1; i >= 0; i--) {
        const phi = model.ringPhase(i);
        if (phi <= 0) continue;
        this.drawFlying(model, i, phi);
      }
    }

    this.drawDials(model);
  }

  private barCorners(model: Model, i: number): V3[] {
    const t = this.bench.tray;
    const q = model.ringList[i];
    const s = model.s;
    const fr0 = (q.r - q.dr * 0.43) / (HALF * s), fr1 = (q.r + q.dr * 0.43) / (HALF * s);
    const fv = q.perRadius / s / VMAX;
    return [trayPoint(t, fr0, 0, 0.01), trayPoint(t, fr1, 0, 0.01), trayPoint(t, fr1, fv, 0.01), trayPoint(t, fr0, fv, 0.01)];
  }

  private drawFlying(model: Model, i: number, phi: number): void {
    const q = model.ringList[i];
    const bar = this.barCorners(model, i);
    if (phi >= LANDED) {
      this.poly(bar, AMBER, "#2a2a2a", 1);
      return;
    }
    const rw = K * q.r, hw = HW * q.height;
    const lift = ease(phi / 0.14) * 0.6;
    const u = ease((phi - 0.14) / 0.36);
    const fly = ease(Math.max(0, (phi - 0.5) / (LANDED - 0.5)));
    if (u < 1) this.poly(this.circle([0, 0, 0], rw, Y0 + lift + hw), null, `rgba(239,230,207,${1 - u})`, 2);
    const { r } = this.basis();
    const half = Math.min(Math.PI * rw, 1.2) * u;
    const front: V3 = [Math.sin(this.az) * (rw + 0.6), Y0 + lift + 0.15, Math.cos(this.az) * (rw + 0.6)];
    const strip: V3[] = [
      [front[0] - r[0] * half, front[1], front[2] - r[2] * half],
      [front[0] + r[0] * half, front[1], front[2] + r[2] * half],
      [front[0] + r[0] * half, front[1] + hw, front[2] + r[2] * half],
      [front[0] - r[0] * half, front[1] + hw, front[2] - r[2] * half],
    ];
    const mix = strip.map((p, k): V3 => [p[0] + (bar[k][0] - p[0]) * fly, p[1] + (bar[k][1] - p[1]) * fly + Math.sin(Math.PI * fly) * 0.5, p[2] + (bar[k][2] - p[2]) * fly]);
    if (u > 0) this.poly(mix, AMBER, "#2a2a2a", 1);
  }

  private drawTray(model: Model): void {
    const b = this.bench;
    if (!(model.show === "rings" || b.phone || model.mode === "rings")) return;
    const t = b.tray;
    const g = this.g;
    const s = model.s;
    const C = (u: number, v: number): V3 => [t.centre[0] + t.ax[0] * u * t.w / 2 + t.up[0] * v * t.h / 2, t.centre[1] + t.up[1] * v * t.h / 2, t.centre[2] + t.ax[2] * u * t.w / 2 + t.up[2] * v * t.h / 2];
    this.poly([C(-1, -1), C(1, -1), C(1, 1), C(-1, 1)], "#ece2c8", "#8e6a2e", 3);
    g.strokeStyle = "#1d1912";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(...this.pr(trayPoint(t, 0, 1.02)));
    g.lineTo(...this.pr(trayPoint(t, 0, 0)));
    g.lineTo(...this.pr(trayPoint(t, 1.02, 0)));
    g.stroke();
    g.setLineDash([5, 4]);
    g.strokeStyle = "rgba(40,30,15,0.7)";
    g.lineWidth = 1.5;
    g.beginPath();
    for (let k = 0; k <= 80; k++) {
      const fr = k / 80, r = fr * HALF * s;
      const p = this.pr(trayPoint(t, fr, (2 * Math.PI * r * Math.exp(-(r * r) / (s * s))) / s / VMAX));
      if (k) g.lineTo(...p);
      else g.moveTo(...p);
    }
    g.stroke();
    g.setLineDash([]);
    const gx = t.gx / t.gw, gx1 = (t.gx + t.gwid) / t.gw;
    const v = Math.max(0, model.ringNeedle.v) / (Math.PI * s * s);
    this.poly([trayPoint(t, gx, 0), trayPoint(t, gx1, 0), trayPoint(t, gx1, 1), trayPoint(t, gx, 1)], "rgba(30,24,14,0.12)", "#1d1912", 1.5);
    this.poly([trayPoint(t, gx, 0), trayPoint(t, gx1, 0), trayPoint(t, gx1, Math.min(1.2, v / GMAX)), trayPoint(t, gx, Math.min(1.2, v / GMAX))], "#c97f22", "#2a2a2a", 1);
    g.strokeStyle = "#e8c06a";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(...this.pr(trayPoint(t, gx - 0.03, 1 / GMAX, 0.02)));
    g.lineTo(...this.pr(trayPoint(t, gx1 + 0.03, 1 / GMAX, 0.02)));
    g.stroke();
    const lp = this.pr(trayPoint(t, gx1 + 0.05, 1 / GMAX));
    g.fillStyle = "#7a5512";
    g.font = "700 16px Georgia, serif";
    g.textBaseline = "middle";
    g.fillText(Math.abs(s - 1) < 1e-3 ? "π" : "π s²", lp[0] + 2, lp[1]);
    this.anchorPts.tray = trayPoint(t, 0.3, 0.75);
    this.anchorPts.total = trayPoint(t, gx1, 1 / GMAX);
  }

  private drawDials(model: Model): void {
    const b = this.bench;
    if (b.phone) return;
    const g = this.g;
    const s = model.s;
    const range = dialRange(s);
    const drawDial = (p: V3, v: number, title: string, key: string) => {
      const c = this.pr([p[0], 0.3 + 0.28 + p[1], p[2]]);
      const R = 0.28 * this.sc;
      g.fillStyle = "#b88a3d";
      g.beginPath();
      g.arc(c[0], c[1], R * 1.1, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#f1e8d2";
      g.beginPath();
      g.arc(c[0], c[1], R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#1d1912";
      for (let k = 0; k <= 8; k++) {
        const a = dialAngle((k * range) / 8, range) - Math.PI / 2;
        g.lineWidth = k % 2 ? 1 : 2;
        g.beginPath();
        g.moveTo(c[0] + Math.cos(a) * R * 0.75, c[1] + Math.sin(a) * R * 0.75);
        g.lineTo(c[0] + Math.cos(a) * R * 0.92, c[1] + Math.sin(a) * R * 0.92);
        g.stroke();
      }
      const ap = dialAngle(Math.PI * s * s, range) - Math.PI / 2;
      g.fillStyle = "#c9952e";
      g.beginPath();
      g.arc(c[0] + Math.cos(ap) * R * 0.95, c[1] + Math.sin(ap) * R * 0.95, 4, 0, Math.PI * 2);
      g.fill();
      const a = dialAngle(v, range) - Math.PI / 2;
      g.strokeStyle = "#111";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(c[0], c[1]);
      g.lineTo(c[0] + Math.cos(a) * R * 0.85, c[1] + Math.sin(a) * R * 0.85);
      g.stroke();
      g.fillStyle = "#15100a";
      g.font = `700 ${Math.max(9, R * 0.22)}px Georgia, serif`;
      g.textAlign = "center";
      g.fillText(title, c[0], c[1] + R * 0.5);
      g.textAlign = "left";
      this.anchorPts[key] = [p[0], 0.3 + 0.28 * 2.1, p[2]];
    };
    drawDial(b.dials.a, model.slabNeedle.v, "SLABS", "dialA");
    drawDial(b.dials.b, model.ringNeedle.v, "RINGS", "dialB");
    const op = this.pr([b.odo.p[0], 0.2, b.odo.p[2]]);
    const wdt = 1.1 * this.sc;
    g.fillStyle = "#c9a24f";
    g.fillRect(op[0] - wdt / 2, op[1] - 0.17 * this.sc, wdt, 0.3 * this.sc);
    g.fillStyle = "#16120c";
    g.fillRect(op[0] - wdt * 0.43, op[1] - 0.12 * this.sc, wdt * 0.86, 0.17 * this.sc);
    const w = odoWheels(model.odo.v).map((x) => Math.floor(x + 0.5) % 10);
    g.fillStyle = "#f2ead6";
    g.font = `700 ${Math.max(10, 0.13 * this.sc)}px ui-monospace, Menlo, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`${w[0]}.${w.slice(1).join("")}`, op[0], op[1] - 0.035 * this.sc);
    g.textAlign = "left";
    this.anchorPts.odo = [b.odo.p[0], 0.33, b.odo.p[2]];
  }

  anchors(): Anchors {
    const out: Anchors = {};
    for (const [k, p] of Object.entries(this.anchorPts)) if (p) {
      const [x, y] = this.pr(p);
      out[k] = { x, y, on: true } as Anchor;
    }
    return out;
  }

  pick(x: number, y: number): number {
    for (let k = this.slabPolys.length - 1; k >= 0; k--) if (inside(this.slabPolys[k].poly, x, y)) return this.slabPolys[k].i;
    return -1;
  }

  private lastModel: Model | null = null;
  resetCamera(model?: Model): void {
    this.fitKey = "";
    const m = model ?? this.lastModel;
    if (m) this.fit(m);
  }
  cameraPose(): number[] {
    return [this.az, this.el, this.sc, this.ox, this.oy, 0];
  }
  setCameraPose(p: number[]): void {
    [this.az, this.el, this.sc, this.ox, this.oy] = p;
  }
  poke(): void {}
  dispose(): void {
    this.canvas.remove();
  }
  get routeNow(): string {
    return this.route;
  }
}

function inside(poly: P2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
