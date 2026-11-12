// The keyboard shortcuts, in one place: the shortcut sheet shows this list, and Editor.tsx's key handler implements it.
export type Shortcut = {keys: string[]; does: string};
export const SHORTCUT_GROUPS: {title: string; items: Shortcut[]}[] = [
  {
    title: "Playback",
    items: [
      {keys: ["Space"], does: "Play or pause"},
      {keys: ["←", "→"], does: "Step one frame"},
      {keys: ["⇧ ←", "⇧ →"], does: "Step one second"},
      {keys: ["Home", "End"], does: "Jump to the start or the end"},
    ],
  },
  {
    title: "Editing",
    items: [
      {keys: ["S", "⌘B"], does: "Split the selected clip at the playhead"},
      {keys: ["⌫", "Delete"], does: "Delete the selection"},
      {keys: ["⌘D"], does: "Duplicate the selection"},
      {keys: ["⌘A"], does: "Select every clip"},
      {keys: ["Esc"], does: "Clear the selection"},
      {keys: ["⌘Z"], does: "Undo"},
      {keys: ["⇧⌘Z", "⌘Y"], does: "Redo"},
      {keys: ["T"], does: "Add a title at the playhead"},
      {keys: ["M"], does: "Add a marker at the playhead"},
    ],
  },
  {
    title: "Timeline view",
    items: [
      {keys: ["⌘=", "⌘−"], does: "Zoom the timeline in or out"},
      {keys: ["⇧Z"], does: "Fit the whole timeline"},
      {keys: ["N"], does: "Turn snapping on or off"},
    ],
  },
  {
    title: "Anywhere",
    items: [
      {keys: ["?", "⌘/"], does: "Show this list"},
      {keys: ["Esc"], does: "Close a dialog"},
    ],
  },
];
