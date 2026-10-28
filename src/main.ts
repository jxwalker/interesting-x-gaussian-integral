import "./styles.css";
import { HALF, ballPeak, ballVolume, bellArea, convergenceTable, gamma } from "./bell";
import { DEFAULTS, MAX_SLICES, MIN_SLICES, Model, N_DARTS } from "./model";
import { Scene2D } from "./scene2d";
import { selfTest, type Check } from "./selftest";
import { dialAngle, dialRange, fx, type Anchors, type Layout, type View } from "./view";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const recording = params.get("record") === "1";
if (recording) document.documentElement.classList.add("ix-record");
// ?og=1: the social card — title, caption and the instrument only
const og = params.get("og") === "1";
if (og) document.documentElement.classList.add("ix-og");
const force2d = params.get("renderer") === "2d";
const isPhone = () => innerWidth <= 760;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const model = new Model();
model.reducedMotion = reducedMotion;
const stage = $("stage");
let view: View;
let frames = 0;
let fps = 60;
let firstWow = true;

// ───────────────────────── renderer selection ─────────────────────────

async function makeWebGL(): Promise<View> {
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("webgl2") ?? probe.getContext("webgl");
  if (!ctx) throw new Error("WebGL unavailable");
  (ctx.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null)?.loseContext?.();
  const { Scene3D } = await import("./scene3d");
  return new Scene3D(stage, { hq: recording || og, tight: og });
}

function use2D(): void {
  view = new Scene2D(stage);
  $("badge").hidden = false;
  onResize();
  view.resetCamera();
}

function switchTo2D(reason: string): void {
  if (view?.kind === "2d") return;
  console.warn(`[gaussian-integral] using Canvas2D fallback: ${reason}`);
  try {
    view?.dispose();
  } catch {
    /* ignore */
  }
  stage.querySelectorAll("canvas").forEach((c) => c.remove());
  use2D();
}

async function boot(): Promise<void> {
  model.startWow();
  if (force2d) use2D();
  else {
    try {
      view = await makeWebGL();
      view.canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        switchTo2D("webglcontextlost");
      });
      onResize();
      view.resetCamera();
      view.render(0, model); // compile now so init errors surface here
    } catch (err) {
      switchTo2D(`WebGL init failed: ${(err as Error)?.message ?? err}`);
    }
  }
  readyT = performance.now();
  window.__ixRecord.ready = true;
  requestAnimationFrame(loop);
}

// ───────────────────────── layout ─────────────────────────

const dock = $("dock");
const adv = $("adv");
const intro = $("intro");
const numbers = $("numbers");
const explain = $("explain");
const strip = $("dialstrip");
const foot = document.querySelector(".credit-foot") as HTMLElement;

function placeDock(): void {
  if (isPhone()) {
    dock.style.top = "";
    strip.style.setProperty("--strip-top", `${Math.ceil(intro.getBoundingClientRect().bottom + 6)}px`);
    numbers.style.top = `${Math.ceil(strip.getBoundingClientRect().bottom + 6)}px`;
    return;
  }
  numbers.style.top = "";
  dock.style.top = `${Math.ceil(intro.getBoundingClientRect().bottom + 10)}px`;
}

function computeLayout(w: number, h: number): Layout {
  placeDock();
  if (isPhone()) {
    let top = Math.max(intro.getBoundingClientRect().bottom, strip.getBoundingClientRect().bottom) + 2;
    if (numbers.classList.contains("open")) top = Math.max(top, numbers.getBoundingClientRect().bottom + 2);
    const sheet = adv.hidden ? dock : adv;
    const bottom = Math.min(dock.getBoundingClientRect().top, sheet.getBoundingClientRect().top) - 2;
    return { x: 4, y: top, w: w - 8, h: Math.max(160, bottom - top), phone: true };
  }
  const left = dock.getBoundingClientRect().right + 6;
  const right = adv.hidden ? w - 8 : adv.getBoundingClientRect().left - 8;
  return { x: left, y: 6, w: Math.max(260, right - left), h: h - 12, phone: false };
}

let layoutKey = "";
const keyOf = (L: Layout) => `${innerWidth}|${innerHeight}|${Math.round(L.x)}|${Math.round(L.y)}|${Math.round(L.w)}|${Math.round(L.h)}`;
function onResize(): void {
  const L = computeLayout(innerWidth, innerHeight);
  layoutKey = keyOf(L);
  view?.resize(innerWidth, innerHeight, L);
}
function checkLayout(): void {
  const L = computeLayout(innerWidth, innerHeight);
  if (keyOf(L) !== layoutKey) onResize();
}
addEventListener("resize", () => onResize());
new ResizeObserver(() => onResize()).observe(intro);

// ───────────────────────── hover / tap a slab ─────────────────────────

let downAt: { x: number; y: number; t: number } | null = null;
stage.addEventListener("pointerdown", (e) => {
  view?.poke();
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
stage.addEventListener("pointerup", (e) => {
  if (!downAt || !view) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 8) return;
  const i = view.pick(e.clientX, e.clientY, model);
  model.interrupt();
  model.pick(i === model.picked ? -1 : i);
});
stage.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || e.buttons || !view) return;
  const i = view.pick(e.clientX, e.clientY, model);
  if (i !== model.hover) {
    model.hover = i;
    if (i >= 0) model.ev.pick = model.time;
  }
  stage.classList.toggle("over-slab", i >= 0);
});
stage.addEventListener("pointerleave", () => (model.hover = -1));

// ───────────────────────── controls ─────────────────────────

const slicesIn = $<HTMLInputElement>("slices");
const widthIn = $<HTMLInputElement>("width");
const dimsIn = $<HTMLInputElement>("dims");
const chkErf = $<HTMLInputElement>("show-erf");
const chkConv = $<HTMLInputElement>("show-convergence");
let slidingSlices = false;

