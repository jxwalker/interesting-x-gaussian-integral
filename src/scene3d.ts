/**
 * WebGL view: a matte cream ceramic bell hill on a brass plate, on a walnut bench at night.
 * Data surfaces (hill, slabs, cups, tray bars) are matte with crisp dark outlines; brass and walnut are PBR
 * with RoomEnvironment reflections; ACES; bloom only on the little indicator lamps.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { HALF, erf } from "./bell";
import { GMAX, HW, K, PLATE_T, VMAX, Y0, framePoints, makeBench, slabX, trayPoint, type Bench, type V3 } from "./bench";
import { LANDED, MAX_SLICES, ease, type Model } from "./model";
import { AMBER, CREAM, LIME, dialAngle, dialRange, odoWheels, type Anchor, type Anchors, type Layout, type View } from "./view";

const FOV = 24;
const EDGE_W = 0.016;

// ───────────────────────── textures ─────────────────────────

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function redraw(t: THREE.CanvasTexture, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): void {
  const c = t.image as HTMLCanvasElement;
  const g = c.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  draw(g, c.width, c.height);
  t.needsUpdate = true;
}

function walnutTex(): THREE.CanvasTexture {
  const t = canvasTex(1024, 1024, (g) => {
    g.fillStyle = "#3b2416";
    g.fillRect(0, 0, 1024, 1024);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 420; i++) {
      const y = rnd() * 1024;
      const a = 0.04 + rnd() * 0.1;
      g.strokeStyle = rnd() < 0.55 ? `rgba(16,8,3,${a})` : `rgba(120,74,42,${a * 0.8})`;
      g.lineWidth = 0.6 + rnd() * 3;
      g.beginPath();
      const amp = 2 + rnd() * 7, f = 0.003 + rnd() * 0.008, ph = rnd() * 6;
      for (let x = 0; x <= 1024; x += 16) g.lineTo(x, y + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.3 + ph) * amp * 0.3);
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function backdropTex(): THREE.CanvasTexture {
  return canvasTex(16, 512, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, "#0a1222");
    grd.addColorStop(0.5, "#111827");
    grd.addColorStop(1, "#06070a");
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 512);
  });
}

/** Brushed brass with an engraved grid: 1 cell = 0.5 s; the measured square |x|,|y| ≤ 3s outlined. */
function plateTex(): THREE.CanvasTexture {
  return canvasTex(1024, 1024, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, "#c99a49");
    grd.addColorStop(0.5, "#b88a3d");
    grd.addColorStop(1, "#a87b33");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 900; i++) {
      g.strokeStyle = `rgba(${rnd() < 0.5 ? "255,230,170" : "70,45,10"},${0.03 + rnd() * 0.05})`;
      g.lineWidth = 1;
      const y = rnd() * h;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + rnd() * 4 - 2);
      g.stroke();
    }
    // plate covers |u| ≤ 3 + margin; the texture maps the full plate
    const m = w * 0.04;
    const cell = (w - 2 * m) / 12;
    g.strokeStyle = "rgba(55,35,8,0.55)";
    g.lineWidth = 2;
    for (let k = 0; k <= 12; k++) {
      const p = m + k * cell;
      g.beginPath();
      g.moveTo(p, m);
      g.lineTo(p, h - m);
      g.moveTo(m, p);
      g.lineTo(w - m, p);
      g.stroke();
    }
    g.strokeStyle = "rgba(40,24,4,0.85)";
    g.lineWidth = 5;
    g.strokeRect(m, m, w - 2 * m, h - 2 * m);
    g.strokeStyle = "rgba(255,236,190,0.3)";
    g.lineWidth = 2;
    g.strokeRect(m + 4, m + 4, w - 2 * m - 8, h - 2 * m - 8);
  });
}

function engraveText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = "#2b1d08", font = "Georgia, 'Times New Roman', serif", weight = 700): void {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = "rgba(255,240,200,0.45)";
  g.fillText(text, x, y + Math.max(1, size * 0.05));
  g.fillStyle = color;
  g.fillText(text, x, y);
}

function dialFace(g: CanvasRenderingContext2D, w: number, title: string, range: number): void {
  const c = w / 2;
  g.fillStyle = "#14110c";
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
  const grd = g.createRadialGradient(c, c * 0.8, 10, c, c, c);
  grd.addColorStop(0, "#f6efdc");
  grd.addColorStop(1, "#e7dcc0");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(c, c, c * 0.95, 0, Math.PI * 2);
  g.fill();
  const A = (v: number) => dialAngle(v, range) - Math.PI / 2;
  g.strokeStyle = "#1d1912";
  g.lineCap = "butt";
  const minor = range / 40;
  for (let k = 0; k <= 40; k++) {
    const a = A(k * minor);
    const major = k % 10 === 0, mid = k % 5 === 0;
    g.lineWidth = major ? 7 : mid ? 4 : 2.5;
    const r0 = major ? c * 0.62 : mid ? c * 0.68 : c * 0.72;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    g.lineTo(c + Math.cos(a) * c * 0.8, c + Math.sin(a) * c * 0.8);
    g.stroke();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#15100a";
  g.font = `700 ${Math.round(c * 0.15)}px ui-monospace, Menlo, monospace`;
  for (let k = 0; k <= 4; k++) {
    const v = (k * range) / 4;
    const a = A(v);
    g.fillText(String(v), c + Math.cos(a) * c * 0.47, c + Math.sin(a) * c * 0.47);
  }
  g.font = `700 ${Math.round(c * 0.17)}px Georgia, serif`;
  g.fillText(title, c, c + c * 0.5);
  g.font = `600 ${Math.round(c * 0.085)}px ui-monospace, Menlo, monospace`;
  g.fillStyle = "#5a4a2c";
  g.fillText(range === 4 ? "volume" : `volume, 0–${range}`, c, c + c * 0.7);
}

function wheelTex(): THREE.CanvasTexture {
  return canvasTex(128, 1280, (g, w, h) => {
    g.fillStyle = "#f2ead6";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#16120c";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 96px ui-monospace, Menlo, monospace";
    for (let d = 0; d < 10; d++) g.fillText(String(d), w / 2, h - (d + 0.5) * (h / 10));
  });
}

// ───────────────────────── matte data material with outlines ─────────────────────────

/** MeshStandardMaterial that darkens fragments within EDGE_W (world) of an edge, from a vec3 `edge` attribute. */
function outlinedMaterial(params: THREE.MeshStandardMaterialParameters, instanced = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec3 edge;\nvarying vec3 vEdge;`)
      .replace(
        "#include <begin_vertex>",
        instanced
          ? `#include <begin_vertex>\nvEdge = vec3(edge.x * length(instanceMatrix[1].xyz), edge.y * length(instanceMatrix[0].xyz), 10.0);`
          : `#include <begin_vertex>\nvEdge = edge;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vEdge;\nuniform float uEdgeW;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float ed = min(min(vEdge.x, vEdge.y), vEdge.z);
        float aa = max(fwidth(ed) * 0.9, 1e-5);
        float ink = 1.0 - smoothstep(uEdgeW - aa, uEdgeW + aa, ed);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.08, 0.07), ink * 0.92);`,
      );
    sh.uniforms.uEdgeW = { value: EDGE_W };
  };
  m.customProgramCacheKey = () => (instanced ? "outlined-instanced" : "outlined");
  return m;
}

