// The inspector: picture and sound for the clip selected on the timeline. Every control writes a field the composition
// already renders (fit, transform, volume, fades), so what it shows is what plays and what exports.
import type {Clip, Project} from "@studio/schema";
import {useEditor} from "./editorStore";
import {Roundel, clock} from "./ui";

function findClip(p: Project, id: string | null): Clip | null {
  if (!id) return null;
  for (const t of p.tracks) for (const c of t.clips) if (c.id === id) return c;
  return null;
}

function Row({label, htmlFor, children}: {label: string; htmlFor?: string; children: React.ReactNode}) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-3">
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

export function Inspector() {
  const project = useEditor((s) => s.project)!;
  const selectedId = useEditor((s) => s.selectedClipId);
  const update = useEditor((s) => s.update);
  const clip = findClip(project, selectedId);
  const asset = clip?.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const fps = project.fps;

  if (!clip || !asset) {
    return (
      <section className="panel flex w-[300px] shrink-0 flex-col p-4" data-testid="inspector">
        <h2 className="text-heading font-semibold">No clip selected</h2>
        <p className="mt-1 text-body text-ink-2">Click a clip on the timeline to change how it looks and sounds.</p>
      </section>
    );
  }

  const edit = (recipe: (c: Clip) => void) =>
    update((p) => {
      for (const t of p.tracks) for (const c of t.clips) if (c.id === clip.id) recipe(c);
    });
  const hasPicture = asset.type !== "audio";
  const hasSound = asset.type === "audio" || (asset.type === "video" && (asset.audioChannels ?? 1) > 0);
  const end = clip.startFrame + clip.durationInFrames;
  const maxFade = clip.durationInFrames / fps;

  return (
    <section className="panel flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto p-4" data-testid="inspector">
      <div>
        <div className="flex items-center gap-2">
          <Roundel kind={asset.type} />
          <h2 className="min-w-0 truncate text-[13px] font-semibold" title={asset.name}>{asset.name ?? asset.relativePath}</h2>
        </div>
        <div className="num mt-1 text-caption text-ink-3">
          {clock(clip.startFrame / fps)} to {clock(end / fps)}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
        </div>
      </div>

      {hasPicture && (
        <div className="grid gap-3 border-t border-line-soft pt-4">
          <h3 className="text-[13px] font-semibold">Picture</h3>
          <Row label="Fit">
            <div className="seg" role="group" aria-label="Fit">
              <button aria-pressed={clip.fit === "contain"} onClick={() => edit((c) => void (c.fit = "contain"))} title="Show the whole picture">Fit</button>
              <button aria-pressed={clip.fit === "cover"} onClick={() => edit((c) => void (c.fit = "cover"))} title="Fill the frame, cropping the edges">Fill</button>
            </div>
          </Row>
          <Row label="Scale" htmlFor="insp-scale">
            <Slider id="insp-scale" value={clip.transform.scale} min={0.1} max={3} step={0.01} display={`${Math.round(clip.transform.scale * 100)}%`} onChange={(v) => edit((c) => void (c.transform.scale = v))} />
          </Row>
          <Row label="Position" htmlFor="insp-x">
            <span className="flex gap-2">
              <NumberField id="insp-x" value={clip.transform.x} step={1} unit="X" onChange={(v) => edit((c) => void (c.transform.x = Math.round(v)))} />
              <NumberField id="insp-y" value={clip.transform.y} step={1} unit="Y" onChange={(v) => edit((c) => void (c.transform.y = Math.round(v)))} />
            </span>
          </Row>
          <Row label="Opacity" htmlFor="insp-opacity">
            <Slider id="insp-opacity" value={clip.transform.opacity} min={0} max={1} step={0.01} display={`${Math.round(clip.transform.opacity * 100)}%`} onChange={(v) => edit((c) => void (c.transform.opacity = v))} />
          </Row>
        </div>
      )}

      {hasSound && (
        <div className="grid gap-3 border-t border-line-soft pt-4">
          <h3 className="text-[13px] font-semibold">Sound</h3>
          <Row label="Volume" htmlFor="insp-volume">
            <Slider id="insp-volume" value={clip.volume} min={0} max={2} step={0.01} display={db(clip.volume)} onChange={(v) => edit((c) => void (c.volume = v))} />
          </Row>
          <Row label="Fade in" htmlFor="insp-fadein">
            <NumberField id="insp-fadein" value={clip.fadeInFrames / fps} step={0.1} min={0} max={maxFade} unit="s" onChange={(v) => edit((c) => void (c.fadeInFrames = Math.round(Math.min(maxFade, Math.max(0, v)) * fps)))} />
          </Row>
          <Row label="Fade out" htmlFor="insp-fadeout">
            <NumberField id="insp-fadeout" value={clip.fadeOutFrames / fps} step={0.1} min={0} max={maxFade} unit="s" onChange={(v) => edit((c) => void (c.fadeOutFrames = Math.round(Math.min(maxFade, Math.max(0, v)) * fps)))} />
          </Row>
        </div>
      )}

      <p className="mt-auto text-caption text-ink-3">Changes apply to this clip only and are saved as you go.</p>
    </section>
  );
}