const user = (f: () => void) => () => {
  model.interrupt();
  f();
};
slicesIn.addEventListener("pointerdown", () => (slidingSlices = true));
addEventListener("pointerup", () => (slidingSlices = false));
slicesIn.addEventListener("input", user(() => model.setSlices(+slicesIn.value)));
widthIn.addEventListener("input", user(() => {
  model.setWidth(+widthIn.value);
  model.flattenStash = null;
}));
dimsIn.addEventListener("input", user(() => model.setDims(+dimsIn.value)));
chkErf.addEventListener("change", user(() => model.setErf(chkErf.checked)));
chkConv.addEventListener("change", user(() => model.setConv(chkConv.checked)));
$("btn-mode").addEventListener("click", user(() => model.toggleMode()));
$("btn-play").addEventListener("click", () => {
  firstWow = false;
  model.startWow();
  view?.resetCamera(model);
});
$("btn-flatten").addEventListener("click", user(() => model.flatten()));
$("btn-flatten-undo").addEventListener("click", user(() => model.undoFlatten()));
$("btn-darts").addEventListener("click", user(() => {
  model.throwDarts();
  if (isPhone()) setAdv(false);
}));
$("preset-coarse").addEventListener("click", user(() => model.setSlices(6)));
$("preset-fine").addEventListener("click", user(() => model.setSlices(200)));
$("preset-textbook").addEventListener("click", user(() => {
  model.setWidth(1);
  model.flattenStash = null;
}));

function resetAll(): void {
  model.reset();
  // panels first: they change the free rectangle the camera frames into
  setAdv(false);
  setNumbers(false);
  view?.resetCamera(model);
  view?.poke();
  syncControls(true);
}
$("btn-reset").addEventListener("click", resetAll);

const advBtn = $("btn-advanced");
function setAdv(open: boolean): void {
  adv.hidden = !open;
  advBtn.setAttribute("aria-expanded", String(open));
  advBtn.classList.toggle("on", open);
  document.documentElement.classList.toggle("adv-open", open);
  onResize();
}
advBtn.addEventListener("click", () => setAdv(adv.hidden));
$("btn-adv-close").addEventListener("click", () => setAdv(false));

const sheetBtn = $("btn-sheet");
function setSheet(open: boolean): void {
  dock.classList.toggle("collapsed-phone", !open);
  sheetBtn.setAttribute("aria-expanded", String(open));
  setText($("sheet-label"), open ? "Fewer controls" : "More controls");
  onResize();
}
sheetBtn.addEventListener("click", () => setSheet(dock.classList.contains("collapsed-phone")));

const numBtn = $("btn-numbers");
function setNumbers(open: boolean): void {
  numbers.classList.toggle("open", open);
  numBtn.setAttribute("aria-expanded", String(open));
  numBtn.classList.toggle("on", open);
  onResize();
}
numBtn.addEventListener("click", () => setNumbers(!numbers.classList.contains("open")));

const setText = (e: HTMLElement, s: string) => {
  if (e.textContent !== s) e.textContent = s;
};

function syncControls(force = false): void {
  const m = model;
  if (!slidingSlices || force) {
    if (slicesIn.value !== String(m.slices)) slicesIn.value = String(m.slices);
  }
  setText($("slices-val"), String(m.slices));
  setText($("slices-desc"), m.mode === "rings" ? `${m.slices} nested rings, each ${fx((HALF * m.s) / m.slices, 3)} wide, out to radius ${fx(HALF * m.s, 1)}.` : `${m.slices} slabs, each ${fx((2 * HALF * m.s) / m.slices, 3)} thick, across the plate.`);
  if (document.activeElement !== widthIn || force) {
    if (Math.abs(+widthIn.value - m.s) > 0.004) widthIn.value = m.s.toFixed(2);
  }
  setText($("width-val"), `s = ${m.s.toFixed(2)}`);
  const sig = m.s / Math.SQRT2;
  setText($("width-desc"), `Area s√π = ${fx(m.tot.Iy, 2)}. As a normal curve σ = s/√2 = ${fx(sig, 2)}, so the area is σ√(2π): that's the 1/√(2π) in front of the bell-curve formula.`);
  const mb = $("btn-mode");
  setText(mb, m.mode === "slabs" ? "Peel into rings" : "Cut into slabs");
  if (dimsIn.value !== String(m.dims)) dimsIn.value = String(m.dims);
  setText($("dims-val"), String(m.dims));
  chkErf.checked = m.showErf;
  chkConv.checked = m.showConv;
  $("conv").hidden = !m.showConv;
  $("preset-coarse").classList.toggle("on", m.slices === 6 && !m.wowActive);
  $("preset-fine").classList.toggle("on", m.slices === 200 && !m.wowActive);
  $("preset-textbook").classList.toggle("on", Math.abs(m.s - 1) < 1e-9 && !m.wowActive);
  $("btn-flatten-undo").classList.toggle("dim", m.flattenStash === null);
  $("btn-flatten").classList.toggle("on", m.flattenStash !== null);
  $("btn-play").classList.toggle("on", m.wowActive);
}

// ───────────────────────── intro card ─────────────────────────

const helpBtn = $("btn-help");
const INTRO_KEY = "gaussian-integral:intro-seen";
let introPending = false;

function setExplain(open: boolean, remember = true): void {
  if (explain.hidden === !open) return;
  explain.hidden = !open;
  helpBtn.setAttribute("aria-expanded", String(open));
  if (open) $("btn-explain-ok").focus({ preventScroll: true });
  else if (remember) {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* private mode */
    }
  }
}
helpBtn.addEventListener("click", () => setExplain(explain.hidden));
$("btn-explain-x").addEventListener("click", () => setExplain(false));
$("btn-explain-ok").addEventListener("click", () => setExplain(false));
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !explain.hidden) setExplain(false);
});
document.addEventListener(
  "pointerdown",
  (e) => {
    const t = e.target as Node;
    if (introPending && !helpBtn.contains(t)) introPending = false;
    if (!explain.hidden && !explain.contains(t) && !helpBtn.contains(t)) setExplain(false);
  },
  true,
);
{
  let seen = false;
  try {
    seen = localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    /* ignore */
  }
  // the card waits until the opening has played, so it never hides the wow moment
  if (!seen && !recording && !og && params.get("intro") !== "0") introPending = true;
}

