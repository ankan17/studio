---
name: Studio
description: A desktop video editor for an 8GB Mac, drawn as a metro line through time.
colors:
  ground: "#0b0e15"
  surface: "#12161e"
  raised: "#1a1f29"
  hover: "#222833"
  line: "#303640"
  line-soft: "#232832"
  ink: "#eaedf2"
  ink-2: "#b8bec8"
  ink-3: "#959ca7"
  frame: "#05070b"
  go: "#deaf44"
  go-hi: "#ebbc50"
  go-ink: "#1f1400"
  go-text: "#eac15e"
  go-soft: "rgb(222 175 68 / 0.15)"
  video: "#639be1"
  audio: "#ad87d7"
  still: "#39cbcc"
  warn: "#fb9d47"
  danger: "#ef6661"
typography:
  title:
    fontFamily: "Fira Sans, Noto Sans Bengali UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.01em"
  heading:
    fontFamily: "Fira Sans, Noto Sans Bengali UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
  name:
    fontFamily: "Fira Sans, Noto Sans Bengali UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "20px"
  body:
    fontFamily: "Fira Sans, Noto Sans Bengali UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Fira Sans, Noto Sans Bengali UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: "16px"
  caption:
    fontFamily: "Fira Sans, Noto Sans Bengali UI, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: "16px"
  tag:
    fontFamily: "Fira Sans, Noto Sans Bengali UI, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "0.08em"
  readout:
    fontFamily: "Fira Mono, Noto Sans Bengali UI, ui-monospace, monospace"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "20px"
    fontFeature: "tnum"
  measure:
    fontFamily: "Fira Mono, Noto Sans Bengali UI, ui-monospace, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: "16px"
    fontFeature: "tnum"
rounded:
  mark: "3px"
  badge: "4px"
  inner: "5px"
  control: "6px"
  segment: "7px"
  panel: "8px"
  round: "9999px"
spacing:
  hair: "2px"
  xs: "6px"
  sm: "8px"
  gutter: "10px"
  inset: "14px"
  panel: "16px"
  dialog: "20px"
  page: "32px"
components:
  button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-go:
    backgroundColor: "{colors.go}"
    textColor: "{colors.go-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-go-hover:
    backgroundColor: "{colors.go-hi}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
  icon-button:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    size: "30px"
  icon-button-pressed:
    backgroundColor: "{colors.go-soft}"
    textColor: "{colors.go-text}"
  play-button:
    backgroundColor: "{colors.go}"
    textColor: "{colors.go-ink}"
    rounded: "{rounded.round}"
    size: "38px"
  field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  segment:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.segment}"
    padding: "2px"
  segment-option:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.inner}"
    padding: "0 8px"
    height: "24px"
  segment-option-pressed:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  roundel:
    textColor: "{colors.ground}"
    rounded: "{rounded.round}"
    size: "18px"
  duration-badge:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.measure}"
    rounded: "{rounded.badge}"
    padding: "0 6px"
  playhead-readout:
    backgroundColor: "{colors.go}"
    textColor: "{colors.go-ink}"
    typography: "{typography.measure}"
    rounded: "{rounded.badge}"
    padding: "0 6px"
---

# Design System: Studio

## Overview

**Creative North Star: "The Metro Line"**

The edit is a route through time. Every track is a coloured rail, every clip a block riding on it, every cut a station tick, and a cut that lines up across tracks becomes an interchange ring. Colour in this system is a line, not a mood: it tells you what kind of media something is, and it says the same thing in the media panel, the inspector, the timeline and the dashboard. Gold is "your line": the action that moves your work forward, what you have selected, and where you are.

The chrome is midnight-enamel graphite, OKLCH neutrals stepped in lightness at hue 261 to 267 with chroma around 0.016 to 0.022, so the panels read as dark tinted enamel rather than grey plastic. The footage is the brightest thing on screen; the interface frames it with hairline borders, tonal layering and small radii. Density is that of a working tool: 13px body, 28px controls, 10px gutters between panels.

Everything must stay light on an 8GB Mac. There is no blur and no glow, and only one authored entrance (a dialog). Frame stepping and playhead travel are never animated; the picture is the motion.

