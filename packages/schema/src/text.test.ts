import {describe, expect, it} from "vitest";
import {graphemes, PRESET_SECONDS, textAnimation} from "./text";

const FPS = 30;
const IN = Math.round(PRESET_SECONDS * FPS); // 12 frames

describe("text presets", () => {
  it("with no preset the text is fully shown for the whole clip", () => {
    for (const f of [0, 45, 89]) expect(textAnimation({content: "Hi"}, f, 90, FPS)).toEqual({opacity: 1, dy: 0, scale: 1, chars: null});
  });
  it("fade in rises from 0 to 1 over the preset time, fade out falls to 0 at the end", () => {
    const t = {content: "Hi", enterPreset: "fade", exitPreset: "fade"};
    expect(textAnimation(t, 0, 90, FPS).opacity).toBe(0);
    expect(textAnimation(t, IN / 2, 90, FPS).opacity).toBeGreaterThan(0.3);
    expect(textAnimation(t, IN, 90, FPS).opacity).toBe(1);
    expect(textAnimation(t, 45, 90, FPS).opacity).toBe(1);
    expect(textAnimation(t, 89, 90, FPS).opacity).toBeLessThan(0.15);
  });
  it("slide up starts below and lands in place; pop starts small and lands at full size", () => {
    expect(textAnimation({content: "x", enterPreset: "slideUp"}, 0, 90, FPS).dy).toBeGreaterThan(0);
    expect(textAnimation({content: "x", enterPreset: "slideUp"}, IN, 90, FPS).dy).toBe(0);
    expect(textAnimation({content: "x", enterPreset: "pop"}, 0, 90, FPS).scale).toBeLessThan(0.7);
    expect(textAnimation({content: "x", enterPreset: "pop"}, IN, 90, FPS).scale).toBe(1);
  });
  it("typewriter reveals whole graphemes and has typed everything by half the clip", () => {
    const t = {content: "Hello world", enterPreset: "typewriter"};
    expect(textAnimation(t, 0, 90, FPS).chars).toBe(0);
    const mid = textAnimation(t, 10, 90, FPS).chars!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(11);
    expect(textAnimation(t, 45, 90, FPS).chars).toBeNull();
    expect(textAnimation({content: "Bye", exitPreset: "typewriter"}, 89, 90, FPS).chars).toBeLessThan(3);
  });
  it("a short clip shares its length between enter and exit", () => {
    const t = {content: "x", enterPreset: "fade", exitPreset: "fade"};
    expect(textAnimation(t, 5, 10, FPS).opacity).toBe(1); // 5 frames in, 5 out: the middle is fully shown
    expect(textAnimation(t, 0, 10, FPS).opacity).toBe(0);
  });
  it("an unknown preset name is treated as none", () => {
    expect(textAnimation({content: "x", enterPreset: "spin"}, 0, 90, FPS)).toEqual({opacity: 1, dy: 0, scale: 1, chars: null});
  });
  it("splits Bengali into graphemes without breaking conjuncts", () => {
    // ক্ষ (ka + virama + ssa) is one conjunct; ত্র likewise
    expect(graphemes("ক্ষমা")).toEqual(["ক্ষ", "মা"]);
    expect(graphemes("পত্র")).toEqual(["প", "ত্র"]);
  });
});