// ───────────────────────── labels next to the objects ─────────────────────────

interface LabelDef {
  id: string;
  anchor: string;
  cls: string;
  dir: [number, number];
  phone?: boolean;
  text: () => string | null;
}

const labelDefs: LabelDef[] = [
  { id: "slabs", anchor: "slabs", cls: "", dir: [-0.4, -1], phone: true, text: () => "Slabs: each one is a smaller bell" },
  { id: "rings", anchor: "rings", cls: "amber", dir: [-1, -0.7], phone: true, text: () => "Rings: 2π r around, e^(−r²) tall" },
  { id: "tray", anchor: "tray", cls: "amber", dir: [-0.3, -1], phone: true, text: () => "Unrolled rings" },
  { id: "total", anchor: "total", cls: "brass", dir: [1, -0.4], phone: true, text: () => (Math.abs(model.s - 1) < 1e-3 ? "Total = π" : "Total = π s²") },
  { id: "dialA", anchor: "dialA", cls: "brass", dir: [-0.2, -1], text: () => "Slab count" },
  { id: "dialB", anchor: "dialB", cls: "brass", dir: [0.3, -1], text: () => "Ring count" },
  { id: "odo", anchor: "odo", cls: "brass", dir: [0.4, -1], text: () => "Bell curve's area I" },
];

const labelsBox = $("labels");
const leaders = document.getElementById("leaders") as unknown as SVGSVGElement;
const labelEls = new Map<string, { el: HTMLElement; html: string; w: number; h: number; line: SVGLineElement; dot: SVGCircleElement }>();
for (const d of labelDefs) {
  const el = document.createElement("div");
  el.className = `lbl3d ${d.cls}`;
  labelsBox.appendChild(el);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("class", d.cls);
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("r", "2.5");
  dot.setAttribute("class", d.cls);
  leaders.append(line, dot);
  labelEls.set(d.id, { el, html: "", w: 0, h: 0, line, dot });
}

function obstacles(): DOMRect[] {
  const r: DOMRect[] = [];
  for (const el of [dock, adv, intro, explain, numbers, strip, $("badge"), foot]) if (!el.hidden && el.offsetParent !== null && getComputedStyle(el).display !== "none") r.push(el.getBoundingClientRect());
  // the gallery nav pill (bottom-left and bottom-centre)
  r.push(new DOMRect(0, innerHeight - 64, 160, 64), new DOMRect(innerWidth / 2 - 115, innerHeight - 74, 230, 74));
  return r;
}

function hide(rec: { el: HTMLElement; line: SVGLineElement; dot: SVGCircleElement }): void {
  rec.el.style.display = "none";
  rec.line.style.display = rec.dot.style.display = "none";
}

