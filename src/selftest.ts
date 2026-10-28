/** window.__bellSelfTest(): every check recomputes from bell.ts; nothing is a stored answer. */
import {
  HALF,
  SQRT_PI,
  ballPeak,
  ballVolume,
  bellArea,
  erf,
  fdSlope,
  ringPotential,
  ringSlope,
  ringSum,
  ringSumPlate,
  ringTotalExact,
  slabSum,
  slabSumPlate,
  throwDarts,
  totals,
} from "./bell";

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const e = (x: number) => x.toExponential(2);

export function selfTest(extra: () => Check[] = () => []): { pass: boolean; checks: Check[] } {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  {
    const erf3 = erf(HALF);
    const v = slabSumPlate(200, 1);
    const exact = Math.PI * erf3 * erf3;
    add("slabs, 200 slices, plate = π erf(3)²", Math.abs(v - exact) < 1e-9, `|${v.toFixed(12)} − ${exact.toFixed(12)}| = ${e(Math.abs(v - exact))}`);
    add("slabs, 200 slices, plate ≈ π (tails missing)", Math.abs(v - Math.PI) < 2e-4, `π − plate = ${e(Math.PI - v)}`);
    const whole = slabSum(200, 1);
    add("slabs, whole hill (plate + skirt) = π", Math.abs(whole - Math.PI) < 1e-12, `error ${e(Math.abs(whole - Math.PI))}`);
  }
  {
    const target = ringTotalExact(HALF, 1);
    const errs = [8, 16, 32, 64, 128].map((N) => Math.abs(ringSumPlate(N, 1) - target));
    const mono = errs.every((x, i) => i === 0 || x < errs[i - 1]);
    add("rings converge to π(1 − e⁻⁹), error shrinking", mono && errs[4] < 1e-3, `errors ${errs.map(e).join(", ")}`);
    const ratio = errs[3] / errs[4];
    add("ring error falls as 1/N² (halve dr → ¼ the error)", ratio > 3.6 && ratio < 4.4, `64→128 ratio ${ratio.toFixed(3)}`);
  }
  {
    let worst = 0;
    for (let k = 0; k < 20; k++) {
      const r = 0.1 + (k * 2.9) / 19;
      worst = Math.max(worst, Math.abs(fdSlope((x) => ringPotential(x, 1), r) - ringSlope(r, 1)));
    }
    add("slope of −π e^(−r²) is 2π r e^(−r²) (20 radii)", worst < 1e-6, `worst gap ${e(worst)}`);
  }
  {
    let worst = 0;
    for (const s of [0.5, 1, 1.5, 2]) worst = Math.max(worst, Math.abs(bellArea(s) - s * SQRT_PI));
    add("I = s√π for s = 0.5, 1, 1.5, 2 (sum over |x| ≤ 8s)", worst < 1e-9, `worst ${e(worst)}`);
  }
  {
    const v = erf(1);
    let odd = 0;
    for (const x of [0.1, 0.7, 1.3, 2.5, 3.2, 4.5]) odd = Math.max(odd, Math.abs(erf(-x) + erf(x)));
    add("erf(1) = 0.8427007929", Math.abs(v - 0.8427007929) < 1e-9, v.toFixed(12));
    add("erf(−x) = −erf(x)", odd < 1e-15, `worst ${e(odd)}`);
    const seam = Math.abs(erf(2.999999999) - erf(3.000000001));
    add("erf series meets continued fraction at 3", seam < 1e-12, `jump ${e(seam)}`);
  }
  {
    const v2 = ballVolume(2), v3 = ballVolume(3);
    add("V₂ = π", Math.abs(v2 - Math.PI) < 1e-12, v2.toFixed(12));
    add("V₃ = 4π/3", Math.abs(v3 - (4 * Math.PI) / 3) < 1e-12, v3.toFixed(12));
    add("ball volume peaks at n = 5", ballPeak(20) === 5, `peak n = ${ballPeak(20)}, V₅ = ${ballVolume(5).toFixed(4)}`);
  }
  {
    const d = throwDarts(200000, 1, 12345, 0);
    const z = Math.abs(d.estimate - Math.PI) / d.se;
    add("200,000 seeded darts within 4 standard errors of π", z < 4, `${d.estimate.toFixed(4)} ± ${d.se.toFixed(4)} (${z.toFixed(2)} SE)`);
  }
  {
    let bad = "";
    for (const s of [0.5, 2]) for (const N of [4, 200]) {
      const t = totals(N, s);
      for (const [k, v] of Object.entries(t)) if (!Number.isFinite(v)) bad += `${k}@N${N},s${s} `;
      if (!Number.isFinite(ringSum(N, s))) bad += `ring@${N},${s} `;
    }
    add("no NaN at s = 0.5, 2 and slices = 4, 200", bad === "", bad || "all finite");
  }
  checks.push(...extra());
  return { pass: checks.every((c) => c.pass), checks };
}
