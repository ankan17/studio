import {describe, expect, it} from "vitest";
import {isNewerVersion, parseVersion} from "./release";

describe("release versions", () => {
  it("parses tags with and without a v and a pre-release suffix", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.7.0")).toEqual([0, 7, 0]);
    expect(parseVersion("1.0.0-rc.1")).toEqual([1, 0, 0]);
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
  it("compares numerically, not as text", () => {
    expect(isNewerVersion("0.7.0", "0.8.0")).toBe(true);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.9")).toBe(false);
    expect(isNewerVersion("1.2.3", "v1.2.3")).toBe(false);
  });
  it("never calls an unparseable version newer", () => {
    expect(isNewerVersion("0.7.0", "nightly")).toBe(false);
    expect(isNewerVersion("dev", "1.0.0")).toBe(false);
  });
});