function layoutLabels(a: Anchors): void {
  const W = innerWidth, H = innerHeight;
  const phone = isPhone();
  const obs = obstacles();
  const free = computeLayout(W, H);
  const top = phone ? free.y : 4;
  type B = { id: string; x: number; y: number; w: number; h: number; ax: number; ay: number };
  const boxes: B[] = [];
  let phoneCount = 0;
  const quiet = (model.wowActive && model.wowT < 0.9) || (phone && free.h < 200);
  for (const d of labelDefs) {
    const rec = labelEls.get(d.id)!;
    const an = a[d.anchor];
    if (quiet || (phone && (!d.phone || phoneCount >= 3)) || (og && !["rings", "tray", "total"].includes(d.id))) {
      hide(rec);
      continue;
    }
    const inside = an && an.on && an.x > 2 && an.x < W - 2 && an.y > top && an.y < H - 2 && !obs.some((r) => an.x > r.left && an.x < r.right && an.y > r.top && an.y < r.bottom);
    const txt = inside ? d.text() : null;
    if (!txt) {
      hide(rec);
      continue;
    }
    if (phone) phoneCount++;
    rec.el.style.display = "";
    if (txt !== rec.html) {
      rec.el.innerHTML = txt;
      rec.html = txt;
      rec.w = rec.el.offsetWidth;
      rec.h = rec.el.offsetHeight;
    }
    let [dx, dy] = d.dir;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n;
    dy /= n;
    const off = phone ? 14 : 26;
    let x = an!.x + dx * off, y = an!.y + dy * off;
    x -= dx > 0.35 ? 0 : dx < -0.35 ? rec.w : rec.w / 2;
    y -= dy > 0.35 ? 0 : dy < -0.35 ? rec.h : rec.h / 2;
    boxes.push({ id: d.id, x, y, w: rec.w, h: rec.h, ax: an!.x, ay: an!.y });
  }
  const pad = 4;
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      const p = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        const q = boxes[j];
        const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) + pad;
        const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) + pad;
        if (ox > 0 && oy > 0) {
          moved = true;
          if (oy < ox) {
            const sg = p.y + p.h / 2 < q.y + q.h / 2 ? -1 : 1;
            p.y += sg * oy * 0.5;
            q.y -= sg * oy * 0.5;
          } else {
            const sg = p.x + p.w / 2 < q.x + q.w / 2 ? -1 : 1;
            p.x += sg * ox * 0.5;
            q.x -= sg * ox * 0.5;
          }
        }
      }
      for (const r of obs) {
        const ox = Math.min(p.x + p.w, r.right) - Math.max(p.x, r.left) + pad;
        const oy = Math.min(p.y + p.h, r.bottom) - Math.max(p.y, r.top) + pad;
        if (ox > 0 && oy > 0) {
          moved = true;
          const opts = [
            { d: r.right + pad - p.x, ax: "x" },
            { d: r.left - pad - (p.x + p.w), ax: "x" },
            { d: r.bottom + pad - p.y, ax: "y" },
            { d: r.top - pad - (p.y + p.h), ax: "y" },
          ].sort((u, v) => Math.abs(u.d) - Math.abs(v.d));
          const fits = (o: { d: number; ax: string }) => (o.ax === "x" ? p.x + o.d >= 4 && p.x + o.d <= W - p.w - 4 : p.y + o.d >= top && p.y + o.d <= H - p.h - 4);
          const o = opts.find(fits) ?? opts[0];
          if (o.ax === "x") p.x += o.d;
          else p.y += o.d;
        }
      }
      p.x = Math.max(4, Math.min(W - p.w - 4, p.x));
      p.y = Math.max(top, Math.min(H - p.h - 4, p.y));
    }
    if (!moved) break;
  }
  const hit = (b: B, x: number, y: number, w: number, h: number) => b.x < x + w - 2 && x < b.x + b.w - 2 && b.y < y + h - 2 && y < b.y + b.h - 2;
  const kept: B[] = [];
  for (const b of boxes) {
    const rec = labelEls.get(b.id)!;
    if (obs.some((r) => hit(b, r.left, r.top, r.width, r.height)) || kept.some((k) => hit(b, k.x, k.y, k.w, k.h))) {
      hide(rec);
      continue;
    }
    kept.push(b);
    rec.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)`;
    const cx = Math.max(b.x, Math.min(b.x + b.w, b.ax)), cy = Math.max(b.y, Math.min(b.y + b.h, b.ay));
    const far = Math.hypot(cx - b.ax, cy - b.ay) > 6;
    rec.line.style.display = far ? "" : "none";
    rec.dot.style.display = "";
    rec.line.setAttribute("x1", b.ax.toFixed(1));
    rec.line.setAttribute("y1", b.ay.toFixed(1));
    rec.line.setAttribute("x2", cx.toFixed(1));
    rec.line.setAttribute("y2", cy.toFixed(1));
    rec.dot.setAttribute("cx", b.ax.toFixed(1));
    rec.dot.setAttribute("cy", b.ay.toFixed(1));
  }
}

// ───────────────────────── caption ─────────────────────────

const captionText = $("caption-text");
const caption = $("caption");
let captionState = "intro";

const f5 = (v: number) => fx(v, 5);
/** 4 decimals when the sum is visibly off π s², 5 when it is close. */
const fv = (v: number, exact: number) => (Math.abs(v - exact) > 5e-4 ? fx(v, 4) : fx(v, 5));
const times = (k: number) => {
  if (Math.abs(k - 2) < 0.01) return "twice as";
  if (Math.abs(k - 0.5) < 0.01) return "half as";
  return `${fx(k, 2)} times as`;
};

function widthLine(): [string, string] {
  const m = model, s = m.s;
  const V = Math.PI * s * s;
  const I = m.tot.Iy;
  if (s > 1) return ["width", `Bell ${times(s)} wide: the hill holds ${fx(s * s, 2)} × π = ${fx(V, 2)} and the bell curve's area ${Math.abs(s - 2) < 0.01 ? "doubles" : "grows"} to ${fx(I, 2)} (${fx(s, 2)} × 1.77).`];
  if (s < 1) return ["width", `Bell ${times(s)} wide: the hill holds ${fx(s * s, 2)} × π = ${fx(V, 2)} and the bell curve's area shrinks to ${fx(I, 2)} (${fx(s, 2)} × 1.77).`];
  return ["width", `The textbook bell, s = 1: the hill holds π = ${f5(V)} and the bell curve's area is √π = ${f5(I)}.`];
}

function slabLine(): [string, string] {
  const m = model;
  const sl = m.slabList[m.focusSlab];
  const I = m.tot.Iy;
  return ["slabs", `Cut into slabs: the slab at x = ${fx(sl.x, 2)} is a bell curve ${fx(sl.height, 2)} tall, so its area is ${fx(sl.height, 2)} × ${fx(I, 2)} = ${fx(sl.area, 2)}. All the slabs together: ${fx(I, 2)} × ${fx(I, 2)}.`];
}

function ringsLine(): [string, string] | null {
  const m = model;
  if (m.show !== "rings") return null;
  const L = m.landed;
  const N = m.slices;
  const exact = Math.PI * m.s * m.s;
  const pi = Math.abs(m.s - 1) < 1e-3 ? "pi" : `π s² = ${fx(exact, 2)}`;
  if (m.isReturning) return ["returning", `The rings fly home and the hill closes up: ${fx(L.sum, 2)} still in the tray.`];
  if (m.peelDone || L.count === N) {
    const R = m.tot.ringSum;
    return ["rings-done", `All ${N} rings unrolled: they add up to ${fv(R, exact)}${Math.abs(R - exact) < 5e-4 ? `, ${pi}` : `, close to ${pi}; more rings close the gap`}. Same hill, so ${fx(m.tot.Iy, 2)} × ${fx(m.tot.Iy, 2)} = ${pi}.`];
  }
  if (L.current >= 0) {
    const q = m.ringList[L.current];
    return ["peeling", `Peeling ring ${L.current + 1} of ${N} at radius ${fx(q.r, 2)}: ${fx(q.around, 1)} around, ${q.height < 0.01 ? q.height.toPrecision(1) : fx(q.height, 2)} tall. Rings so far add up to ${fx(L.sum, 2)} of ${pi}.`];
  }
  return ["peeling", `The outermost ring lifts off first: ${N} rings, each ${fx(m.ringList[0].dr, 3)} wide.`];
}

