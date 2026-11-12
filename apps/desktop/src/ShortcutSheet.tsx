import {useEffect} from "react";
import {useApp} from "./appStore";
import {Close} from "./icons";
import {SHORTCUT_GROUPS} from "./shortcuts";

export function ShortcutSheet() {
  const open = useApp((s) => s.shortcutsOpen);
  const setOpen = useApp((s) => s.setShortcuts);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="scrim-in fixed inset-0 z-30 grid place-items-center bg-ground/75" onClick={() => setOpen(false)} data-testid="shortcut-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="dialog-in panel grid max-h-[90vh] w-[560px] gap-4 overflow-auto p-5 shadow-[0_24px_64px_-12px_rgb(5_7_11/0.7)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="shortcuts-title" className="text-heading font-semibold">Keyboard shortcuts</h2>
            <p className="mt-1 text-body text-ink-2">Every one of these is also a button or a right-click menu.</p>
          </div>
          <button className="btn btn-ghost !px-2" onClick={() => setOpen(false)} aria-label="Close"><Close size={14} /></button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title} className="grid content-start gap-1.5">
              <h3 className="m-0 text-label font-semibold text-ink-2">{g.title}</h3>
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {g.items.map((it) => (
                  <li key={it.does} className="flex items-start justify-between gap-3 text-body">
                    <span>{it.does}</span>
                    <span className="flex shrink-0 gap-1">
                      {it.keys.map((k) => <kbd key={k} className="num rounded-[4px] border border-line bg-raised px-1.5 text-[11px] leading-5 text-ink">{k}</kbd>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
