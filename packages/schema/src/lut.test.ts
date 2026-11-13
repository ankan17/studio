import {describe, expect, it} from "vitest";
import {IDENTITY_LOOK, LOOKS, generateLut, hueOf, sampleLut, toCube, trueVariant} from "./lut";

// ColorChecker Classic patches, sRGB 8-bit.
const CHART: [number, number, number][] = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
];
const chromatic = CHART.slice(0, 18).map((c) => c.map((v) => v / 255) as [number, number, number]);
const hueDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("LUT generator", () => {
  it("identity parameters give an identity LUT within 1/255", () => {
    const lut = generateLut(IDENTITY_LOOK);
    const n = 33;
    let worst = 0;
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const i = 3 * (r + g * n + b * n * n);
      worst = Math.max(worst, Math.abs(lut[i] - r / (n - 1)), Math.abs(lut[i + 1] - g / (n - 1)), Math.abs(lut[i + 2] - b / (n - 1)));
    }
    expect(worst).toBeLessThanOrEqual(1 / 255);
  });

  it("every bundled look stays in range and actually changes the picture", () => {
    for (const [id, look] of Object.entries(LOOKS)) {
      const lut = generateLut(look);
      expect(lut.every((v) => v >= 0 && v <= 1), id).toBe(true);
      const moved = chromatic.some((c) => sampleLut(lut, 33, c).some((v, k) => Math.abs(v - c[k]) > 0.02));
      expect(moved, id).toBe(true);
    }
  });

  it.each(Object.keys(LOOKS))("%s-true keeps every chart patch's hue within 2 degrees", (id) => {
    const lut = generateLut(trueVariant(LOOKS[id]));
    for (const c of chromatic) expect(hueDiff(hueOf(sampleLut(lut, 33, c)), hueOf(c))).toBeLessThanOrEqual(2);
  });

  it("writes a .cube with a 33 size header and 33^3 rows", () => {
    const text = toCube(generateLut(IDENTITY_LOOK), 33, "identity");
    const lines = text.trim().split("\n");
    expect(lines).toContain("LUT_3D_SIZE 33");
    expect(lines.filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l))).toHaveLength(33 ** 3);
  });
});