function idleLine(): [string, string] {
  const m = model, t = m.tot;
  const exact = Math.PI * m.s * m.s;
  if (m.slices <= 8) return ["coarse", `Only ${m.slices} slices: slabs say ${fx(t.slabSum, 4)}, rings say ${fx(t.ringSum, 4)}. Add more slices and both close in on ${Math.abs(m.s - 1) < 1e-3 ? "pi" : `π s² = ${fx(exact, 2)}`}.`];
  if (Math.abs(m.s - 1) > 1e-3) return widthLine();
  const close = Math.abs(t.ringSum - exact) < 5e-5;
  return ["idle", `One hill, two ways to measure it: slabs say ${f5(t.slabSum)}, rings say ${fv(t.ringSum, exact)}${close ? "" : " and close in with finer cuts"}. So the bell curve's area is ${f5(t.I)}, the square root of pi.`];
}

function dimsLine(): [string, string] {
  const n = model.dims, s = model.s;
  const In = bellArea(s) ** n;
  const G = gamma(n / 2 + 1);
  const V = ballVolume(n);
  const peak = ballPeak(20);
  const w = s === 1 ? "" : ` (with s = ${fx(s, 2)}: ${fx(In, 2)})`;
  const hold = `In ${n} dimension${n > 1 ? "s" : ""} the bell holds π^${fx(n / 2, 1).replace(".0", "")} = ${fx(Math.PI ** (n / 2), 2)} = Iⁿ${w}`;
  if (n === peak) return ["dims", `${hold}; divide by Γ(${fx(n / 2 + 1, 1)}) = ${fx(G, 2)} for the 5D ball's volume ${fx(V, 2)}, the biggest of any dimension.`];
  if (n === 1) return ["dims", `${hold}: just the bell curve's area. The 1D "ball" is the stick from −1 to 1, length π^½ / Γ(1.5) = 2.`];
  return ["dims", `${hold}; divide by Γ(${fx(n / 2 + 1, 1)}) = ${fx(G, 2)} and you get the ${n}D ball's volume ${fx(V, 2)}${n === 2 ? " = π" : n === 3 ? " = 4π/3" : n > peak ? `, already shrinking past the peak at n = ${peak}` : ""}.`];
}

function convLine(): [string, string] {
  const rows = convergenceTable(model.s, [6, 8, 12, model.slices]);
  const e = (v: number) => (v < 1e-14 ? "below 1e-14" : v.toExponential(0));
  return ["convergence", `Slabs: error ${e(rows[0].slabErr)} at 6 slices, ${e(rows[1].slabErr)} at 8, ${e(rows[2].slabErr)} at 12. Rings shrink only as 1/N²: ${e(rows[3].ringErr)} at ${model.slices}.`];
}

function captionNow(): [string, string] {
  const m = model, t = m.time, ev = m.ev;
  const recent = (x: number, d = 3) => t - x < d;
  if (m.wowActive) {
    switch (m.wowBeat) {
      case "hill":
        return ["intro", "One matte hill of height e^(−(x²+y²)): the bell curve one way times the bell curve the other way. How much clay is in it?"];
      case "cut":
        return ["coarse", `Cut into ${m.slices} rough slabs: each is a bell curve, so the slabs say ${fx(m.tot.slabSum, 4)} = area × area.`];
      case "rings6":
      case "cascade":
        return ringsLine() ?? ["coarse", `Now the same hill as ${m.slices} rings.`];
      case "sweep":
        return ["dragging", `${m.slices} slices: slabs ${fx(m.tot.slabSum, 5)}, rings ${fv(m.tot.ringSum, Math.PI)}. The tray's bars thin into the smooth curve 2π r e^(−r²).`];
      case "width":
        return widthLine();
      default:
        return ringsLine() ?? slabLine();
    }
  }
  const lastOther = Math.max(...Object.entries(ev).filter(([k]) => k !== "slices").map(([, v]) => v));
  if (slidingSlices || (recent(ev.slices, 2.5) && ev.slices >= lastOther)) {
    const tt = m.tot;
    const exact = Math.PI * m.s * m.s;
    if (m.slices <= 8 && !slidingSlices) return idleLine();
    return ["dragging", `${m.slices} slices: slabs ${f5(tt.slabSum)}, rings ${fv(tt.ringSum, exact)}. ${tt.slabSum - exact > -1e-5 && Math.abs(tt.slabSum - exact) < 1e-5 ? "The slabs settle very fast because the bell is so smooth; the rings start on a steep ramp at the centre and creep in." : "Too coarse even for the slabs: their gaps are wider than the bell."}`];
  }
  const events: [number, number, () => [string, string] | null][] = [
    [ev.reset, 2.5, () => ["reset", "Back to the example: the textbook bell cut into 24 slabs."]],
    [ev.width, 3.5, widthLine],
    [ev.flatten, 3.5, widthLine],
    [ev.undo, 3, () => ["undo", `Back to the example width s = ${fx(m.s, 2)}: the hill holds ${fx(Math.PI * m.s * m.s, 5)}.`]],
    [ev.darts, 6, () => {
      const d = m.darts, sh = m.dartsShown;
      if (!d) return null;
      const est = (d.boxVolume * sh.under) / Math.max(1, sh.n);
      const se = d.boxVolume * Math.sqrt(((sh.under / Math.max(1, sh.n)) * (1 - sh.under / Math.max(1, sh.n))) / Math.max(1, sh.n));
      return ["darts", `${sh.n.toLocaleString("en-US")} darts: ${sh.under} landed under the hill, which estimates ${fx(est, 2)} ± ${fx(se, 2)}. The exact answer is ${Math.abs(m.s - 1) < 1e-3 ? "pi" : `π s² = ${fx(Math.PI * m.s * m.s, 2)}`}.`];
    }],
    [ev.dims, 5, dimsLine],
    [ev.conv, 5, () => (m.showConv ? convLine() : null)],
    [ev.erf, 5, () => {
      if (!m.showErf || m.show !== "slabs") return null;
      const sl = m.slabList[m.focusSlab];
      return ["erf", `Teal curve: the running area of the slab at x = ${fx(sl.x, 2)}, (s√π/2)(1 + erf(y/s)) × ${fx(sl.height, 2)}, climbing to its whole area ${fx(sl.area, 2)}.`];
    }],
    [ev.pick, 4, () => (m.show === "slabs" && m.highlight >= 0 ? slabLine() : null)],
    [ev.mode, 6, () => (m.mode === "slabs" ? (m.show === "rings" ? ringsLine() : slabLine()) : ringsLine() ?? ["returning", "Pushing the slabs back together into one hill…"])],
  ];
  let best: [string, string] | null = null;
  let bestT = -Infinity;
  for (const [x, dur, f] of events) {
    if (!recent(x, dur) || x < bestT) continue;
    const r = f();
    if (r) {
      best = r;
      bestT = x;
    }
  }
  if (best) return best;
  if (m.show === "slabs" && m.highlight >= 0) return slabLine();
  if (m.show === "rings" || m.mode === "rings") return ringsLine() ?? idleLine();
  return idleLine();
}

