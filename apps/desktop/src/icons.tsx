// A small hand-drawn icon set: 24px grid, 1.6 stroke, round caps. Everything inherits currentColor.
import type {ReactNode} from "react";

const base = (children: ReactNode, size: number, fill = false) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

type P = {size?: number};
export const Play = ({size = 16}: P) => base(<path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l10-6.4a.6.6 0 0 0 0-1L8.92 5.1a.6.6 0 0 0-.92.5Z" />, size, true);
export const Pause = ({size = 16}: P) => base(<><rect x="6.5" y="5" width="3.8" height="14" rx="1" /><rect x="13.7" y="5" width="3.8" height="14" rx="1" /></>, size, true);
export const StepBack = ({size = 16}: P) => base(<><path d="M15 6l-6 6 6 6" /><path d="M6.5 6v12" /></>, size);
export const StepFwd = ({size = 16}: P) => base(<><path d="M9 6l6 6-6 6" /><path d="M17.5 6v12" /></>, size);
export const SkipStart = ({size = 16}: P) => base(<><path d="M18 6v12l-8-6z" /><path d="M6 6v12" /></>, size);
export const SkipEnd = ({size = 16}: P) => base(<><path d="M6 6v12l8-6z" /><path d="M18 6v12" /></>, size);
export const Plus = ({size = 16}: P) => base(<path d="M12 5v14M5 12h14" />, size);
export const Import = ({size = 16}: P) => base(<><path d="M12 4v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19h14" /></>, size);
export const Search = ({size = 16}: P) => base(<><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></>, size);
export const Trash = ({size = 16}: P) => base(<><path d="M5 7h14" /><path d="M9 7V5h6v2" /><path d="M7 7l1 12h8l1-12" /></>, size);
export const Film = ({size = 16}: P) => base(<><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M4 9h3M4 15h3M17 9h3M17 15h3M8 4v16M16 4v16" /></>, size);
export const Music = ({size = 16}: P) => base(<><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>, size);
export const Picture = ({size = 16}: P) => base(<><rect x="4" y="5" width="16" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.5" /><path d="M20 16l-4.5-4.5L7 19" /></>, size);
export const Check = ({size = 16}: P) => base(<path d="M5 12.5l4.5 4.5L19 7.5" />, size);
export const Close = ({size = 16}: P) => base(<path d="M6 6l12 12M18 6L6 18" />, size);
export const Warning = ({size = 16}: P) => base(<><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.2v.1" /></>, size);
export const Link = ({size = 16}: P) => base(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>, size);
export const Back = ({size = 16}: P) => base(<path d="M14.5 6l-6 6 6 6" />, size);
export const Volume = ({size = 16}: P) => base(<><path d="M5 10v4h3l4 3.5v-11L8 10z" /><path d="M16 9.5a3.5 3.5 0 0 1 0 5" /></>, size);
export const Loop = ({size = 16}: P) => base(<><path d="M17 4l3 3-3 3" /><path d="M4 11V9a2 2 0 0 1 2-2h14" /><path d="M7 20l-3-3 3-3" /><path d="M20 13v2a2 2 0 0 1-2 2H4" /></>, size);
export const Layers = ({size = 16}: P) => base(<><path d="M12 4l9 5-9 5-9-5z" /><path d="M3 14l9 5 9-5" /></>, size);
export const Duplicate = ({size = 16}: P) => base(<><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" /></>, size);
export const Pencil = ({size = 16}: P) => base(<><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /></>, size);
export const Wave = ({size = 16}: P) => base(<path d="M4 12h1.5M8 8v8M12 5v14M16 9v6M20 12h-1.5" />, size);
export const Undo = ({size = 16}: P) => base(<><path d="M9 14L4.5 9.5 9 5" /><path d="M5 9.5h9.5a5 5 0 0 1 0 10H11" /></>, size);
export const Redo = ({size = 16}: P) => base(<><path d="M15 14l4.5-4.5L15 5" /><path d="M19 9.5H9.5a5 5 0 0 0 0 10H13" /></>, size);
export const Scissors = ({size = 16}: P) => base(<><circle cx="6.5" cy="7" r="2.5" /><circle cx="6.5" cy="17" r="2.5" /><path d="M8.6 8.4L20 17M8.6 15.6L20 7" /></>, size);
export const Magnet = ({size = 16}: P) => base(<><path d="M6 4v8a6 6 0 0 0 12 0V4" /><path d="M6 8h3.5M14.5 8H18" /><path d="M9.5 4v8a2.5 2.5 0 0 0 5 0V4" /></>, size);
export const Lock = ({size = 16}: P) => base(<><rect x="5.5" y="10.5" width="13" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>, size);
export const Unlock = ({size = 16}: P) => base(<><rect x="5.5" y="10.5" width="13" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.6" /></>, size);
export const Eye = ({size = 16}: P) => base(<><path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6Z" /><circle cx="12" cy="12" r="2.5" /></>, size);
export const EyeOff = ({size = 16}: P) => base(<><path d="M9.9 6.3A9.6 9.6 0 0 1 12 6c5.7 0 9 6 9 6a15.6 15.6 0 0 1-2.2 3M6.2 7.8C4.2 9.4 3 12 3 12s3.3 6 9 6a9 9 0 0 0 4.3-1.1" /><path d="M4 4l16 16" /></>, size);
export const Mute = ({size = 16}: P) => base(<><path d="M5 10v4h3l4 3.5v-11L8 10z" /><path d="M16 10l4 4M20 10l-4 4" /></>, size);
export const Minus = ({size = 16}: P) => base(<path d="M5 12h14" />, size);
export const FitWidth = ({size = 16}: P) => base(<><path d="M4 6v12M20 6v12" /><path d="M8 12h8" /><path d="M10.5 9.5L8 12l2.5 2.5M13.5 9.5L16 12l-2.5 2.5" /></>, size);
