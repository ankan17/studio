// The inspector, per clip type: picture for video and stills, sound for video and audio, and the clip's timing. Every
// control writes a field the composition already renders (fit, transform, volume, fades), so what it shows is what
// plays and what exports. Each change is an undoable command; a drag of one control is one undo step.
import {clipKind, locate, MAX_SPEED, MIN_CROP, MIN_SPEED, MIN_TRANSITION, transitionRoom, type ClipPatch, type TextPatch} from "@studio/editor-core";
import {TEXT_PRESETS, TRANSITION_KINDS, timecode, type Clip, type TextPreset, type TransitionKind} from "@studio/schema";
import {BUNDLED_FONTS} from "./engine/fonts";
import {cropMode, useCrop} from "./CanvasSelect";
import {edits} from "./edits";
import {useEditor, useSelectedClipId} from "./editorStore";
import {Duplicate, Lock, Mute, Trash, Undo, Volume} from "./icons";
import {Roundel, clock} from "./ui";

function Row({label, htmlFor, children}: {label: string; htmlFor?: string; children: React.ReactNode}) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
      <label htmlFor={htmlFor} className="text-label text-ink-2">{label}</label>
      {children}
    </div>
  );
}

function Slider({id, value, min, max, step, onChange, display}: {id: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string}) {
  return (
    <span className="flex items-center gap-3">
      <input id={id} type="range" className="min-w-0 flex-1" style={{"--pct": `${((value - min) / (max - min)) * 100}%`} as React.CSSProperties} value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id} className="num w-[52px] text-right text-caption text-ink">{display}</output>
    </span>
  );
}

function NumberField({id, value, step, min, max, unit, onChange}: {id: string; value: number; step: number; min?: number; max?: number; unit: string; onChange: (v: number) => void}) {
  return (
    <span className="relative flex-1">
      <input
        id={id}
        type="number"
        className="field num w-full pr-7 text-ink"
        value={Number(value.toFixed(2))}
        step={step}
        min={min}
        max={max}
        onChange={(e) => e.target.value !== "" && Number.isFinite(Number(e.target.value)) && onChange(Number(e.target.value))}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-caption text-ink-3">{unit}</span>
    </span>
  );
}

/** Linear gain as decibels: 1 is 0.0 dB, 2 is +6.0 dB, 0 is muted. */
function db(v: number): string {
  if (v <= 0.0001) return "Muted";
  const d = 20 * Math.log10(v);
  const text = Math.abs(d).toFixed(1);
  return d >= 0.05 ? `+${text} dB` : d <= -0.05 ? `−${text} dB` : "0.0 dB";
}