**Key Characteristics:**
- Media type colour is a line: video blue, audio purple, stills and titles cyan, used identically in roundels, clip bars, rails and project cards.
- Gold is reserved for your line: the primary action, selection, the playhead, and the state of your own work (on the timeline, progress).
- Hue-262 graphite neutrals in four tonal steps (ground, surface, raised, hover), separated by hairlines, not shadows.
- Fira Sans for words, Fira Mono for measurements, Noto Sans Bengali behind both.
- Every text colour passes WCAG AA on every surface it sits on.

## Colors

A dark, hue-tinted graphite field with three media-line colours and one gold for your own line; every hue is mid-lightness and equal chroma (about 0.12), so no line shouts over another.

### Primary
- **Your Line Gold** (go): the primary button, the play button, the playhead and its "you are here" dot, the selected clip and tile outline (2px), the add-to-timeline button, the drop-to-import overlay. Text on it is **Depot Ink** (go-ink) at 8.9:1.
- **Gold Hi** (go-hi): hover state of every gold fill.
- **Brass Text** (go-text): gold as text on dark (Retry, Make preview), the focus ring (2px outline, 2px offset) and pressed icon buttons. At least 8.7:1 on every surface.
- **Gold Wash** (go-soft): 15% gold behind pressed icon buttons and the chosen format card in the New project dialog.

### Secondary
- **Video Line Blue** (video): the video roundel "V", video rails, the 3px bar under video clip blocks.
- **Audio Line Purple** (audio): the audio roundel "A", audio rails, clip bars and waveform strokes.
- **Stills Line Cyan** (still): the image roundel "I" and image clip bars; reserved for titles when they arrive.

### Tertiary
- **Orange Caution** (warn): unsaved and saving dots (saved is an ink-3 check, never a colour, so it cannot be mistaken for them), the memory readout near its budget, missing-file tiles, the recovery notice (10% fill, 30% border).
- **Signal Red** (danger): could-not-save, errors, failed jobs, destructive hover on Trash.

### Neutral
- **Night Ground** (ground): the window, the stage behind the picture, inputs and segmented controls (they sit recessed into the panel).
- **Enamel Surface** (surface): panels.
- **Raised Enamel** (raised): buttons, media tiles, format cards.
- **Hover Enamel** (hover): hover fill and the pressed segment.
- **Line** (line): control borders, ruler ticks, scrollbar thumb.
- **Soft Line** (line-soft): panel borders and dividers.
- **Porcelain Ink** (ink): primary text, 15.4:1 on surface.
- **Ink 2** (ink-2): secondary text and labels, 9.7:1 on surface.
- **Ink 3** (ink-3): captions and metadata, the lowest text contrast in the app (6.5:1 on surface, 5.3:1 on hover).
- **Letterbox** (frame): the area around the picture inside the preview; near-black, never pure black.

### Named Rules
**The Colour Is a Line Rule.** A media type has exactly one colour and one letter (V, A, I), and every surface that shows that type uses both, from the media tile roundel to the timeline rail to the dashboard card. Colour never decorates; it identifies.

**The Your Line Rule.** Gold belongs to the user's own route: the primary action, selection, the playhead, and the state of their work (on the timeline, progress). Sliders, segmented controls and secondary buttons stay neutral; a slider fills with ink-2, not gold.

**The AA Everywhere Rule.** Every text colour passes 4.5:1 on every surface it can sit on, ink-3 on hover included. A new text colour that fails on hover enamel does not ship.

## Typography

**Body Font:** Fira Sans (400, 500, 600; with Noto Sans Bengali UI, system-ui)
**Label/Mono Font:** Fira Mono (400, 500; with Noto Sans Bengali UI, ui-monospace)

**Character:** Fira Sans is the signage face of a transit system: plain, open, legible at 11px. Fira Mono carries anything you measure, so timecode and dimensions line up and read as instruments. Both are bundled (SIL OFL) and Bengali names fall through to Noto Sans Bengali in either.

### Hierarchy
- **Title** (600, 22px, 28px, -0.01em): the Projects page heading only.
- **Heading** (600, 15px, 20px): panel names (Media, Timeline), dialog titles, empty-state headings.
- **Name** (600, 13px, 20px): project name in the title bar, clip name in the inspector, inspector section titles (Picture, Sound).
- **Body** (400, 13px, 20px): explanations and empty states, capped at 68ch.
- **Label** (500, 12.5px, 16px): buttons, fields, inspector row labels.
- **Caption** (400, 11.5px, 16px): metadata, counts, save state, hints.
- **Tag** (600, 10.5px, 14px, 0.08em, uppercase): track tags (V1, A1) and nothing else.
- **Readout** (Fira Mono 500, 16px, 20px): the transport's current timecode.
- **Measure** (Fira Mono 400, 10.5 to 11.5px): durations, timecode, dimensions, fps, ruler marks.