// ───────────────────────── readouts ─────────────────────────

const ballsCv = $<HTMLCanvasElement>("balls");
const convCv = $<HTMLCanvasElement>("convplot");
let ballsKey = "";
let convKey = "";

function fitCanvas(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const r = c.getBoundingClientRect();
  if (r.width < 10) return null;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  return { g, w: r.width, h: r.height };
}

function drawBalls(): void {
  const key = `${model.dims}|${ballsCv.getBoundingClientRect().width}`;
  if (key === ballsKey || adv.hidden) return;
  const f = fitCanvas(ballsCv);
  if (!f) return;
  ballsKey = key;
  const { g, w, h } = f;
  const n = 12;
  const vs = Array.from({ length: n }, (_, i) => ballVolume(i + 1));
  const mx = Math.max(...vs);
  const bw = w / n;
  const peak = ballPeak(20);
  for (let i = 0; i < n; i++) {
    const bh = (vs[i] / mx) * (h - 26);
    const x = i * bw + bw * 0.18;
    const grd = g.createLinearGradient(0, h - 14 - bh, 0, h - 14);
    grd.addColorStop(0, i + 1 === model.dims ? "#f6dc8a" : "#d9b062");
    grd.addColorStop(1, i + 1 === model.dims ? "#c9963c" : "#8e6a2e");
    g.fillStyle = grd;
    g.fillRect(x, h - 14 - bh, bw * 0.64, bh);
    if (i + 1 === model.dims) {
      g.strokeStyle = "#fff4d6";
      g.lineWidth = 1.5;
      g.strokeRect(x - 0.5, h - 14 - bh - 0.5, bw * 0.64 + 1, bh + 1);
    }
    g.fillStyle = i + 1 === peak ? "#ffd08a" : "rgba(214,224,238,0.75)";
    g.font = "11px ui-monospace, Menlo, monospace";
    g.textAlign = "center";
    g.fillText(String(i + 1), x + bw * 0.32, h - 2);
    if (i + 1 === peak) g.fillText(fx(vs[i], 2), x + bw * 0.32, h - 18 - bh);
  }
}

function drawConv(): void {
  if (!model.showConv || adv.hidden) return;
  const key = `${model.s}|${model.slices}|${convCv.getBoundingClientRect().width}`;
  if (key === convKey) return;
  const f = fitCanvas(convCv);
  if (!f) return;
  convKey = key;
  const { g, w, h } = f;
  const Ns = [4, 5, 6, 7, 8, 10, 12, 16, 24, 32, 48, 64, 100, 140, 200];
  const rows = convergenceTable(model.s, Ns);
  const L0 = -16, L1 = 1;
  const X = (N: number) => 30 + ((Math.log(N) - Math.log(4)) / (Math.log(200) - Math.log(4))) * (w - 38);
  const Y = (e: number) => 6 + ((L1 - Math.log10(Math.max(1e-16, e))) / (L1 - L0)) * (h - 22);
  g.strokeStyle = "rgba(255,255,255,0.1)";
  g.fillStyle = "rgba(214,224,238,0.7)";
  g.font = "10px ui-monospace, Menlo, monospace";
  g.textAlign = "right";
  for (let p = 0; p >= -16; p -= 4) {
    g.beginPath();
    g.moveTo(30, Y(10 ** p));
    g.lineTo(w - 6, Y(10 ** p));
    g.stroke();
    g.fillText(`1e${p}`, 27, Y(10 ** p) + 3);
  }
  g.textAlign = "center";
  for (const N of [4, 10, 24, 60, 200]) g.fillText(String(N), X(N), h - 4);
  const line = (k: "slabErr" | "ringErr", c: string) => {
    g.strokeStyle = c;
    g.lineWidth = 2;
    g.beginPath();
    rows.forEach((r, i) => (i ? g.lineTo(X(r.N), Y(r[k])) : g.moveTo(X(r.N), Y(r[k]))));
    g.stroke();
    g.fillStyle = c;
    for (const r of rows) g.fillRect(X(r.N) - 2, Y(r[k]) - 2, 4, 4);
  };
  line("slabErr", "#efe6cf");
  line("ringErr", "#e3a13a");
  g.strokeStyle = "rgba(155,216,58,0.8)";
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(X(model.slices), 6);
  g.lineTo(X(model.slices), h - 16);
  g.stroke();
  g.setLineDash([]);
  const tab = $("convtab");
  const e = (v: number) => (v < 1e-15 ? "< 1e-15" : v.toExponential(1));
  tab.innerHTML = `<tr><th>slices</th><th>slabs off by</th><th>rings off by</th></tr>` + convergenceTable(model.s, [6, 8, 12, 24, model.slices].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)).map((r) => `<tr${r.N === model.slices ? ' class="cur"' : ""}><td>${r.N}</td><td>${e(r.slabErr)}</td><td>${e(r.ringErr)}</td></tr>`).join("");
}

