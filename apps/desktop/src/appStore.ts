// App-level renderer state that belongs to no single screen: the crash notice and the shortcut sheet.
import {create} from "zustand";

type AppState = {
  /** The last session ended without a clean quit. Shown once, on the dashboard. */
  previousCrash: boolean;
  shortcutsOpen: boolean;
  setShortcuts: (open: boolean) => void;
  dismissCrash: () => void;
};

export const useApp = create<AppState>((set) => ({
  previousCrash: false,
  shortcutsOpen: false,
  setShortcuts: (open) => set({shortcutsOpen: open}),
  dismissCrash: () => set({previousCrash: false}),
}));