### Named Rules
**The Instrument Rule.** Measurements are set in Fira Mono with tabular figures: timecode, durations, dimensions, fps, dB and percent readouts. Counts and dates ("5 items", "edited Nov 11") are words and stay in Fira Sans with tabular figures.

**The One Uppercase Rule.** The track tag is the only uppercase text in the app. No eyebrows, no small-caps section labels.

## Layout

The editor is a fixed, full-window tool: a 44px title bar (hidden-inset, 84px left inset for the traffic lights), then three columns in a row separated by 10px gutters (media panel 340px, viewer flexible, inspector 300px), then the route timeline across the full width, then a 24px status bar. Panels pad 14px (media, timeline) or 16px (inspector); the dialog pads 20px. The timeline is drawn on a fixed geometry: 168px track header column, 14px rail padding, 60px rows (four show, more scroll), 36px header with the tools, 26px ruler, 10px scrollbar row; ruler steps choose the smallest interval that leaves at least 84px between marks, counting frames once zoomed past one label a second.

The dashboard is a centred column (max 1100px, 32px padding) with an auto-fill card grid (min 250px, 20px column and 28px row gaps). Inspector rows are a 72px label column and a control column with 12px gaps. Long prose is capped at 68ch.

## Elevation & Depth

The system is flat and tonal. Depth is the order ground, surface, raised, hover, each about 4 OKLCH lightness steps apart, with hairline borders (line-soft for panels, line for controls). Inputs and segmented controls drop back to ground so they read as wells cut into the panel. Shadows are ambient and rare.

### Shadow Vocabulary
- **Dialog lift** (`box-shadow: 0 24px 64px -12px rgb(5 7 11 / 0.7)`): the New project dialog over a 75% ground scrim.
- **Menu lift** (`box-shadow: 0 12px 32px -8px rgb(5 7 11 / 0.7)`): context menus. With the dialog, the only lifted surfaces.
- **Thumb lift** (`box-shadow: 0 1px 3px rgb(5 7 11 / 0.5)`): the slider thumb, so the ink disc separates from its track.
- **Surface ring** (`box-shadow: 0 0 0 2px var(--color-surface)`): a cut-out ring around station ticks, the interchange ring, the playhead dot and the on-timeline dot, so marks sit on the rail rather than merge into it.

### Named Rules
**The No Blur Rule.** No backdrop blur, no glows, no gradient washes; the memory budget forbids them and the footage must stay the brightest thing on screen. A scrim is a flat ground tint.

## Shapes

Small, consistent radii from a single family: 6px controls, 8px panels and project cards, 7px around a segmented control with 5px options inside, 4px badges (durations, the playhead readout), 3px aspect frames. Circles are reserved for transit marks: roundels, the play button, the add button, status dots and the playhead's "you are here" dot. Rails are 4px rounded bars at 70% opacity; station ticks are 4px ink pills; the interchange is a 14px-wide ink ring with a 3px stroke spanning every track.

## Components

### Buttons
Quiet, compact and tactile.
- **Shape:** gently rounded (6px), 28px tall, 12px side padding, 6px icon gap.
- **Default:** raised enamel fill, line border, label type at 500.
- **Go (primary):** gold fill, no border, depot ink text at 600; 32 to 36px tall where it is the page's main action. One per view.
- **Ghost:** transparent, ink-2 text, brightening to ink on hover.
- **Hover / Active:** fill steps to hover (or go-hi), 150ms ease-out; press scales to 0.97 in 120ms. Disabled at 45% opacity. Reduced motion removes the transitions.
- **Icon button:** 30px square, ink-2 icon, hover fill; pressed (aria-pressed) takes the gold wash with go-text. Press scales to 0.94.
- **Play button:** a 38px gold circle at the centre of the transport, the largest gold mark in the editor.

### Segmented control
- **Style:** a ground well (7px radius, line-soft border, 2px padding) of equal-width 24px options at 12px/500 in ink-2.
- **State:** the chosen option takes the hover fill and ink. Neutral by design: a choice is not "your line".