let piecesKey = "";
function updatePieces(): void {
  if (isPhone()) return;
  const m = model;
  const key = `${m.cutVersion}|${m.mode}|${m.highlight}`;
  if (key === piecesKey) return;
  piecesKey = key;
  const tab = $("pieces");
  if (m.mode === "slabs") {
    const L = m.slabList;
    const hl = m.highlight;
    const mid = hl >= 0 ? hl : Math.floor(L.length / 2);
    const pick = L.slice(Math.max(0, mid), Math.min(L.length, mid + 3));
    tab.innerHTML = `<tr><th>slab at x</th><th>height</th><th>area</th></tr>` + pick.map((sl) => `<tr${sl.i === hl ? ' class="cur"' : ""}><td>${fx(sl.x, 3)}</td><td>${fx(sl.height, 4)}</td><td>${fx(sl.area, 4)}</td></tr>`).join("");
  } else {
    const R = m.ringList;
    const k = Math.floor(R.length / 3);
    tab.innerHTML = `<tr><th>ring at r</th><th>around × tall</th><th>volume</th></tr>` + R.slice(k, k + 3).map((q) => `<tr><td>${fx(q.r, 3)}</td><td>${fx(q.around, 2)} × ${fx(q.height, 3)}</td><td>${fx(q.volume, 4)}</td></tr>`).join("");
  }
}

function miniDial(id: string, v: number): void {
  const s = model.s;
  const range = dialRange(s);
  const arc = (a: number, r: number) => [30 + Math.sin(a) * r, 30 - Math.cos(a) * r];
  const tr = $(`mtrack${id}`);
  if (!tr.getAttribute("d")) {
    const [x0, y0] = arc(dialAngle(0, 4), 22), [x1, y1] = arc(dialAngle(4, 4), 22);
    tr.setAttribute("d", `M${x0} ${y0} A22 22 0 1 1 ${x1} ${y1}`);
  }
  const set = (el: string, a: number, r0: number, r1: number) => {
    const [x0, y0] = arc(a, r0), [x1, y1] = arc(a, r1);
    const e = $(el);
    e.setAttribute("x1", x0.toFixed(2));
    e.setAttribute("y1", y0.toFixed(2));
    e.setAttribute("x2", x1.toFixed(2));
    e.setAttribute("y2", y1.toFixed(2));
  };
  set(`mneedle${id}`, dialAngle(v, range), 0, 22);
  set(`mpi${id}`, dialAngle(Math.PI * s * s, range), 20, 27);
}

function updateHud(): void {
  const m = model, t = m.tot;
  const exact = t.exactVolume;
  setText($("n-slab"), `${f5(t.slabSum)} with ${m.slices} slices`);
  setText($("n-ring"), `${fv(t.ringSum, exact)} with ${m.slices} rings`);
  setText($("n-ring-m"), Math.abs(m.s - 1) < 1e-3 ? `exact: π = ${f5(Math.PI)}` : `exact: π s² = ${f5(exact)}`);
  setText($("n-I"), Math.abs(m.s - 1) < 1e-3 ? `${f5(t.I)} = square root of π` : `${f5(t.I)} = ${fx(m.s, 2)} × √π`);
  setText($("n-w"), `s = ${fx(m.s, 2)}, area ${fx(t.Iy, 2)} (s × square root of π)`);
  setText($("n-w-m"), `as a normal curve σ = ${fx(m.s / Math.SQRT2, 2)}: area σ√(2π) = ${fx(t.Iy, 2)}`);
  const e = (v: number) => (v < 1e-14 ? "<1e-14" : v.toExponential(0));
  setText($("n-err"), `slabs ${e(Math.abs(t.slabPlate - t.exactSlabPlate))}, rings ${e(Math.abs(t.ringPlate - t.exactRingPlate))}`);
  updatePieces();

  // phone dial strip
  miniDial("A", m.slabNeedle.v);
  miniDial("B", m.ringNeedle.v);
  setText($("mvalA"), m.slabNeedle.v > 1e-3 ? fx(m.slabNeedle.v, 4) : "—");
  setText($("mvalB"), m.ringNeedle.v > 1e-3 ? fx(m.ringNeedle.v, 4) : "—");
  setText($("modo"), m.odo.v > 1e-4 ? fx(m.odo.v, 5) : "—");

  setText($("dims-desc"), `Iⁿ = π^(n/2) = ${fx(Math.PI ** (m.dims / 2), 3)} (measured: ${fx(bellArea(1) ** m.dims, 3)}). Unit ${m.dims}-ball: π^(n/2) / Γ(n/2 + 1) = ${fx(ballVolume(m.dims), 3)}.`);
  const d = m.darts;
  if (d) setText($("darts-desc"), `${d.thrown.toLocaleString("en-US")} darts, ${d.under} under the hill: ${fx(d.boxVolume, 0)} × ${d.under}/${d.thrown} = ${fx(d.estimate, 3)} ± ${fx(d.se, 3)} (exact ${fx(Math.PI * m.s * m.s, 3)}). Seed ${1000 + m.dartThrows}.`);
  else setText($("darts-desc"), `Darts land at random in the box over the plate, 0 to 1 tall. Lime = under the hill. Box volume × share under = an estimate of the volume.`);
  drawBalls();
  drawConv();

  const [state, full] = captionNow();
  captionState = state;
  if (captionText.textContent !== full) {
    captionText.textContent = full;
    if (caption.dataset.state !== state) {
      caption.classList.remove("pulse");
      void caption.offsetWidth;
      caption.classList.add("pulse");
    }
  }
  caption.dataset.state = state;

  // the fade-in on first load (model clock, so recording is exact)
  const fade = $("fade");
  const fo = firstWow && m.wowActive ? Math.max(0, 1 - m.wowT / 0.8) : 0;
  const fs = fo.toFixed(3);
  if (fade.style.opacity !== fs) fade.style.opacity = fs;
}

// ───────────────────────── loop ─────────────────────────

let last = performance.now();
let fpsT = 0, fpsN = 0;
let stepped = false;
let readyT = Infinity;