function Swatch({id, value, label, onChange}: {id: string; value: string; label: string; onChange: (v: string) => void}) {
  return (
    <input
      id={id}
      type="color"
      aria-label={label}
      className="h-[30px] w-[30px] shrink-0 cursor-pointer appearance-none rounded-[6px] border border-line bg-transparent p-[3px] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const PRESET_NAMES: Record<TextPreset, string> = {none: "None", fade: "Fade", slideUp: "Slide up", pop: "Pop", typewriter: "Typewriter"};
const SHADOW = {color: "rgba(0,0,0,0.6)", blur: 12, x: 0, y: 4};

/** The title's own controls: what it says and how it looks and moves in and out. */
function TextSection({clip, editText}: {clip: Clip; editText: (field: string, patch: TextPatch) => void}) {
  const t = clip.text!;
  const fonts: string[] = [...BUNDLED_FONTS];
  const preset = (field: "enterPreset" | "exitPreset", label: string) => (
    <Row label={label} htmlFor={`insp-${field}`}>
      <select id={`insp-${field}`} className="field text-ink" value={t[field] ?? "none"} onChange={(e) => editText(field, {[field]: e.target.value})}>
        {TEXT_PRESETS.map((p) => <option key={p} value={p}>{PRESET_NAMES[p]}</option>)}
      </select>
    </Row>
  );
  return (
    <div className="grid gap-3 border-t border-line-soft pt-4">
      <h3 className="text-[13px] font-semibold">Text</h3>
      <textarea
        aria-label="Title text"
        data-history-undo
        className="field min-h-[60px] w-full resize-y py-1.5 leading-[18px] text-ink"
        value={t.content}
        rows={2}
        onChange={(e) => editText("content", {content: e.target.value})}
      />
      <Row label="Font" htmlFor="insp-font">
        <select id="insp-font" className="field text-ink" value={t.fontFamily} onChange={(e) => editText("font", {fontFamily: e.target.value})}>
          {!fonts.includes(t.fontFamily) && <option value={t.fontFamily}>{t.fontFamily} (not installed)</option>}
          {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </Row>
      <Row label="Size" htmlFor="insp-size">
        <Slider id="insp-size" value={t.fontSize} min={12} max={300} step={1} display={`${Math.round(t.fontSize)} px`} onChange={(v) => editText("size", {fontSize: v})} />
      </Row>
      <Row label="Colour" htmlFor="insp-color">
        <Swatch id="insp-color" label="Text colour" value={t.color} onChange={(v) => editText("color", {color: v})} />
      </Row>
      <Row label="Align">
        <div className="seg" role="group" aria-label="Alignment">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} aria-pressed={t.alignment === a} onClick={() => editText("align", {alignment: a})}>{a === "center" ? "Centre" : a === "left" ? "Left" : "Right"}</button>
          ))}
        </div>
      </Row>
      <Row label="Box" htmlFor="insp-box">
        <span className="flex items-center gap-2">
          <Swatch id="insp-box" label="Box colour" value={t.background ?? "#000000"} onChange={(v) => editText("box", {background: v})} />
          <div className="seg flex-1" role="group" aria-label="Box">
            <button aria-pressed={!t.background} onClick={() => editText("box", {background: null})}>None</button>
            <button aria-pressed={!!t.background} onClick={() => editText("box", {background: t.background ?? "#000000"})} title="A filled box behind the text">On</button>
          </div>
        </span>
      </Row>
      <Row label="Outline" htmlFor="insp-outline">
        <span className="flex items-center gap-2">
          <Swatch id="insp-outline-color" label="Outline colour" value={t.stroke?.color ?? "#000000"} onChange={(v) => editText("outline-color", {stroke: {color: v, width: t.stroke?.width || 4}})} />
          <span className="min-w-0 flex-1">
            <Slider id="insp-outline" value={t.stroke?.width ?? 0} min={0} max={20} step={1} display={t.stroke?.width ? `${t.stroke.width} px` : "None"} onChange={(v) => editText("outline", {stroke: v > 0 ? {color: t.stroke?.color ?? "#000000", width: v} : null})} />
          </span>
        </span>
      </Row>
      <Row label="Shadow">
        <div className="seg" role="group" aria-label="Shadow">
          <button aria-pressed={!t.shadow} onClick={() => editText("shadow", {shadow: null})}>None</button>
          <button aria-pressed={!!t.shadow} onClick={() => editText("shadow", {shadow: SHADOW})}>Soft</button>
        </div>
      </Row>
      {preset("enterPreset", "Enter")}
      {preset("exitPreset", "Exit")}
    </div>
  );
}

const TRANSITION_NAMES: Record<TransitionKind, string> = {fade: "Dissolve", slide: "Slide", wipe: "Wipe"};

