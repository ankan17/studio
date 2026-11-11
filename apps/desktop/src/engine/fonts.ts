// Bundled fonts (both SIL OFL, licences next to the files). The project file references fonts by family name; this
// resolves those names to the files. Loaded once at startup, before any text is drawn.
import {loadFont} from "@remotion/fonts";
import bebas from "../assets/fonts/BebasNeue-Regular.ttf?url";
import bengali from "../assets/fonts/NotoSansBengali.ttf?url";

export const BUNDLED_FONTS = ["Noto Sans Bengali", "Bebas Neue"] as const;

let loading: Promise<unknown> | null = null;
export function loadBundledFonts(): Promise<unknown> {
  loading ??= Promise.all([
    loadFont({family: "Noto Sans Bengali", url: bengali, weight: "100 900"}),
    loadFont({family: "Bebas Neue", url: bebas, weight: "400"}),
  ]).catch((err) => console.error("Font load failed", err));
  return loading;
}
