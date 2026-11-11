// A context menu: a raised list of actions at the pointer. Arrow keys move, Enter runs, Escape or a click outside closes.
import {useEffect, useLayoutEffect, useRef, useState} from "react";

export type MenuItem = {label: string; shortcut?: string; onSelect: () => void; disabled?: boolean; danger?: boolean} | "separator";
export type MenuState = {x: number; y: number; items: MenuItem[]; label: string} | null;

export function ContextMenu({menu, onClose}: {menu: MenuState; onClose: () => void}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{left: number; top: number} | null>(null);

  // Keep the menu inside the window, then focus its first item so the keyboard works straight away.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({left: Math.min(menu.x, window.innerWidth - r.width - 6), top: Math.min(menu.y, window.innerHeight - r.height - 6)});
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const move = (e: React.KeyboardEvent, dir: 1 | -1) => {
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + dir + items.length) % items.length]?.focus();
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={menu.label}
      className="menu fixed z-50 min-w-[200px] py-1"
      style={{left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? "visible" : "hidden"}}
      data-testid="context-menu"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") move(e, 1);
        else if (e.key === "ArrowUp") move(e, -1);
        e.stopPropagation(); // the editor's shortcuts stay off while the menu is open
      }}
    >
      {menu.items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="mx-2 my-1 h-px bg-line-soft" role="separator" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            className={`menu-item ${item.danger ? "menu-item-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && <span className="text-caption text-ink-3">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
