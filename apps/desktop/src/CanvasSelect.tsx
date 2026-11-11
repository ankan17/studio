// Selection on the picture: click a clip in the preview to select it, drag it to position it. The box follows the
// clip's transform (position, scale, rotation), fit and crop, the same maths the composition uses to draw it.
// Crop mode: the preview shows the selected clip whole and untransformed (Stage swaps it in), and a crop rectangle with
// eight handles sets which part of the source is kept; drag inside the rectangle to move it. Each drag is one undo step.
import {dragCrop, locate, type CropHandle as Handle} from "@studio/editor-core";
import {clipsAtFrame, pictureLayout, type Asset, type Clip, type Project} from "@studio/schema";
import {produce} from "immer";
import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {create} from "zustand";
import {useEditor, useSelectedClipId} from "./editorStore";
import {playback, usePlayback} from "./playback";

/** The clip being cropped on the picture, if any. UI state, never saved. */
export const useCrop = create<{clipId: string | null}>(() => ({clipId: null}));
export const cropMode = {
  start(clipId: string): void {
    const p = useEditor.getState().project;
    const clip = p && locate(p, clipId)?.clip;
    if (!clip) return;
    const f = usePlayback.getState().frame;
    if (f < clip.startFrame || f >= clip.startFrame + clip.durationInFrames) playback.seek(clip.startFrame); // the picture must be on screen
    useCrop.setState({clipId});
  },
  stop: () => useCrop.setState({clipId: null}),
};

const IDENTITY = {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false};
/** What the preview draws in crop mode: the cropped clip whole, fitted and untransformed. */
export const cropView = (p: Project, clipId: string): Project =>
  produce(p, (d) => {
    const clip = locate(d, clipId)?.clip;
    if (!clip) return;
    delete clip.crop;
    clip.fit = "contain";
    clip.transform = {...IDENTITY};
  });

type Box = {cx: number; cy: number; w: number; h: number; rot: number};

/** Where a clip's picture sits in project pixels: the fitted picture, then translate, rotate and scale about its centre. */
export function pictureBox(clip: Clip, asset: Asset, W: number, H: number): Box {
  const {boxW, boxH} = pictureLayout(clip, asset, W, H);
  const t = clip.transform;
  return {cx: W / 2 + t.x, cy: H / 2 + t.y, w: boxW * t.scale, h: boxH * t.scale, rot: t.rotation};
}