/** The cut after this clip: none, or a dissolve, slide or wipe into the next clip, as long as the footage allows. */
function TransitionSection({clip}: {clip: Clip}) {
  const project = useEditor((s) => s.project)!;
  const dispatch = useEditor((s) => s.dispatch);
  const room = transitionRoom(project, clip.id);
  const t = clip.transitionOut;
  const fps = project.fps;
  return (
    <div className="grid gap-3 border-t border-line-soft pt-4">
      <h3 className="text-[13px] font-semibold">Transition to next clip</h3>
      <div className="seg" role="group" aria-label="Transition">
        <button aria-pressed={!t} onClick={() => edits.setTransition(null, clip.id)}>None</button>
        {TRANSITION_KINDS.map((k) => (
          <button key={k} aria-pressed={t?.kind === k} disabled={!!room.reason} onClick={() => edits.setTransition(k, clip.id)}>{TRANSITION_NAMES[k]}</button>
        ))}
      </div>
      {t && room.max >= MIN_TRANSITION && (
        <Row label="Length" htmlFor="insp-transition">
          <Slider
            id="insp-transition"
            value={t.durationInFrames}
            min={MIN_TRANSITION}
            max={Math.max(room.max, MIN_TRANSITION + 1)}
            step={1}
            display={`${(t.durationInFrames / fps).toFixed(2)} s`}
            onChange={(v) => dispatch({type: "setTransition", clipId: clip.id, transition: {kind: t.kind, durationInFrames: Math.min(room.max, v)}}, {coalesce: `inspector:${clip.id}:transition`})}
          />
        </Row>
      )}
      {room.reason && <p className="text-caption text-ink-2" data-testid="transition-reason">{room.reason}.</p>}
    </div>
  );
}

function Empty({title, body, children}: {title: string; body: string; children?: React.ReactNode}) {
  return (
    <section className="panel flex w-[300px] shrink-0 flex-col p-4" data-testid="inspector">
      <h2 className="text-heading font-semibold">{title}</h2>
      <p className="mt-1 text-body text-ink-2">{body}</p>
      {children}
    </section>
  );
}

