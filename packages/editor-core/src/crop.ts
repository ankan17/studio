// Crop handles on the picture: pure maths for dragging an edge, a corner or the whole crop rectangle. Crops are in
// fractions of the displayed source; every side keeps at least MIN_CROP of the picture.
import type {Clip} from "@studio/schema";
import {MIN_CROP} from "./commands";

export type CropHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "move";

/** New crop edges after dragging one handle (or the whole rectangle) by a fraction of the picture. */
export function dragCrop(c: NonNullable<Clip["crop"]>, handle: CropHandle, dx: number, dy: number): NonNullable<Clip["crop"]> {
  let [l, t, r, b] = [c.x, c.y, c.x + c.width, c.y + c.height];
  if (handle === "move") {
    const mx = Math.max(-l, Math.min(1 - r, dx));
    const my = Math.max(-t, Math.min(1 - b, dy));
    [l, r, t, b] = [l + mx, r + mx, t + my, b + my];
  } else {
    if (handle.includes("w")) l = Math.max(0, Math.min(r - MIN_CROP, l + dx));
    if (handle.includes("e")) r = Math.min(1, Math.max(l + MIN_CROP, r + dx));
    if (handle.includes("n")) t = Math.max(0, Math.min(b - MIN_CROP, t + dy));
    if (handle.includes("s")) b = Math.min(1, Math.max(t + MIN_CROP, b + dy));
  }
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {x: round(l), y: round(t), width: round(r - l), height: round(b - t)};
}