// ───────────────────────── geometry builders ─────────────────────────

/** Unit slab in (thickness x ∈ [-½,½], height y, across z = v ∈ [-3,3]) with a bell top y = e^(-v²). */
function slabGeometry(): THREE.BufferGeometry {
  const S = 96;
  const pos: number[] = [], nor: number[] = [], edge: number[] = [], idx: number[] = [];
  const top = (v: number) => Math.exp(-v * v);
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  // two faces (bell profile), normals ±x
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= S; j++) {
      const v = -HALF + (2 * HALF * j) / S;
      const t = top(v);
      pos.push(side * 0.5, 0, v, side * 0.5, t, v);
      nor.push(side, 0, 0, side, 0, 0);
      // edge.x: distance below the top (scaled by instance height); edge.y unused (large)
      edge.push(t, 99, 99, 0, 99, 99);
    }
    for (let j = 0; j < S; j++) {
      const a = base + j * 2;
      if (side > 0) quad(a, a + 2, a + 3, a + 1);
      else quad(a, a + 1, a + 3, a + 2);
    }
  }
  // the top strip along the bell edge (dark: it reads as the outline from above)
  {
    const base = pos.length / 3;
    for (let j = 0; j <= S; j++) {
      const v = -HALF + (2 * HALF * j) / S;
      const t = top(v);
      const dt = -2 * v * t;
      const n = new THREE.Vector3(0, 1, -dt).normalize();
      pos.push(-0.5, t, v, 0.5, t, v);
      nor.push(n.x, n.y, n.z, n.x, n.y, n.z);
      edge.push(0, 99, 99, 0, 99, 99);
    }
    for (let j = 0; j < S; j++) {
      const a = base + j * 2;
      quad(a, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("edge", new THREE.Float32BufferAttribute(edge, 3));
  geo.setIndex(idx);
  return geo;
}

/** The hill in u-space (|u|,|v| ≤ 3), height e^(-(u²+v²)); scaled by (K s, HW, K s). */
function hillGeometry(): THREE.BufferGeometry {
  const n = 180;
  const geo = new THREE.PlaneGeometry(2 * HALF, 2 * HALF, n, n);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getZ(i);
    p.setY(i, Math.exp(-(u * u + v * v)));
  }
  geo.computeVertexNormals();
  return geo;
}

function hillMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.86, metalness: 0, envMapIntensity: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLoc;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLoc = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vLoc;").replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      // the far skirt (below 0.02) is left to the plate so the engraved grid shows
      if (vLoc.y < 0.02) discard;
      // contour rings at heights 0.1 … 0.9
      float hh = vLoc.y * 10.0;
      float fh = abs(fract(hh + 0.5) - 0.5);
      float wh = fwidth(hh);
      float cont = (1.0 - smoothstep(wh * 0.6, wh * 1.6, fh)) * step(0.5, hh) * step(hh, 9.5);
      // faint engraved grid every 0.5 s, projected from the plate
      vec2 gq = vLoc.xz * 2.0;
      vec2 fg = abs(fract(gq + 0.5) - 0.5);
      vec2 wg = fwidth(gq);
      float grid = max(1.0 - smoothstep(wg.x * 0.5, wg.x * 1.3, fg.x), 1.0 - smoothstep(wg.y * 0.5, wg.y * 1.3, fg.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.42), grid * 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.165), cont * 0.95);`,
    );
  };
  return m;
}

// ───────────────────────── one ring cup ─────────────────────────

const C_CREAM = new THREE.Color(CREAM);
const C_AMBER = new THREE.Color(AMBER);
const C_TOP = new THREE.Color("#e2d6b8");
const C_AMBER_HI = new THREE.Color("#f0bf68");
const C_BOT = new THREE.Color("#3a3226");

interface RingPose {
  /** unroll 0..1 */
  u: number;
  /** curled stage: front point, yaw, lift, shrink */
  F: THREE.Vector3;
  yaw: number;
  sig: number;
  /** fly blend 0..1 into the bar pose */
  fly: number;
  lift: number;
}

class RingMesh {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  S = 0;
  key = "";
  private pos!: Float32Array;
  private nor!: Float32Array;
  private col!: Float32Array;
  private edge!: Float32Array;
  constructor(mat: THREE.Material, parent: THREE.Object3D) {
    this.geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }
  /** 4 sides (outer, top, inner, bottom) × (S+1) columns × 2 rows, plus 2 end caps. */
  alloc(S: number): void {
    if (S === this.S) return;
    this.S = S;
    const nv = 4 * (S + 1) * 2 + 8;
    this.pos = new Float32Array(nv * 3);
    this.nor = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 3);
    this.edge = new Float32Array(nv * 3);
    const idx: number[] = [];
    for (let side = 0; side < 4; side++) {
      const b = side * (S + 1) * 2;
      for (let j = 0; j < S; j++) {
        const a = b + j * 2;
        idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
      }
    }
    const e = 4 * (S + 1) * 2;
    idx.push(e, e + 1, e + 2, e, e + 2, e + 3, e + 4, e + 6, e + 5, e + 4, e + 7, e + 6);
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("normal", new THREE.BufferAttribute(this.nor, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("edge", new THREE.BufferAttribute(this.edge, 3));
    this.geo.setIndex(idx);
    this.mesh.geometry = this.geo;
  }

  /**
   * Fill the vertex buffers. Strip coords: A ∈ [-½,½] around, Y ∈ [0,1] up, n ∈ ±½ through the wall.
   * Curled pose: wall of radius rw (world) unrolling with curvature (1-u)/rw about its front point.
   * Bar pose: A → up the tray, Y → across it, n → out of it. The fly blend slerps between the two frames.
   */
  update(rw: number, tw: number, hw: number, pose: RingPose, bar: { o: THREE.Vector3; q: THREE.Quaternion; sa: number; sy: number; sn: number }, edgeScale: number): void {
    const S = this.S;
    const L = 2 * Math.PI * rw * pose.sig;
    const kap = (1 - pose.u) / Math.max(1e-6, rw * pose.sig);
    const hh = hw * pose.sig, tt = tw * pose.sig;
    // frame for the flat strip (u = 1) for blending into the bar
    const qStrip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
    const f = ease(pose.fly);
    const q = qStrip.clone().slerp(bar.q, f);
    const sa = THREE.MathUtils.lerp(L, bar.sa, f), sy = THREE.MathUtils.lerp(hh, bar.sy, f), sn = THREE.MathUtils.lerp(tt, bar.sn, f);
    // origin: strip's (A=0, Y=0) point → bar's middle-bottom; arc over the bench while flying
    const o = pose.F.clone().lerp(bar.o, f);
    o.y += Math.sin(Math.PI * f) * 0.55;
    const flying = pose.fly > 0;
    const am = Math.min(1, pose.u * 1.4);
    const blendCol = C_CREAM.clone().lerp(C_AMBER, am);
    const topCol = C_TOP.clone().lerp(C_AMBER_HI, am);
    const v = new THREE.Vector3(), nrm = new THREE.Vector3();
    const P = this.pos, N = this.nor, Cc = this.col, E = this.edge;
    const endW = 10 * (1 - Math.min(1, pose.u * 3 + pose.fly * 3));
    let k = 0;
    const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, ex: number, ey: number, ez: number) => {
      v.set(x, y, z);
      nrm.set(nx, ny, nz);
      if (flying) {
        v.applyQuaternion(q).add(o);
        nrm.applyQuaternion(q);
      } else {
        v.applyQuaternion(qStrip).add(pose.F);
        nrm.applyQuaternion(qStrip);
      }
      P[k] = v.x;
      P[k + 1] = v.y;
      P[k + 2] = v.z;
      N[k] = nrm.x;
      N[k + 1] = nrm.y;
      N[k + 2] = nrm.z;
      Cc[k] = c.r;
      Cc[k + 1] = c.g;
      Cc[k + 2] = c.b;
      E[k] = ex * edgeScale;
      E[k + 1] = ey * edgeScale;
      E[k + 2] = ez * edgeScale;
      k += 3;
    };
    // local point of the wall at (A, Y, n)
    const wall = (A: number, Y: number, n: number, out: number[]) => {
      if (flying) {
        out[0] = A * sa;
        out[1] = Y * sy;
        out[2] = n * sn;
        out[3] = 0;
        out[4] = 0;
        out[5] = 1;
        return;
      }
      const a = A * L;
      let px: number, pz: number, nx: number, nz: number;
      if (kap > 1e-5) {
        const th = kap * a;
        px = Math.sin(th) / kap;
        pz = (Math.cos(th) - 1) / kap;
        nx = Math.sin(th);
        nz = Math.cos(th);
      } else {
        px = a;
        pz = 0;
        nx = 0;
        nz = 1;
      }
      out[0] = px + nx * n * tt;
      out[1] = Y * hh;
      out[2] = pz + nz * n * tt;
      out[3] = nx;
      out[4] = 0;
      out[5] = nz;
    };
    const w: number[] = [0, 0, 0, 0, 0, 0], w2: number[] = [0, 0, 0, 0, 0, 0];
    const H = flying ? sy : hh, LA = flying ? sa : L;
    for (let side = 0; side < 4; side++) {
      for (let j = 0; j <= S; j++) {
        const A = -0.5 + j / S;
        const endD = (0.5 - Math.abs(A)) * LA + endW;
        for (let r = 0; r < 2; r++) {
          let Y: number, n: number, c: THREE.Color, ex: number, ey: number;
          if (side === 0) {
            Y = r;
            n = 0.5;
            c = blendCol;
            ex = (1 - Y) * H;
            ey = Y * H;
          } else if (side === 1) {
            Y = 1;
            n = 0.5 - r;
            c = topCol;
            ex = 99;
            ey = 99;
          } else if (side === 2) {
            Y = 1 - r;
            n = -0.5;
            c = C_AMBER;
            ex = (1 - Y) * H;
            ey = 99;
          } else {
            Y = 0;
            n = -0.5 + r;
            c = C_BOT;
            ex = 99;
            ey = 99;
          }
          wall(A, Y, n, w);
          let nx = w[3] * Math.sign(n || 1), ny = 0, nz = w[5] * Math.sign(n || 1);
          if (side === 1) (nx = 0), (ny = 1), (nz = 0);
          if (side === 3) (nx = 0), (ny = -1), (nz = 0);
          if (flying && (side === 0 || side === 2)) (nx = 0), (ny = 0), (nz = side === 0 ? 1 : -1);
          put(w[0], w[1], w[2], nx, ny, nz, c, ex, ey, side === 0 ? endD : 99);
        }
      }
    }
    // end caps (only matter once unrolled)
    for (const A of [-0.5, 0.5]) {
      const corners: [number, number][] = [[0, -0.5], [0, 0.5], [1, 0.5], [1, -0.5]];
      for (const [Y, n] of corners) {
        wall(A, Y, n, w2);
        const tx = flying ? 1 : Math.cos(kap * A * L), tz = flying ? 0 : -Math.sin(kap * A * L);
        put(w2[0], w2[1], w2[2], tx * Math.sign(A), 0, tz * Math.sign(A), C_AMBER, 99, 99, 99);
      }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.edge as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ───────────────────────── the scene ─────────────────────────

interface DialParts {
  g: THREE.Group;
  face: THREE.CanvasTexture;
  needle: THREE.Group;
  pointer: THREE.Group;
  lamp: THREE.MeshStandardMaterial;
  range: number;
  title: string;
}

export class Scene3D implements View {
  readonly kind = "webgl" as const;
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();
  private W = 1;
  private H = 1;
  private layout: Layout = { x: 0, y: 0, w: 1, h: 1, phone: false };
  private bench: Bench = makeBench(1, false);
  private benchS = 1;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private idle = 0;
  private interacting = false;
  private zoom = 1;
  private time = 0;
  private route: "slabs" | "rings" = "slabs";
  private fitCache = new Map<string, { c: THREE.Vector3; d: number }>();
  private camCentre = new THREE.Vector3();
  private camDist = 10;

  private benchMesh: THREE.Mesh;
  private plate: THREE.Mesh;
  private hill: THREE.Mesh;
  private ghost: THREE.Mesh;
  private slabMesh: THREE.InstancedMesh;
  private rings: RingMesh[] = [];
  private ringMat: THREE.MeshStandardMaterial;
  private ringKeyBase = "";
  private trayG = new THREE.Group();
  private trayTex: THREE.CanvasTexture;
  private trayKey = "";
  private gaugeBar: THREE.Mesh;
  private piLine: THREE.Mesh;
  private gaugeLamp: THREE.MeshStandardMaterial;
  private dialA: DialParts;
  private dialB: DialParts;
  private odoG = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private darts: THREE.InstancedMesh;
  private dartsKey = "";
  private erfLine: THREE.Mesh;
  private erfKey = "";
  private anchorPts: Record<string, THREE.Vector3 | null> = {};
  private raycaster = new THREE.Raycaster();
  private brass: THREE.MeshStandardMaterial;

  private tight = false;
  constructor(host: HTMLElement, opts: { hq?: boolean; tight?: boolean } = {}) {
    this.tight = !!opts.tight;
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    this.canvas = canvas;
    const mobile = Math.min(innerWidth, innerHeight) < 600;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false, preserveDrawingBuffer: !!opts.hq });
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2));

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.38;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.6;
    this.controls.addEventListener("start", () => {
      this.interacting = true;
      this.poke();
    });
    this.controls.addEventListener("end", () => {
      this.interacting = false;
      this.zoom = this.camera.position.distanceTo(this.controls.target) / Math.max(1e-3, this.camDist);
      this.poke();
    });

    const webkitOnly = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent);
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: webkitOnly ? 0 : mobile ? 2 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // high threshold: only the indicator lamps glow; data surfaces stay crisp
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.4, 4.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const scene = this.scene;
    scene.background = backdropTex();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.5;
    room.dispose?.();
    pmrem.dispose();

    const key = new THREE.DirectionalLight("#ffe2b8", 3.0);
    key.position.set(-4.5, 10, 6.5);
    key.castShadow = true;
    const sm = opts.hq ? 2048 : mobile ? 1024 : 2048;
    key.shadow.mapSize.set(sm, sm);
    const sc = key.shadow.camera;
    sc.left = -8;
    sc.right = 8;
    sc.top = 7;
    sc.bottom = -7;
    sc.near = 2;
    sc.far = 30;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight("#6fd3d0", 1.1);
    rim.position.set(4, 4.5, -8);
    scene.add(rim);
    const fill = new THREE.DirectionalLight("#ffd9a8", 0.35);
    fill.position.set(5, 2.5, 7);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight("#d9d4c8", "#3a2616", 0.75));
    scene.add(this.root);

    // materials
    this.brass = new THREE.MeshStandardMaterial({ color: "#d4a955", metalness: 1, roughness: 0.32 });
    const brass = this.brass;
    const brassDark = new THREE.MeshStandardMaterial({ color: "#8e6a2e", metalness: 1, roughness: 0.42 });
    const black = new THREE.MeshStandardMaterial({ color: "#111111", roughness: 0.7, metalness: 0 });

    // bench
    const wood = walnutTex();
    wood.repeat.set(2, 1.4);
    this.benchMesh = new THREE.Mesh(new RoundedBoxGeometry(1, 0.4, 1, 3, 0.04), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.6, metalness: 0, color: "#9a7556", envMapIntensity: 0.45 }));
    this.benchMesh.receiveShadow = true;
    this.root.add(this.benchMesh);

    // brass plate (top face textured with the engraved grid)
    const ptex = plateTex();
    const plateMats = [brassDark, brassDark, new THREE.MeshStandardMaterial({ map: ptex, metalness: 0.7, roughness: 0.5, color: "#b49668", envMapIntensity: 0.55 }), brassDark, brassDark, brassDark];
    this.plate = new THREE.Mesh(new THREE.BoxGeometry(1, PLATE_T, 1), plateMats);
    this.plate.receiveShadow = true;
    this.plate.castShadow = true;
    this.root.add(this.plate);

    // hill
    this.hill = new THREE.Mesh(hillGeometry(), hillMaterial());
    this.hill.castShadow = true;
    this.hill.receiveShadow = true;
    this.root.add(this.hill);
    // a faint ghost of the whole hill while it is peeled into rings
    const ghostMat = hillMaterial();
    ghostMat.transparent = true;
    ghostMat.opacity = 0.16;
    ghostMat.depthWrite = false;
    ghostMat.customProgramCacheKey = () => "hill-ghost";
    this.ghost = new THREE.Mesh(this.hill.geometry, ghostMat);
    this.ghost.renderOrder = 2;
    this.root.add(this.ghost);

    // slabs
    const slabMat = outlinedMaterial({ color: "#ffffff", roughness: 0.86, metalness: 0, envMapIntensity: 0.15, emissive: "#3a352a" }, true);
    this.slabMesh = new THREE.InstancedMesh(slabGeometry(), slabMat, MAX_SLICES);
    this.slabMesh.castShadow = true;
    this.slabMesh.receiveShadow = true;
    this.slabMesh.count = 0;
    this.slabMesh.frustumCulled = false;
    for (let i = 0; i < MAX_SLICES; i++) this.slabMesh.setColorAt(i, C_CREAM);
    this.root.add(this.slabMesh);

    // rings
    this.ringMat = outlinedMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.84, metalness: 0, envMapIntensity: 0.15, emissive: "#2e2a20", side: THREE.DoubleSide });

    // tray
    this.trayTex = canvasTex(1400, 1000, () => {});
    const trayMats = [brassDark, brassDark, brassDark, brassDark, new THREE.MeshStandardMaterial({ map: this.trayTex, roughness: 0.92, metalness: 0, envMapIntensity: 0.1, color: "#cfc4aa" }), brassDark];
    const trayPlate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), trayMats);
    trayPlate.name = "trayPlate";
    trayPlate.receiveShadow = true;
    trayPlate.castShadow = true;
    this.trayG.add(trayPlate);
    const rimMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), brass);
    rimMesh.name = "trayLip";
    this.trayG.add(rimMesh);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), brassDark);
    legs.name = "trayLeg";
    legs.castShadow = true;
    this.trayG.add(legs);
    this.root.add(this.trayG);
    this.gaugeBar = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), outlinedMaterial({ color: "#c97f22", roughness: 0.8, metalness: 0 }));
    this.gaugeBar.geometry.setAttribute("edge", this.boxEdgeAttr(this.gaugeBar.geometry));
    this.root.add(this.gaugeBar);
    this.piLine = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#e8c06a", metalness: 1, roughness: 0.25 }));
    this.root.add(this.piLine);
    this.gaugeLamp = new THREE.MeshStandardMaterial({ color: "#2a3320", emissive: LIME, emissiveIntensity: 0, roughness: 0.4 });
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), this.gaugeLamp);
    gl.name = "gaugeLamp";
    this.root.add(gl);

    // dials
    this.dialA = this.makeDial("SLABS", brass, brassDark, black);
    this.dialB = this.makeDial("RINGS", brass, brassDark, black);

    // odometer
    this.makeOdometer(brass, brassDark);

    // darts
    this.darts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 8), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, emissive: "#000000" }), 2000);
    this.darts.count = 0;
    this.darts.frustumCulled = false;
    this.root.add(this.darts);

    // erf curve along the spotlight slab
    this.erfLine = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: "#0f5f5a" }));
    this.erfLine.visible = false;
    this.root.add(this.erfLine);

    this.applyBench(1, false);
    this.precompile();
  }

  /** Compile every program up front so no frame stalls the first time slabs, cups or darts appear. */
  private precompile(): void {
    const warm = new RingMesh(this.ringMat, this.root);
    warm.alloc(14);
    warm.mesh.visible = true;
    this.rings.push(warm);
    this.slabMesh.count = 1;
    this.darts.count = 1;
    const vis = [this.hill, this.ghost, this.slabMesh, this.darts, this.erfLine];
    const was = vis.map((o) => o.visible);
    vis.forEach((o) => (o.visible = true));
    try {
      this.renderer.compile(this.scene, this.camera);
    } finally {
      vis.forEach((o, i) => (o.visible = was[i]));
      warm.mesh.visible = false;
      this.slabMesh.count = 0;
      this.darts.count = 0;
    }
  }

  private boxEdgeAttr(geo: THREE.BufferGeometry): THREE.BufferAttribute {
    // per-vertex distance-to-edge is not linear on a 4-vertex box face; the gauge just gets a dark top line via scale
    const n = geo.attributes.position.count;
    return new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(99), 3);
  }

  private makeDial(title: string, brass: THREE.Material, brassDark: THREE.Material, black: THREE.Material): DialParts {
    const g = new THREE.Group();
    const R = 0.28;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.8, R * 0.95, 0.08, 40), brassDark);
    base.position.y = 0.04;
    base.castShadow = true;
    base.receiveShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.22, 16), brass);
    post.position.y = 0.18;
    post.castShadow = true;
    const head = new THREE.Group();
    head.position.y = 0.3 + R;
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.08, R * 1.08, 0.1, 56).rotateX(Math.PI / 2), brass);
    bezel.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.04, 0.025, 12, 56), brass);
    ring.position.z = 0.05;
    const tex = canvasTex(512, 512, (c, w) => dialFace(c, w, title, 4));
    const face = new THREE.Mesh(new THREE.CircleGeometry(R, 56), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, envMapIntensity: 0.1 }));
    face.position.z = 0.051;
    const needle = new THREE.Group();
    const nm = new THREE.Mesh(new THREE.BoxGeometry(0.018, R * 0.86, 0.01).translate(0, R * 0.33, 0), black);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20).rotateX(Math.PI / 2), black);
    needle.add(nm, hub);
    needle.position.z = 0.065;
    const pointer = new THREE.Group();
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 3).rotateZ(Math.PI), new THREE.MeshStandardMaterial({ color: "#e8c06a", metalness: 1, roughness: 0.25 }));
    tri.position.y = R * 0.98;
    pointer.add(tri);
    pointer.position.z = 0.07;
    const lampMat = new THREE.MeshStandardMaterial({ color: "#2a3320", emissive: LIME, emissiveIntensity: 0, roughness: 0.4 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), lampMat);
    lamp.position.set(0, -R * 1.22, 0.03);
    head.add(bezel, ring, face, needle, pointer, lamp);
    g.add(base, post, head);
    this.root.add(g);
    return { g, face: tex, needle, pointer, lamp: lampMat, range: 4, title };
  }

  private makeOdometer(brass: THREE.Material, brassDark: THREE.Material): void {
    const g = this.odoG;
    const W = 1.0, Hh = 0.27, D = 0.3;
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, Hh, D, 3, 0.03), brass);
    body.position.y = 0.06 + Hh / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    const foot = new THREE.Mesh(new RoundedBoxGeometry(W * 1.08, 0.06, D * 1.2, 2, 0.02), brassDark);
    foot.position.y = 0.03;
    foot.castShadow = true;
    foot.receiveShadow = true;
    const win = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, Hh * 0.56, 0.02), new THREE.MeshStandardMaterial({ color: "#16120c", roughness: 0.9 }));
    win.position.set(0, body.position.y + 0.02, D / 2 + 0.002);
    g.add(body, foot, win);
    const tex = wheelTex();
    tex.wrapT = THREE.RepeatWrapping;
    const n = 6;
    const ww = (W * 0.8) / (n + 0.4);
    for (let i = 0; i < n; i++) {
      const t = tex.clone();
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1, 0.13);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ww * 0.84, Hh * 0.48), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, metalness: 0, envMapIntensity: 0.1 }));
      const x = -W * 0.4 + ww * (i + 0.5) + (i >= 1 ? ww * 0.4 : 0);
      m.position.set(x, body.position.y + 0.02, D / 2 + 0.013);
      g.add(m);
      this.wheels.push(m);
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshStandardMaterial({ color: "#f2ead6", roughness: 0.6 }));
    dot.position.set(-W * 0.4 + ww * 1.2, body.position.y - 0.045, D / 2 + 0.02);
    g.add(dot);
    const plaque = canvasTex(512, 64, (c, w, h) => {
      c.fillStyle = "#c9a24f";
      c.fillRect(0, 0, w, h);
      c.textAlign = "center";
      c.textBaseline = "middle";
      engraveText(c, "AREA  I = √(VOLUME)", w / 2, h / 2, 34);
    });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, W * 0.1), new THREE.MeshStandardMaterial({ map: plaque, metalness: 0.6, roughness: 0.45 }));
    pl.position.set(0, body.position.y - Hh * 0.37, D / 2 + 0.003);
    g.add(pl);
    this.root.add(g);
  }

  // ───────────────────────── layout ─────────────────────────

  private applyBench(s: number, phone: boolean): void {
    const b = makeBench(s, phone);
    this.bench = b;
    this.benchS = s;
    this.benchMesh.scale.set(b.benchW, 1, b.benchD);
    this.benchMesh.position.set(b.benchC[0], -0.2, b.benchC[2]);
    const pw = 2 * b.P;
    this.plate.scale.set(pw, 1, pw);
    this.plate.position.set(0, PLATE_T / 2, 0);
    this.hill.scale.set(K * s, HW, K * s);
    this.hill.position.set(0, Y0 + 0.001, 0);
    const t = b.tray;
    const tp = this.trayG.getObjectByName("trayPlate")!;
    tp.scale.set(t.w, t.h, 1);
    tp.position.set(...t.centre);
    tp.position.addScaledVector(new THREE.Vector3(...t.n), -0.026);
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...t.ax), new THREE.Vector3(...t.up), new THREE.Vector3(...t.n));
    tp.quaternion.setFromRotationMatrix(basis);
    const lip = this.trayG.getObjectByName("trayLip")!;
    lip.quaternion.copy(tp.quaternion);
    lip.scale.set(t.w + 0.04, 0.05, 0.12);
    lip.position.set(...t.centre).addScaledVector(new THREE.Vector3(...t.up), -t.h / 2).addScaledVector(new THREE.Vector3(...t.n), 0.02);
    const leg = this.trayG.getObjectByName("trayLeg")!;
    const top = new THREE.Vector3(...t.centre).addScaledVector(new THREE.Vector3(...t.up), t.h * 0.3).addScaledVector(new THREE.Vector3(...t.n), -0.06);
    leg.position.set(top.x, top.y / 2, top.z);
    leg.scale.set(t.w * 0.5, top.y, 0.05);
    leg.rotation.set(0, t.yaw, 0);
    const placeDial = (d: DialParts, p: V3) => {
      d.g.position.set(...p);
      d.g.rotation.y = b.dials.yaw;
      d.g.visible = !phone;
    };
    placeDial(this.dialA, b.dials.a);
    placeDial(this.dialB, b.dials.b);
    this.odoG.position.set(...b.odo.p);
    this.odoG.rotation.y = b.odo.yaw;
    this.odoG.visible = !phone;
    this.fitCache.clear();
    this.trayKey = "";
    this.ringKeyBase = "";
  }

  resize(w: number, h: number, layout: Layout): void {
    this.W = w;
    this.H = h;
    const was = this.layout.phone;
    this.layout = layout;
    if (was !== layout.phone) this.applyBench(this.benchS, layout.phone);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.bloom.resolution.set(Math.max(64, Math.round((w * pr) / 2)), Math.max(64, Math.round((h * pr) / 2)));
    this.camera.aspect = w / h;
    const cxp = layout.x + layout.w / 2, cyp = layout.y + layout.h / 2;
    this.camera.setViewOffset(w, h, w / 2 - cxp, h / 2 - cyp, w, h);
    this.camera.updateProjectionMatrix();
    this.fitCache.clear();
    if (was !== layout.phone) this.resetCamera();
  }

  /** Centre and smallest distance that keep every frame point inside the layout rectangle, from direction (az, el). */
  private fit(route: "slabs" | "rings", az: number, el: number): { c: THREE.Vector3; d: number } {
    const key = `${route}|${this.benchS.toFixed(3)}|${az.toFixed(2)}|${el.toFixed(2)}`;
    const hit = this.fitCache.get(key);
    if (hit) return hit;
    const pts = framePoints(this.bench, route, this.tight).map((p) => new THREE.Vector3(...p));
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) {
      lo.min(p);
      hi.max(p);
    }
    const c = lo.add(hi).multiplyScalar(0.5);
    c.y *= 0.7;
    const t = Math.tan(((FOV / 2) * Math.PI) / 180);
    const ax = (this.layout.w / this.W) * 0.97, ay = (this.layout.h / this.H) * 0.97;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const ok = (d: number) => {
      const cam = c.clone().addScaledVector(dir, d);
      const inv = new THREE.Matrix4().lookAt(cam, c, new THREE.Vector3(0, 1, 0)).invert();
      for (const p of pts) {
        const v = p.clone().sub(cam).applyMatrix4(inv);
        if (v.z > -0.1) return false;
        const nx = v.x / -v.z / (t * this.camera.aspect), ny = v.y / -v.z / t;
        if (Math.abs(nx) > ax || Math.abs(ny) > ay) return false;
      }
      return true;
    };
    let a = 1, b = 120;
    for (let i = 0; i < 36; i++) {
      const m = (a + b) / 2;
      if (ok(m)) b = m;
      else a = m;
    }
    const r = { c, d: b };
    if (this.fitCache.size > 200) this.fitCache.clear();
    this.fitCache.set(key, r);
    return r;
  }

  resetCamera(model?: Model): void {
    if (model) {
      this.route = model.mode === "rings" || model.show === "rings" ? "rings" : "slabs";
      if (Math.abs(model.s - this.benchS) > 1e-6) this.applyBench(model.s, this.layout.phone);
    }
    const b = this.bench;
    const f = this.fit(this.route, b.az, b.el);
    this.camCentre.copy(f.c);
    this.camDist = f.d;
    this.zoom = 1;
    this.controls.target.copy(f.c);
    const dir = new THREE.Vector3(Math.sin(b.az) * Math.cos(b.el), Math.sin(b.el), Math.cos(b.az) * Math.cos(b.el));
    this.camera.position.copy(f.c).addScaledVector(dir, f.d);
    this.controls.minAzimuthAngle = b.az - 1.0;
    this.controls.maxAzimuthAngle = b.az + 1.0;
    this.controls.minDistance = f.d * 0.5;
    this.controls.maxDistance = f.d * 1.8;
    this.idle = 0;
    this.drift = 0;
    this.controls.update();
  }
  cameraPose(): number[] {
    return [...this.camera.position.toArray(), ...this.controls.target.toArray()];
  }
  setCameraPose(p: number[]): void {
    this.camera.position.fromArray(p, 0);
    this.controls.target.fromArray(p, 3);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }
  private drift = 0;
  poke(): void {
    this.idle = -6;
  }

  /** Camera only, for fast-forwarded frames that are not drawn. */
  settle(dt: number, model: Model): void {
    this.time += dt;
    if (Math.abs(model.s - this.benchS) > 1e-6) this.applyBench(model.s, this.layout.phone);
    this.updateCamera(dt, model);
  }

  /** Eases the camera to frame the active route, keeping the user's viewing direction and zoom. */
  private updateCamera(dt: number, model: Model): void {
    const route = model.mode === "rings" || model.show === "rings" ? "rings" : "slabs";
    this.route = route;
    const b = this.bench;
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    const el = Math.PI / 2 - sph.phi;
    const f = this.fit(route, b.az, b.el);
    if (!this.interacting) {
      const k = 1 - Math.exp(-dt * 2.2);
      this.camCentre.lerp(f.c, k);
      this.camDist += (f.d - this.camDist) * k;
      this.controls.target.copy(this.camCentre);
      // idle drift: a slow sway in azimuth, never under a hand, never with reduced motion
      this.idle += dt;
      let dAz = 0;
      if (!this.reduced && this.idle > 0) {
        const nd = 0.07 * Math.sin(this.time * 0.18);
        dAz = (nd - this.drift) * Math.min(1, this.idle / 3);
        this.drift += dAz;
      }
      const dist = this.camDist * this.zoom;
      const az = sph.theta + dAz;
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
      this.controls.minDistance = f.d * 0.5;
      this.controls.maxDistance = f.d * 1.8;
    }
    this.controls.update();
  }

  // ───────────────────────── per-frame ─────────────────────────

  render(dt: number, model: Model): void {
    this.time += dt;
    const s = model.s;
    if (Math.abs(s - this.benchS) > 1e-6) this.applyBench(s, this.layout.phone);
    const b = this.bench;
    const show = model.show;
    const N = model.slices;
    const phone = this.layout.phone;

    this.hill.visible = show === "hill";
    this.ghost.visible = show === "rings";
    this.ghost.scale.copy(this.hill.scale);
    this.ghost.position.copy(this.hill.position);

    // slabs
    const SL = model.slabList;
    const hl = model.highlight;
    if (show === "slabs") {
      const m4 = new THREE.Matrix4();
      const thick = K * SL[0].dx * 0.8;
      for (let i = 0; i < N; i++) {
        const sl = SL[i];
        const x = slabX(sl.x, s, model.fan, phone);
        m4.makeScale(thick, HW * sl.height, K * s);
        m4.setPosition(x, Y0, 0);
        this.slabMesh.setMatrixAt(i, m4);
        this.slabMesh.setColorAt(i, i === hl ? new THREE.Color(LIME) : C_CREAM);
      }
      this.slabMesh.count = N;
      this.slabMesh.instanceMatrix.needsUpdate = true;
      if (this.slabMesh.instanceColor) this.slabMesh.instanceColor.needsUpdate = true;
      this.slabMesh.computeBoundingSphere();
      this.slabMesh.visible = true;
    } else this.slabMesh.visible = false;

    // rings
    this.updateRings(model, b);

    // tray, gauge and readouts
    this.updateTray(model, b);
    this.updateDial(this.dialA, model.slabNeedle.v, s, dt, model.slabsMeasured && Math.abs(model.slabNeedle.v - Math.PI * s * s) < 5e-4 * Math.PI * s * s);
    this.updateDial(this.dialB, model.ringNeedle.v, s, dt, model.ringsMeasured && Math.abs(model.ringNeedle.v - Math.PI * s * s) < 5e-4 * Math.PI * s * s);
    const wheels = odoWheels(model.odo.v);
    for (let i = 0; i < this.wheels.length; i++) {
      const map = (this.wheels[i].material as THREE.MeshStandardMaterial).map!;
      map.offset.y = (wheels[i] + 0.5) / 10 - map.repeat.y / 2;
    }

    this.updateDarts(model);
    this.updateErf(model, b);
    this.computeAnchors(model, b);

    this.updateCamera(dt, model);
    this.composer.render(dt);
  }

  private ringBar(t: Bench["tray"], r: number, dr: number, perRadius: number, s: number) {
    const fr = r / (HALF * s);
    const barW = (dr / (HALF * s)) * t.gw * 0.86;
    const barH = Math.max(0.002, (perRadius / s / VMAX) * t.gh);
    const base = new THREE.Vector3(...trayPoint(t, fr, 0, 0.012));
    const up = new THREE.Vector3(...t.up);
    const o = base.clone().addScaledVector(up, barH / 2);
    const basis = new THREE.Matrix4().makeBasis(up, new THREE.Vector3(...t.ax).negate(), new THREE.Vector3(...t.n));
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    // bar origin is its (A=0, Y=0) point: middle of the length, at the -ax side → shift by +ax·barW/2
    o.addScaledVector(new THREE.Vector3(...t.ax), barW / 2);
    return { o, q, sa: barH, sy: barW, sn: 0.02 };
  }

  private updateRings(model: Model, b: Bench): void {
    const s = model.s;
    const N = model.slices;
    const R = model.ringList;
    const active = model.show === "rings";
    while (this.rings.length < (active ? N : 0)) this.rings.push(new RingMesh(this.ringMat, this.root));
    const camAz = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
    const base = `${model.cutVersion}|${s.toFixed(4)}|${b.phone}`;
    if (base !== this.ringKeyBase) {
      this.ringKeyBase = base;
      for (const r of this.rings) r.key = "";
    }
    for (let i = 0; i < this.rings.length; i++) {
      const rm = this.rings[i];
      if (!active || i >= N) {
        rm.mesh.visible = false;
        continue;
      }
      const q = R[i];
      const phi = model.ringPhase(i);
      rm.mesh.visible = true;
      rm.mesh.castShadow = N <= 60;
      // stages: lift 0–.14, unroll .14–.5, fly .5–LANDED
      const lift = ease(phi / 0.14);
      const u = ease((phi - 0.14) / 0.36);
      const fly = Math.max(0, Math.min(1, (phi - 0.5) / (LANDED - 0.5)));
      const rw = K * q.r, tw = K * q.dr * 0.92, hw = HW * q.height;
      const key = phi <= 0 ? `nest` : phi >= LANDED ? `bar` : `${phi.toFixed(4)}|${camAz.toFixed(3)}`;
      if (key === rm.key && (phi <= 0 || phi >= LANDED)) continue;
      rm.key = key;
      const smax = Math.max(40, Math.min(120, Math.round(6000 / N)));
      const S = Math.max(14, Math.min(smax, Math.round(14 + (q.r / (HALF * s)) * 110)));
      rm.alloc(S);
      const yaw = phi <= 0 ? 0 : camAz;
      const L = 2 * Math.PI * rw;
      const sig = 1 - (1 - Math.min(1, 1.9 / L)) * u;
      const F = new THREE.Vector3(Math.sin(yaw) * rw, Y0 + lift * (0.5 + HW * 0.15), Math.cos(yaw) * rw);
      // as it unrolls, slide the strip out in front of the hill so the hill doesn't hide it
      const out = u * (K * HALF * s * 0.35 + 0.25);
      F.x += Math.sin(yaw) * out;
      F.z += Math.cos(yaw) * out;
      F.y += u * 0.15;
      const bar = this.ringBar(b.tray, q.r, q.dr, q.perRadius, s);
      // thin outlines on thin risers: scale the edge distances so the ink line is ≤ 35% of the step height
      const inner = i > 0 ? R[i - 1].height : 1;
      const riser = Math.max(1e-4, HW * (inner - q.height));
      const ew = Math.min(EDGE_W, riser * 0.35 + (phi > 0 ? EDGE_W : 0));
      rm.update(rw, tw, hw, { u, F, yaw, sig, fly: phi >= LANDED ? 1 : fly, lift }, bar, EDGE_W / Math.max(1e-4, ew));
    }
  }

  private updateTray(model: Model, b: Bench): void {
    const s = model.s;
    const t = b.tray;
    const key = `${s.toFixed(3)}|${b.phone}`;
    if (key !== this.trayKey) {
      this.trayKey = key;
      redraw(this.trayTex, (g, w, h) => this.drawTray(g, w, h, s));
    }
    // running total bar in the gauge column, climbing toward the π line
    const v = Math.max(0, model.ringNeedle.v) / (Math.PI * s * s);
    const gh = Math.max(0.002, Math.min(1.25, v / GMAX) * t.gh);
    const fr = t.gx / t.gw;
    const base = new THREE.Vector3(...trayPoint(t, fr, 0, 0.02));
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...t.ax), new THREE.Vector3(...t.up), new THREE.Vector3(...t.n));
    this.gaugeBar.quaternion.setFromRotationMatrix(basis);
    this.gaugeBar.position.copy(base).addScaledVector(new THREE.Vector3(...t.ax), t.gwid / 2);
    this.gaugeBar.scale.set(t.gwid, gh, 0.03);
    this.gaugeBar.visible = model.show === "rings" || model.ringsMeasured;
    const piP = new THREE.Vector3(...trayPoint(t, fr, 1 / GMAX, 0.03)).addScaledVector(new THREE.Vector3(...t.ax), t.gwid / 2);
    this.piLine.position.copy(piP);
    this.piLine.quaternion.copy(this.gaugeBar.quaternion);
    this.piLine.scale.set(t.gwid * 1.7, 0.016, 0.02);
    const lamp = this.root.getObjectByName("gaugeLamp")!;
    lamp.position.copy(new THREE.Vector3(...trayPoint(t, fr, 1.12, 0.05)).addScaledVector(new THREE.Vector3(...t.ax), t.gwid / 2));
    const near = model.show === "rings" && model.peelDone && Math.abs(v - 1) < 5e-4;
    this.gaugeLamp.emissiveIntensity += ((near ? 9 : 0) - this.gaugeLamp.emissiveIntensity) * 0.15;
  }

  /** The enamel graph: axes, ticks, labels, the theory curve 2π r e^(-r²/s²) and the gauge column with its π mark. */
  private drawTray(g: CanvasRenderingContext2D, w: number, h: number, s: number): void {
    const t = this.bench.tray;
    g.fillStyle = "#efe6cf";
    g.fillRect(0, 0, w, h);
    // map tray coords → texture px: graph origin at (0.1w, 0.85h)
    const X = (fr: number) => w * 0.1 + (fr * t.gw * w) / t.w;
    const Y = (fv: number) => h * 0.85 - (fv * t.gh * h) / t.h;
    g.strokeStyle = "rgba(60,45,20,0.2)";
    g.lineWidth = 2;
    for (let k = 1; k <= 6; k++) {
      g.beginPath();
      g.moveTo(X(0), Y(k / 6));
      g.lineTo(X(1), Y(k / 6));
      g.stroke();
    }
    g.strokeStyle = "#1d1912";
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(X(0), Y(1.04));
    g.lineTo(X(0), Y(0));
    g.lineTo(X(1.03), Y(0));
    g.stroke();
    g.fillStyle = "#1d1912";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.font = "700 44px ui-monospace, Menlo, monospace";
    for (let k = 0; k <= 3; k++) {
      const x = X(k / 3);
      g.fillRect(x - 3, Y(0), 6, 20);
      g.fillText(fmt(k * s), x, Y(0) + 24);
    }
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (let k = 0; k <= 3; k++) {
      const y = Y(k / VMAX);
      g.fillRect(X(0) - 20, y - 3, 20, 6);
      g.fillText(fmt(k * s), X(0) - 26, y);
    }
    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = "700 46px Georgia, serif";
    g.fillText("radius r", X(0.55), Y(0) + 76);
    g.textBaseline = "bottom";
    g.font = "italic 700 42px Georgia, serif";
    g.fillStyle = "#2b2214";
    g.fillText("ring volume per unit radius: 2π r e^(−r²)", X(0.0), Y(1.04) - 8);
    // theory curve (dashed)
    g.setLineDash([18, 12]);
    g.strokeStyle = "rgba(30,22,10,0.8)";
    g.lineWidth = 5;
    g.beginPath();
    for (let k = 0; k <= 200; k++) {
      const fr = k / 200;
      const r = fr * HALF * s;
      const f = (2 * Math.PI * r * Math.exp(-(r * r) / (s * s))) / s / VMAX;
      if (k === 0) g.moveTo(X(fr), Y(f));
      else g.lineTo(X(fr), Y(f));
    }
    g.stroke();
    g.setLineDash([]);
    // gauge column
    const gx0 = X(t.gx / t.gw), gx1 = gx0 + (t.gwid * w) / t.w;
    g.fillStyle = "rgba(30,24,14,0.14)";
    g.fillRect(gx0, Y(1), gx1 - gx0, Y(0) - Y(1));
    g.strokeStyle = "#1d1912";
    g.lineWidth = 5;
    g.strokeRect(gx0, Y(1), gx1 - gx0, Y(0) - Y(1));
    g.fillStyle = "#1d1912";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.font = "700 40px Georgia, serif";
    g.fillText("total", (gx0 + gx1) / 2, Y(0) + 24);
    const yp = Y(1 / GMAX);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = "700 64px Georgia, serif";
    g.fillStyle = "#6e4a0c";
    g.fillText(Math.abs(s - 1) < 1e-3 ? "π" : "πs²", gx1 + 14, yp);
  }

  private updateDial(d: DialParts, v: number, s: number, dt: number, lit: boolean): void {
    const range = dialRange(s);
    if (range !== d.range) {
      d.range = range;
      redraw(d.face, (g, w) => dialFace(g, w, d.title, range));
    }
    d.needle.rotation.z = -dialAngle(v, range);
    d.pointer.rotation.z = -dialAngle(Math.PI * s * s, range);
    const want = lit ? 9 : 0;
    d.lamp.emissiveIntensity += (want - d.lamp.emissiveIntensity) * Math.min(1, dt * 8 + 0.02);
  }

  private updateDarts(model: Model): void {
    const d = model.darts;
    const shown = model.dartsShown.n;
    if (!d || shown === 0) {
      this.darts.count = 0;
      this.dartsKey = "";
      return;
    }
    const key = `${model.dartThrows}|${shown}|${model.s}`;
    if (key === this.dartsKey) return;
    const start = this.dartsKey.startsWith(`${model.dartThrows}|`) ? this.darts.count : 0;
    this.dartsKey = key;
    const m4 = new THREE.Matrix4();
    const lime = new THREE.Color(LIME), grey = new THREE.Color("#4a5160");
    for (let i = start; i < shown; i++) {
      m4.makeTranslation(K * d.pts[i * 4], Y0 + 0.004, K * d.pts[i * 4 + 1]);
      this.darts.setMatrixAt(i, m4);
      this.darts.setColorAt(i, d.pts[i * 4 + 3] ? lime : grey);
    }
    this.darts.count = shown;
    this.darts.instanceMatrix.needsUpdate = true;
    if (this.darts.instanceColor) this.darts.instanceColor.needsUpdate = true;
  }

  private updateErf(model: Model, b: Bench): void {
    const on = model.showErf && model.show === "slabs";
    this.erfLine.visible = on;
    if (!on) return;
    const s = model.s;
    const i = model.focusSlab;
    const sl = model.slabList[i];
    const x = slabX(sl.x, s, model.fan, b.phone);
    const thick = K * sl.dx * 0.8;
    const key = `${i}|${s}|${x.toFixed(4)}|${model.slices}`;
    if (key === this.erfKey) return;
    this.erfKey = key;
    const pts: THREE.Vector3[] = [];
    // on the face toward the camera (−x on the desk, +z-ish on phone: both see the −x face)
    const fx = x - thick / 2 - 0.006;
    for (let k = 0; k <= 80; k++) {
      const y = -HALF * s + (2 * HALF * s * k) / 80;
      const frac = (1 + erf(y / s)) / 2;
      pts.push(new THREE.Vector3(fx, Y0 + HW * sl.height * frac, K * y));
    }
    this.erfLine.geometry.dispose();
    this.erfLine.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.011, 6, false);
  }

  private computeAnchors(model: Model, b: Bench): void {
    const s = model.s;
    const A = this.anchorPts;
    for (const k of Object.keys(A)) A[k] = null;
    if (model.show === "slabs") {
      const SL = model.slabList;
      const j = Math.max(0, Math.min(SL.length - 1, Math.floor(SL.length * 0.35)));
      A.slabs = new THREE.Vector3(slabX(SL[j].x, s, model.fan, b.phone), Y0 + HW * SL[j].height, 0);
      const hl = model.highlight;
      if (hl >= 0) A.hl = new THREE.Vector3(slabX(SL[hl].x, s, model.fan, b.phone), Y0 + HW * SL[hl].height + 0.02, 0);
    }
    if (model.show === "rings") {
      const R = model.ringList;
      // the outermost ring still nested, else the hill top
      let j = -1;
      for (let i = R.length - 1; i >= 0; i--) if (model.ringPhase(i) <= 0) {
        j = i;
        break;
      }
      if (j >= 0) {
        const camAz = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
        const rw = K * R[Math.max(0, Math.floor(j * 0.6))].r;
        A.rings = new THREE.Vector3(Math.sin(camAz - 0.6) * rw, Y0 + HW * R[Math.floor(j * 0.6)].height, Math.cos(camAz - 0.6) * rw);
      }
    }
    const t = b.tray;
    if (model.show === "rings" || b.phone) {
      A.tray = new THREE.Vector3(...trayPoint(t, 0.3, 0.75, 0.02));
      A.total = new THREE.Vector3(...trayPoint(t, (t.gx + t.gwid) / t.gw, 1 / GMAX, 0.03));
    }
    if (!b.phone) {
      A.dialA = new THREE.Vector3(...b.dials.a).add(new THREE.Vector3(0, 0.3 + 0.28 * 2.1, 0));
      A.dialB = new THREE.Vector3(...b.dials.b).add(new THREE.Vector3(0, 0.3 + 0.28 * 2.1, 0));
      A.odo = new THREE.Vector3(...b.odo.p).add(new THREE.Vector3(0, 0.33, 0));
    }
  }

  anchors(): Anchors {
    const out: Anchors = {};
    for (const [k, p] of Object.entries(this.anchorPts)) if (p) out[k] = this.project(p);
    return out;
  }

  private project(p: THREE.Vector3): Anchor {
    this.camera.updateMatrixWorld();
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.W, y: ((1 - v.y) / 2) * this.H, on: v.z < 1 && v.z > -1 };
  }

  pick(x: number, y: number, model: Model): number {
    if (model.show !== "slabs" || !this.slabMesh.visible) return -1;
    this.camera.updateMatrixWorld();
    const ndc = new THREE.Vector2((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.slabMesh, false)[0];
    return hit?.instanceId ?? -1;
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1));