export function Inspector() {
  const project = useEditor((s) => s.project)!;
  const selectedId = useSelectedClipId();
  const count = useEditor((s) => s.selection.length);
  const dispatch = useEditor((s) => s.dispatch);
  const cropping = useCrop((s) => s.clipId);
  const found = selectedId ? locate(project, selectedId) : null;
  const clip = found?.clip;
  const asset = clip?.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const fps = project.fps;

  if (count > 1) {
    return (
      <Empty title={`${count} clips selected`} body="Drag any of them on the timeline to move them together, or act on all of them at once.">
        <div className="mt-4 flex gap-2">
          <button className="btn" onClick={edits.duplicate} disabled={!edits.selectionEditable()}><Duplicate size={14} /> Duplicate</button>
          <button className="btn" onClick={edits.delete} disabled={!edits.selectionEditable()}><Trash size={14} /> Delete</button>
        </div>
      </Empty>
    );
  }
  if (!clip || !found || (!asset && !clip.text)) return <Empty title="No clip selected" body="Click a clip on the timeline, or on the picture, to change how it looks and sounds." />;

  const locked = found.track.locked;
  // One undo step per control per gesture: changes to the same field within a second are merged.
  const edit = (field: string, patch: ClipPatch) => dispatch({type: "updateClip", clipId: clip.id, patch}, {coalesce: `inspector:${clip.id}:${field}`});
  const editText = (field: string, patch: TextPatch) => dispatch({type: "updateText", clipId: clip.id, patch}, {coalesce: `inspector:${clip.id}:text-${field}`});
  // a clip on an audio track is sound only, even from a video; a clip with text is a title
  const kind = clip.text ? "text" : clipKind(project, clip, found.track)!;
  const isMedia = kind !== "text";
  const hasPicture = kind !== "audio";
  const hasSound = kind === "audio" || (asset?.type === "video" && (asset.audioChannels ?? 1) > 0);
  const name = clip.text ? clip.text.content.split("\n")[0] || "Empty title" : (asset?.name ?? asset?.relativePath ?? "");
  const end = clip.startFrame + clip.durationInFrames;
  // Crop sides in percent of the picture: left, top, right and bottom are how much is cut away on that side.
  const c = clip.crop ?? {x: 0, y: 0, width: 1, height: 1};
  const sides = {left: c.x, top: c.y, right: 1 - c.x - c.width, bottom: 1 - c.y - c.height};
  const setSide = (side: keyof typeof sides, pct: number) => {
    const v = Math.max(0, pct / 100);
    let [l, t, r, b] = [c.x, c.y, c.x + c.width, c.y + c.height];
    if (side === "left") l = Math.min(v, r - MIN_CROP);
    if (side === "top") t = Math.min(v, b - MIN_CROP);
    if (side === "right") r = Math.max(1 - v, l + MIN_CROP);
    if (side === "bottom") b = Math.max(1 - v, t + MIN_CROP);
    edit(`crop-${side}`, {crop: {x: l, y: t, width: r - l, height: b - t}});
  };
  const maxFade = clip.durationInFrames / fps;

  return (
    <section className="panel flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto p-4" data-testid="inspector">
      <div>
        <div className="flex items-center gap-2">
          <Roundel kind={kind} />
          <h2 className="min-w-0 truncate text-[13px] font-semibold" title={name}>{name}</h2>
        </div>
        <div className="num mt-1 text-caption text-ink-3">
          {clock(clip.startFrame / fps)} to {clock(end / fps)}
          {clip.text ? " · Title" : asset?.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
        </div>
        {locked && (
          <p className="mt-2 flex items-center gap-1.5 text-caption text-ink-2"><Lock size={12} /> This clip is on a locked track. Unlock the track to change it.</p>
        )}
      </div>

      <fieldset disabled={locked} className="contents">
      <div className="grid gap-3 border-t border-line-soft pt-4">
        <h3 className="text-[13px] font-semibold">Timing</h3>
        <Row label="Starts at"><span className="num text-caption text-ink" data-testid="insp-start">{timecode(clip.startFrame, fps)}</span></Row>
        <Row label="Length"><span className="num text-caption text-ink" data-testid="insp-length">{timecode(clip.durationInFrames, fps)}</span></Row>
        {asset && asset.type !== "image" && (
          <Row label="Speed" htmlFor="insp-speed">
            <Slider
              id="insp-speed"
              value={clip.speed}
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={0.05}
              display={`${Number(clip.speed.toFixed(2))}×`}
              onChange={(v) => dispatch({type: "setSpeed", clipId: clip.id, speed: v}, {coalesce: `inspector:${clip.id}:speed`})}
            />
          </Row>
        )}
        {asset && asset.type !== "image" && <Row label="From source"><span className="num text-caption text-ink">{timecode(Math.round((clip.sourceStartUs / 1e6) * fps), fps)}</span></Row>}
      </div>

      {clip.text && <TextSection clip={clip} editText={editText} />}

      {hasPicture && (
        <div className="grid gap-3 border-t border-line-soft pt-4">
          <h3 className="text-[13px] font-semibold">Picture</h3>
          {isMedia && <Row label="Fit">
            <div className="seg" role="group" aria-label="Fit">
              <button aria-pressed={clip.fit === "contain"} onClick={() => edit("fit", {fit: "contain"})} title="Show the whole picture">Fit</button>
              <button aria-pressed={clip.fit === "cover"} onClick={() => edit("fit", {fit: "cover"})} title="Fill the frame, cropping the edges">Fill</button>
            </div>
          </Row>}
          <Row label="Scale" htmlFor="insp-scale">
            <Slider id="insp-scale" value={clip.transform.scale} min={0.1} max={3} step={0.01} display={`${Math.round(clip.transform.scale * 100)}%`} onChange={(v) => edit("scale", {transform: {scale: v}})} />
          </Row>
          <Row label="Position" htmlFor="insp-x">
            <span className="flex gap-2">
              <NumberField id="insp-x" value={clip.transform.x} step={1} unit="X" onChange={(v) => edit("x", {transform: {x: Math.round(v)}})} />
              <NumberField id="insp-y" value={clip.transform.y} step={1} unit="Y" onChange={(v) => edit("y", {transform: {y: Math.round(v)}})} />
            </span>
          </Row>
          <Row label="Rotation" htmlFor="insp-rotation">
            <Slider id="insp-rotation" value={clip.transform.rotation} min={-180} max={180} step={1} display={`${Math.round(clip.transform.rotation)}°`} onChange={(v) => edit("rotation", {transform: {rotation: v}})} />
          </Row>
          {isMedia && <Row label="Flip">
            <div className="seg" role="group" aria-label="Flip">
              <button aria-pressed={!clip.transform.flipH} onClick={() => edit("flip", {transform: {flipH: false}})}>Normal</button>
              <button aria-pressed={clip.transform.flipH} onClick={() => edit("flip", {transform: {flipH: true}})} title="Mirror left to right">Mirrored</button>
            </div>
          </Row>}
          <Row label="Opacity" htmlFor="insp-opacity">
            <Slider id="insp-opacity" value={clip.transform.opacity} min={0} max={1} step={0.01} display={`${Math.round(clip.transform.opacity * 100)}%`} onChange={(v) => edit("opacity", {transform: {opacity: v}})} />
          </Row>
          {isMedia && (<>
          <Row label="Crop">
            <span className="flex gap-2">
              <button className="btn flex-1" aria-pressed={cropping === clip.id} onClick={() => (cropping === clip.id ? cropMode.stop() : cropMode.start(clip.id))} title="Drag the edges of the picture to crop it">
                {cropping === clip.id ? "Done" : "Crop on picture"}
              </button>
              <button className="icon-btn" aria-label="Reset crop" title="Show the whole picture again" disabled={!clip.crop} onClick={() => edit("crop-reset", {crop: null})}><Undo size={14} /></button>
            </span>
          </Row>
          <div className="grid grid-cols-[76px_1fr_1fr] items-center gap-x-2 gap-y-2" title="How much of each edge is cut away, in percent: left, right, top, bottom">
            <label htmlFor="insp-crop-left" className="text-label text-ink-2">Cut edges %</label>
            <NumberField id="insp-crop-left" value={sides.left * 100} step={1} min={0} max={95} unit="L" onChange={(v) => setSide("left", v)} />
            <NumberField id="insp-crop-right" value={sides.right * 100} step={1} min={0} max={95} unit="R" onChange={(v) => setSide("right", v)} />
            <span />
            <NumberField id="insp-crop-top" value={sides.top * 100} step={1} min={0} max={95} unit="T" onChange={(v) => setSide("top", v)} />
            <NumberField id="insp-crop-bottom" value={sides.bottom * 100} step={1} min={0} max={95} unit="B" onChange={(v) => setSide("bottom", v)} />
          </div>
          </>)}
        </div>
      )}

      {isMedia && hasPicture && <TransitionSection clip={clip} />}

      {hasSound && (
        <div className="grid gap-3 border-t border-line-soft pt-4">
          <h3 className="text-[13px] font-semibold">Sound</h3>
          <Row label="Sound">
            <span className="flex gap-2">
              <button className="btn flex-1" aria-pressed={clip.muted} onClick={() => edit("muted", {muted: !clip.muted})} title={clip.muted ? "Play this clip's sound" : "Silence this clip"}>
                {clip.muted ? <Mute size={14} /> : <Volume size={14} />} {clip.muted ? "Muted" : "On"}
              </button>
              {kind === "video" && <button className="btn flex-1" onClick={edits.detachAudio} title="Put this clip's sound on an audio track, so it can be moved and cut on its own">Detach audio</button>}
            </span>
          </Row>
          <Row label="Volume" htmlFor="insp-volume">
            <Slider id="insp-volume" value={clip.volume} min={0} max={2} step={0.01} display={db(clip.volume)} onChange={(v) => edit("volume", {volume: v})} />
          </Row>
          <Row label="Fade in" htmlFor="insp-fadein">
            <NumberField id="insp-fadein" value={clip.fadeInFrames / fps} step={0.1} min={0} max={maxFade} unit="s" onChange={(v) => edit("fadeIn", {fadeInFrames: Math.round(Math.min(maxFade, Math.max(0, v)) * fps)})} />
          </Row>
          <Row label="Fade out" htmlFor="insp-fadeout">
            <NumberField id="insp-fadeout" value={clip.fadeOutFrames / fps} step={0.1} min={0} max={maxFade} unit="s" onChange={(v) => edit("fadeOut", {fadeOutFrames: Math.round(Math.min(maxFade, Math.max(0, v)) * fps)})} />
          </Row>
        </div>
      )}

      </fieldset>
      <p className="mt-auto text-caption text-ink-3">Changes apply to this clip only and are saved as you go. {navigator.platform.startsWith("Mac") ? "⌘Z" : "Ctrl+Z"} undoes them.</p>
    </section>
  );
}