function loop(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  // in record mode the clock waits for the recorder's fixed-dt steps (or starts on its own 3 s after ready)
  if (!stepped) frame(recording && now - readyT < 3000 ? 0 : dt);
  requestAnimationFrame(loop);
}

function frame(dt: number, draw = true): void {
  model.sliding = slidingSlices;
  model.step(dt);
  if (introPending && !model.wowActive && !stepped) {
    introPending = false;
    setExplain(true, false);
  }
  syncControls();
  if (draw && view) {
    try {
      view.render(dt, model);
    } catch (err) {
      if (view.kind === "webgl") switchTo2D(`render error: ${(err as Error)?.message ?? err}`);
      else throw err;
    }
    layoutLabels(view.anchors());
  } else if (view) view.settle?.(dt, model);
  updateHud();
  if (frames % 10 === 0) checkLayout();
  frames++;
  const now = performance.now();
  if (!fpsT) fpsT = now;
  fpsN++;
  if (now - fpsT >= 500) {
    fps = (fpsN * 1000) / (now - fpsT);
    fpsT = now;
    fpsN = 0;
  }
}

// ───────────────────────── hooks ─────────────────────────

declare global {
  interface Window {
    __bellInfo: () => Record<string, unknown>;
    __bellSelfTest: () => { pass: boolean; checks: Check[] };
    __bellAdvance: (seconds: number) => Record<string, unknown>;
    __bellAnchors: () => Anchors;
    __ixRecord: { ready: boolean; setStepped: (on: boolean) => void; stepFrame: (dt: number) => void };
  }
}
const r9 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x);
window.__bellInfo = () => {
  const m = model, t = m.tot, L = m.landed;
  return {
    mode: m.mode,
    slices: m.slices,
    width: r9(m.s),
    slabSum: r9(t.slabSum),
    ringSum: r9(t.ringSum),
    exactVolume: r9(t.exactVolume),
    I: r9(t.I),
    odometer: Math.round(m.odo.v * 1e5) / 1e5,
    dims: m.dims,
    dartsThrown: m.darts?.thrown ?? 0,
    dartsUnder: m.darts?.under ?? 0,
    captionState,
    animating: m.wowActive || m.morphing,
    caption: captionText.textContent ?? "",
    renderer: view?.kind ?? "webgl",
    show: m.show,
    fan: r9(m.fan),
    peel: r9(m.peel),
    landedSum: r9(L.sum),
    landedCount: L.count,
    slabPlate: r9(t.slabPlate),
    ringPlate: r9(t.ringPlate),
    slabNeedle: r9(m.slabNeedle.v),
    ringNeedle: r9(m.ringNeedle.v),
    showErf: m.showErf,
    showConv: m.showConv,
    advanced: !adv.hidden,
    highlight: m.highlight,
    flattenStash: m.flattenStash,
    wow: m.wowActive,
    wowT: r9(m.wowT),
    camera: view?.cameraPose().map((x) => Math.round(x * 1e4) / 1e4),
    defaults: DEFAULTS,
    limits: { slices: [MIN_SLICES, MAX_SLICES], darts: N_DARTS },
    frames,
    fps: Math.round(fps * 10) / 10,
    nan: !m.finite(),
  };
};

/** Reset check: scramble everything, press Reset, compare with the defaults (and the reset camera pose). */
function resetCheck(): Check {
  if (!view) return { name: "Reset restores everything", pass: false, detail: "no view" };
  const bad: string[] = [];
  resetAll();
  const want = view.cameraPose();
  model.interrupt();
  model.setMode(model.mode === "slabs" ? "rings" : "slabs");
  model.setSlices(77);
  model.setWidth(1.7);
  model.setDims(6);
  model.setErf(true);
  model.setConv(true);
  model.throwDarts();
  setAdv(true);
  view.setCameraPose(want.map((x, i) => x + (i < 3 ? 0.8 : 0.1)));
  resetAll();
  const got = view.cameraPose();
  if (got.some((x) => !Number.isFinite(x))) bad.push("camera NaN");
  const camErr = Math.max(...got.map((x, i) => Math.abs(x - want[i])));
  if (model.mode !== DEFAULTS.mode) bad.push("mode");
  if (model.slices !== DEFAULTS.slices) bad.push("slices");
  if (model.s !== DEFAULTS.width) bad.push("width");
  if (model.dims !== DEFAULTS.dims) bad.push("dims");
  if (model.showErf !== DEFAULTS.showErf || model.showConv !== DEFAULTS.showConv) bad.push("toggles");
  if (model.darts) bad.push("darts");
  if (!adv.hidden) bad.push("advanced");
  if (camErr > 1e-6) bad.push(`camera ${camErr.toExponential(1)}`);
  if (+slicesIn.value !== DEFAULTS.slices || +widthIn.value !== DEFAULTS.width || +dimsIn.value !== DEFAULTS.dims || chkErf.checked || chkConv.checked) bad.push("controls");
  return { name: "Reset restores mode, slices, width, dims, toggles, darts, Advanced, camera", pass: bad.length === 0, detail: bad.length ? `wrong: ${bad.join(", ")}` : `all restored (camera error ${camErr.toExponential(1)})` };
}

window.__bellSelfTest = () => selfTest(() => [resetCheck()]);
window.__bellAnchors = () => view?.anchors() ?? {};
window.__bellAdvance = (seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 30) frame(1 / 30, false);
  frame(0);
  return window.__bellInfo();
};
// deterministic fixed-dt stepping for scripts/record-demo.mjs ("capture": "frames")
window.__ixRecord = {
  ready: false,
  setStepped(on: boolean) {
    stepped = on;
    if (on) {
      introPending = false;
      setExplain(false, false);
    }
  },
  stepFrame(dt: number) {
    frame(Math.min(0.1, Math.max(1 / 240, dt || 1 / 30)));
  },
};

syncControls(true);
void boot();