### Inputs / Fields
- **Style:** ground fill, line border, 6px radius, 28px tall (36px in the dialog), 10px padding; placeholders in ink-3. Numeric fields are Fira Mono with the unit (X, Y, s) set inside on the right in caption ink-3.
- **Focus:** border turns go in 150ms; keyboard focus elsewhere draws a 2px go-text outline offset 2px.
- **Sliders:** neutral. A 4px line track filled with ink-2 up to the value, a 14px ink thumb with the thumb lift, scaling to 1.12 while dragged; the value sits to the right in Fira Mono.

### Cards / Containers
- **Panel:** surface fill, 1px line-soft border, 8px radius.
- **Media tile:** 16:10 raised frame with a line-soft ring and 6px radius; roundel top-left, duration badge bottom-right, a gold dot top-right when the asset is on the timeline, a 24px gold add button bottom-left, a 3px progress bar along the bottom while preparing. Selected: 2px go outline offset 1px.
- **Project card:** 16:9 surface frame, 8px radius, ring brightening from line-soft to line on hover; below it the name, the media roundels at 14px, and Fira Mono dimensions. Card actions appear on hover or focus.
- **Empty state:** a dashed line border, 8px radius, a heading and one sentence of body that says what to do.

### Line Roundel (signature)
An 18px circle filled with the media type's line colour, carrying its letter (V, A, I) in 10px/600 ground ink. The same mark identifies a tile, a track, the inspected clip and (at 14px) the kinds of media inside a project card.

### Route Timeline (signature)
Each track is a rail in its line colour; clips are blocks tinted 20% of that colour into surface, with a hairline edge, a 50% thumbnail strip, an 11px name and a 3px line-coloured bar along the bottom. Inner cuts are ink station ticks; a frame cut on two or more tracks is an interchange ring across them. The playhead is a 2px gold line with a 14px gold dot on the ruler and a gold Fira Mono timecode flag; the ruler marks step aside around it. Nothing on the timeline animates: the playhead jumps to each frame.

Editing marks: a selected clip has the 2px gold outline and 3px ink trim handles inside its edges (on hover at 70% for unselected clips); a drag that snaps shows a 1px ink snap guide; a locked track's lane is shaded with 50% ground and its clips take no pointer edits; a hidden or muted track dims its clips. Track headers carry the roundel, the tag and 24px icon buttons for hide (video tracks), mute and lock, pressed in the gold wash. The header tools are icon buttons (undo, redo, split, delete, snapping), a ghost "+ Track" button and a neutral zoom slider between zoom out and in, with fit as a pressed icon button. On the preview, the selected clip is outlined in 2px gold inside its picture bounds (dashed when its track is locked).

### Context menu
A raised enamel list (line border, 8px radius, menu lift) of 28px rows in label type, 4px inset with 5px radius hover fills; shortcuts sit right in caption ink-3; separators are line-soft hairlines; a destructive row turns danger red on hover. Arrow keys move, Enter runs, Escape or a click outside closes. No entrance animation.

### Motion
One authored entrance: the dialog grows from 97% in 180ms on ease-out `cubic-bezier(0.23, 1, 0.32, 1)` while its scrim fades in 150ms. Everything else is a 150ms colour transition or a 120ms press scale. Reduced motion disables the entrance, the scrim fade and button transitions. Nothing in the editor animates continuously: a tile without a thumbnail shows a static "No preview" placeholder.

## Do's and Don'ts

### Do:
- **Do** give every media type its one colour and letter everywhere it appears: video blue, audio purple, stills cyan.
- **Do** keep gold for the primary action, selection, the playhead and the state of the user's own work.
- **Do** set every measurement (timecode, duration, dimensions, fps, dB, percent) in Fira Mono with tabular figures; set counts and dates in Fira Sans with tabular figures.
- **Do** build depth from the ground, surface, raised, hover steps and hairline borders.
- **Do** check every new text colour against hover enamel (#222833) for at least 4.5:1.
- **Do** keep sliders and segmented controls neutral.

### Don't:
- **Don't** use blur, backdrop filters, glows or gradient washes; the 8GB memory budget and the footage both forbid them.
- **Don't** add always-running animation to the editor, or animate frame stepping and playhead travel.
- **Don't** add a second entrance animation; the dialog's is the only one.
- **Don't** use uppercase anywhere but the track tag.
- **Don't** use colour decoratively; a hue that is not a media line, gold, orange or red has no job here.
- **Don't** use pure black; the letterbox is #05070b.
