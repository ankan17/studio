// LUT generator for looks (phase 2 plan, "Looks"): a recipe applied to Rec.709 footage in display space, written as a 33^3 LUT.
type Rgb = [number, number, number];
export type Tint = {hue: number; amount: number};
export type LookRecipe = {
  temp: number; // -1..1
  curve: [number, number, number, number, number]; // outputs at inputs 0, .25, .5, .75, 1
  sat: number;
  shadows?: Tint;
  highlights?: Tint;
  skin: number; // 0..1
  preserveHue?: boolean; // tone curve on max and min only, mid placed by ratio, so HSV hue is unchanged
};

export const IDENTITY_LOOK: LookRecipe = {temp: 0, curve: [0, 0.25, 0.5, 0.75, 1], sat: 1, skin: 0};

export const LOOKS: Record<string, LookRecipe> = {
  "soft-warm": {temp: 0.5, curve: [0.07, 0.28, 0.52, 0.76, 0.94], sat: 0.8, shadows: {hue: 150, amount: 0.04}, highlights: {hue: 35, amount: 0.06}, skin: 0.3},
  "teal-orange": {temp: 0, curve: [0.02, 0.19, 0.5, 0.81, 0.97], sat: 0.95, shadows: {hue: 190, amount: 0.15}, highlights: {hue: 30, amount: 0.12}, skin: 0.6},
  punch: {temp: 0, curve: [0, 0.18, 0.5, 0.84, 1], sat: 1.2, skin: 0.4},
  "cool-low": {temp: -0.5, curve: [0.03, 0.17, 0.42, 0.7, 0.9], sat: 0.65, shadows: {hue: 210, amount: 0.1}, highlights: {hue: 200, amount: 0.04}, skin: 0.4},
};

/** The `<id>-true` variant: no temperature or split tone, saturation capped at 1, so only contrast changes. */
export const trueVariant = (look: LookRecipe): LookRecipe => ({temp: 0, curve: look.curve, sat: Math.min(look.sat, 1), skin: look.skin, preserveHue: true});

// A per-channel curve shifts hue (up to 3.4 degrees on a colour chart for punch), so the -true variant curves max and min only.
const curveKeepingHue = (curve: (x: number) => number, c: Rgb): Rgb => {
  const max = Math.max(...c), min = Math.min(...c);
  if (max === min) return c.map(curve) as Rgb;
  const hi = curve(max), lo = curve(min);
  return c.map((v) => lo + ((v - min) / (max - min)) * (hi - lo)) as Rgb;
};

const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const hueOf = ([r, g, b]: Rgb): number => {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  return (h * 60 + 360) % 360;
};

const hueColour = (hue: number): Rgb => {
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
};

// Fritsch-Carlson monotone cubic through five evenly spaced points.
const monotoneCurve = (ys: LookRecipe["curve"]) => {
  const h = 0.25;
  const d = ys.slice(1).map((y, i) => (y - ys[i]) / h);
  const m = ys.map((_, i) => (i === 0 ? d[0] : i === 4 ? d[3] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < 4; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    const i = Math.min(3, Math.max(0, Math.floor(x / h)));
    const t = (x - i * h) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
};

const ramp = (x: number, lo: number, hi: number, edge: number) => Math.max(0, Math.min(1, (x - lo + edge) / edge, (hi + edge - x) / edge));

// Skin: hues 10-50 degrees with a 10 degree soft edge, HSV saturation .15-.6 (a .05 soft edge so the LUT has no hard step).
const skinWeight = (c: Rgb) => {
  const max = Math.max(...c);
  const s = max === 0 ? 0 : (max - Math.min(...c)) / max;
  const h = hueOf(c);
  return ramp(h > 180 ? h - 360 : h, 10, 50, 10) * ramp(s, 0.15, 0.6, 0.05);
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const grade = (look: LookRecipe, curve: (x: number) => number, input: Rgb): Rgb => {
  const t = look.temp;
  const warmed: Rgb = [input[0] * (1 + 0.1 * t), input[1], input[2] * (1 - 0.1 * t)];
  const clamped = warmed.map(clamp01) as Rgb;
  const curved = look.preserveHue ? curveKeepingHue(curve, clamped) : (clamped.map(curve) as Rgb);
  const l = luma(curved);
  let c = curved.map((v) => l + (v - l) * look.sat) as Rgb;
  for (const [tint, w] of [[look.shadows, (1 - l) ** 2], [look.highlights, l ** 2]] as const) {
    if (!tint) continue;
    const hc = hueColour(tint.hue), hl = luma(hc);
    c = c.map((v, k) => v + (hc[k] - hl) * tint.amount * w) as Rgb;
  }
  const k = look.skin * skinWeight(curved);
  return c.map((v, i) => clamp01(v + (curved[i] - v) * k)) as Rgb;
};

/** RGB floats, red fastest then green then blue (.cube order, and texImage3D's x, y, z). */
export const generateLut = (look: LookRecipe, size = 33): Float32Array => {
  const curve = monotoneCurve(look.curve);
  const out = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const c = grade(look, curve, [r / (size - 1), g / (size - 1), b / (size - 1)]);
    out[i++] = c[0]; out[i++] = c[1]; out[i++] = c[2];
  }
  return out;
};

/** Trilinear lookup, as the GPU does it. */
export const sampleLut = (lut: Float32Array, size: number, [r, g, b]: Rgb): Rgb => {
  const p = [r, g, b].map((v) => clamp01(v) * (size - 1));
  const i0 = p.map((v) => Math.min(size - 2, Math.floor(v)));
  const f = p.map((v, k) => v - i0[k]);
  const out: Rgb = [0, 0, 0];
  for (let corner = 0; corner < 8; corner++) {
    const o = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    const w = o.reduce((acc, bit, k) => acc * (bit ? f[k] : 1 - f[k]), 1);
    const idx = 3 * (i0[0] + o[0] + (i0[1] + o[1]) * size + (i0[2] + o[2]) * size * size);
    for (let k = 0; k < 3; k++) out[k] += w * lut[idx + k];
  }
  return out;
};

export const toCube = (lut: Float32Array, size: number, title: string): string => {
  const rows = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`];
  for (let i = 0; i < lut.length; i += 3) rows.push(`${lut[i].toFixed(6)} ${lut[i + 1].toFixed(6)} ${lut[i + 2].toFixed(6)}`);
  return rows.join("\n") + "\n";
};