function inside(b: Box, x: number, y: number): boolean {
  const r = (-b.rot * Math.PI) / 180;
  const dx = x - b.cx;
  const dy = y - b.cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

/**
 * A title's box, measured from the text the composition drew: its centre from the screen, its size from the layout
 * (the Player scales the composition with CSS, so offsetWidth is already in project pixels). Null if not drawn.
 */
function textBox(clip: Clip, root: HTMLElement | null, k: number): Box | null {
  const el = root?.parentElement?.querySelector<HTMLElement>(`[data-text-clip="${clip.id}"]`);
  if (!root || !el) return null;
  const r = el.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  const t = clip.transform;
  return {cx: (r.left + r.width / 2 - o.left) / k, cy: (r.top + r.height / 2 - o.top) / k, w: el.offsetWidth * t.scale, h: el.offsetHeight * t.scale, rot: t.rotation};
}

type Shown = {clip: Clip; asset: Asset | null; locked: boolean};

/** Clips with a picture (media or a title) under the playhead, top layer first. */
function pictures(p: Project, frame: number): Shown[] {
  return clipsAtFrame(p, frame)
    .filter(({track}) => track.visible && track.type !== "audio")
    .map(({track, clip}) => ({clip, asset: p.assets.find((a) => a.id === clip.assetId) ?? null, locked: track.locked}))
    .filter((x) => !!x.clip.text || (!!x.asset && x.asset.type !== "audio"));
}

export function CanvasSelect() {
  const project = useEditor((s) => s.project)!;
  const selectedId = useSelectedClipId();
  const cropping = useCrop((s) => s.clipId);
  const frame = usePlayback((s) => s.frame);
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1); // preview pixels per project pixel
  const drag = useRef<{id: string; x0: number; y0: number; tx: number; ty: number; gesture: string} | null>(null);
  const W = project.width;
  const H = project.height;

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setK(el.clientWidth / W));
    ro.observe(el);
    setK(el.clientWidth / W);
    return () => ro.disconnect();
  }, [W]);

  // crop mode ends when its clip is no longer the one selected (Escape, another click, a delete)
  useEffect(() => {
    if (cropping && cropping !== selectedId) cropMode.stop();
  }, [cropping, selectedId]);

  const shown = pictures(project, frame);
  const sel = shown.find((x) => x.clip.id === selectedId);
  const boxOf = (x: Shown): Box | null => (x.asset ? pictureBox(x.clip, x.asset, W, H) : textBox(x.clip, ref.current, k));
  // a title's box is measured after the composition has drawn it
  const [titleBox, setTitleBox] = useState<Box | null>(null);
  const selTitle = sel && !sel.asset ? sel.clip : null;
  useLayoutEffect(() => {
    const measure = () => {
      const b = selTitle ? textBox(selTitle, ref.current, k) : null;
      setTitleBox((old) => (JSON.stringify(old) === JSON.stringify(b) ? old : b));
    };
    measure();
    const raf = requestAnimationFrame(measure); // the Player may draw the change a frame later
    return () => cancelAnimationFrame(raf);
  }, [selTitle, k, frame]);
  const box = sel ? (sel.asset ? pictureBox(sel.clip, sel.asset, W, H) : titleBox) : null;

  const toProject = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k};
  };

  const crop = cropping && sel?.clip.id === cropping && sel.asset ? {...sel, asset: sel.asset} : null;

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      data-testid="canvas-select"
      onPointerDown={(e) => {
        if (e.button !== 0 || crop) return;
        const pt = toProject(e);
        // the selected clip keeps the pointer when it overlaps another, so it can be dragged out from under it
        const hits = (x: Shown) => {
          const b = boxOf(x);
          return !!b && inside(b, pt.x, pt.y);
        };
        const hit = (sel && hits(sel) ? sel : undefined) ?? shown.find(hits);
        useEditor.getState().select(hit ? [hit.clip.id] : []);
        if (!hit || hit.locked) return;
        drag.current = {id: hit.clip.id, x0: e.clientX, y0: e.clientY, tx: hit.clip.transform.x, ty: hit.clip.transform.y, gesture: crypto.randomUUID()};
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const st = useEditor.getState();
        const cur = st.project && locate(st.project, d.id)?.clip.transform;
        const x = Math.round(d.tx + (e.clientX - d.x0) / k);
        const y = Math.round(d.ty + (e.clientY - d.y0) / k);
        if (cur && (cur.x !== x || cur.y !== y)) st.dispatch({type: "updateClip", clipId: d.id, patch: {transform: {x, y}}}, {coalesce: `canvas:${d.gesture}`, gesture: true, label: "Position"});
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    >
      {crop && <CropBox clip={crop.clip} asset={crop.asset} W={W} H={H} k={k} locked={crop.locked} />}
      {box && !crop && (
        <div
          className={`pointer-events-none absolute outline-2 -outline-offset-2 outline-go ${sel?.locked ? "outline-dashed" : ""}`}
          style={{left: (box.cx - box.w / 2) * k, top: (box.cy - box.h / 2) * k, width: box.w * k, height: box.h * k, transform: `rotate(${box.rot}deg)`}}
          data-testid="canvas-box"
        />
      )}
    </div>
  );
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = {n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", move: "move"};

function CropBox({clip, asset, W, H, k, locked}: {clip: Clip; asset: Asset; W: number; H: number; k: number; locked: boolean}) {
  const drag = useRef<{handle: Handle; x0: number; y0: number; crop0: NonNullable<Clip["crop"]>; gesture: string} | null>(null);
  const full = pictureLayout({fit: "contain"}, asset, W, H); // the whole source, as crop mode draws it
  const left = (W - full.boxW) / 2;
  const top = (H - full.boxH) / 2;
  const c = clip.crop ?? {x: 0, y: 0, width: 1, height: 1};
  const rect = {left: (left + c.x * full.boxW) * k, top: (top + c.y * full.boxH) * k, width: c.width * full.boxW * k, height: c.height * full.boxH * k};
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-testid="crop-mode"
      onPointerDown={(e) => {
        const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-crop]")?.dataset.crop as Handle | undefined;
        if (e.button !== 0 || !handle || locked) return;
        drag.current = {handle, x0: e.clientX, y0: e.clientY, crop0: c, gesture: crypto.randomUUID()};
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const next = dragCrop(d.crop0, d.handle, (e.clientX - d.x0) / k / full.boxW, (e.clientY - d.y0) / k / full.boxH);
        const cur = clip.crop ?? {x: 0, y: 0, width: 1, height: 1};
        if (next.x !== cur.x || next.y !== cur.y || next.width !== cur.width || next.height !== cur.height) {
          useEditor.getState().dispatch({type: "updateClip", clipId: clip.id, patch: {crop: next}}, {coalesce: `crop:${d.gesture}`, gesture: true, label: "Crop"});
        }
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    >
      <div className="absolute cursor-move outline-2 -outline-offset-1 outline-go shadow-[0_0_0_9999px_rgb(11_14_21/0.62)]" style={rect} data-crop="move" data-testid="crop-rect">
        <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-ink/40" />
        <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-ink/40" />
        <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-ink/40" />
        <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-ink/40" />
        {!locked &&
          HANDLES.map((h) => (
            <span
              key={h}
              data-crop={h}
              className="absolute h-3.5 w-3.5 rounded-[2px] border-2 border-go bg-surface"
              // inside the rectangle, so a crop that fills the frame keeps its handles on screen
              style={{
                ...(h.includes("w") ? {left: 0} : h.includes("e") ? {right: 0} : {left: "50%", translate: "-50% 0"}),
                ...(h.includes("n") ? {top: 0} : h.includes("s") ? {bottom: 0} : {top: "50%", translate: h.length === 1 ? "0 -50%" : undefined}),
                cursor: CURSOR[h],
              }}
            />
          ))}
      </div>
    </div>
  );
}
