// Selection on the picture: click a clip in the preview to select it, drag it to position it. The box follows the
// clip's transform (position, scale, rotation) and fit, the same maths the composition uses to draw it.
import {locate} from "@studio/editor-core";
import {clipsAtFrame, type Asset, type Clip, type Project} from "@studio/schema";
import {useLayoutEffect, useRef, useState} from "react";
import {useEditor, useSelectedClipId} from "./editorStore";
import {usePlayback} from "./playback";

type Box = {cx: number; cy: number; w: number; h: number; rot: number};

/** Where a clip's picture sits in project pixels: the fitted picture, then translate, rotate and scale about its centre. */
export function pictureBox(clip: Clip, asset: Asset, W: number, H: number): Box {
  let w = W;
  let h = H;
  if (clip.fit === "contain" && asset.width && asset.height) {
    const a = asset.width / asset.height;
    if (a > W / H) h = W / a;
    else w = H * a;
  }
  const t = clip.transform;
  return {cx: W / 2 + t.x, cy: H / 2 + t.y, w: w * t.scale, h: h * t.scale, rot: t.rotation};
}

function inside(b: Box, x: number, y: number): boolean {
  const r = (-b.rot * Math.PI) / 180;
  const dx = x - b.cx;
  const dy = y - b.cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

/** Clips with a picture under the playhead, top layer first. */
function pictures(p: Project, frame: number): {clip: Clip; asset: Asset; locked: boolean}[] {
  return clipsAtFrame(p, frame)
    .filter(({track}) => track.visible)
    .map(({track, clip}) => ({clip, asset: p.assets.find((a) => a.id === clip.assetId), locked: track.locked}))
    .filter((x): x is {clip: Clip; asset: Asset; locked: boolean} => !!x.asset && x.asset.type !== "audio");
}

export function CanvasSelect() {
  const project = useEditor((s) => s.project)!;
  const selectedId = useSelectedClipId();
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

  const shown = pictures(project, frame);
  const sel = shown.find((x) => x.clip.id === selectedId);
  const box = sel && pictureBox(sel.clip, sel.asset, W, H);

  const toProject = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k};
  };

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      data-testid="canvas-select"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const pt = toProject(e);
        // the selected clip keeps the pointer when it overlaps another, so it can be dragged out from under it
        const hit = (sel && inside(pictureBox(sel.clip, sel.asset, W, H), pt.x, pt.y) ? sel : undefined) ?? shown.find((x) => inside(pictureBox(x.clip, x.asset, W, H), pt.x, pt.y));
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
      {box && (
        <div
          className={`pointer-events-none absolute outline-2 -outline-offset-2 outline-go ${sel?.locked ? "outline-dashed" : ""}`}
          style={{left: (box.cx - box.w / 2) * k, top: (box.cy - box.h / 2) * k, width: box.w * k, height: box.h * k, transform: `rotate(${box.rot}deg)`}}
          data-testid="canvas-box"
        />
      )}
    </div>
  );
}
