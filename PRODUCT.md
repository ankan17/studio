# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app for macOS: a web renderer inside a native window with a hidden-inset title bar, so macOS window conventions apply.)

## Users

The primary editor is a non-technical person who has used consumer editors such as CapCut or iMovie, so knows what a timeline is but not pro conventions. They edit on an 8GB Apple Silicon Mac, mostly iPhone footage (portrait, HDR HEVC, mixed frame rates), and must be able to use the app without training.

## Product Purpose

Studio is a desktop video editor that stays usable on an 8GB Apple Silicon Mac: import phone clips, put them on a timeline, preview, and export a finished video in landscape, vertical, portrait or square. Success means the editor finishes a video without help, without losing work, and without the machine bogging down.

## Positioning

Local, project-folder editor with no subscription. The preview and the export use the same composition, so what plays is what exports. Work is autosaved, with crash-safe atomic saves and recovery copies. Built to stay within memory limits on an 8GB Mac (editor tab under 600MB, total under 1.2GB, export peak under 1.5GB).

## Operating Context

- Media arrives from Finder (dialog or drag and drop) and is copied into the project. Proxies (720p), thumbnails and audio peaks are generated in the background.
- Projects live in the app's data folder; the dashboard lists them with thumbnails, and they can be renamed, duplicated (into another format) and trashed.
- Keyboard: Space plays and pauses, arrow keys step a frame (Shift steps a second), Home and End jump.

## Capabilities and Constraints

- Built so far: dashboard, new project (format presets, 24/25/30/60 fps), media panel (import, search, filters, missing files and relink, remove unused), preview stage, transport, read-only sequence strip, memory HUD, autosave state.
- Planned: M4 full timeline editing (trim, split, zoom, snapping), then text, transitions (fade, slide, wipe) and export.
- Text in videos must support Bengali and English (Noto Sans Bengali, Bebas Neue are the content fonts).
- Memory budget is a hard constraint on every UI choice: no heavy effects, large images or always-running animation in the editor.

## Brand Commitments

Name: Studio. The UI identity ("Metro line": colour means media type, gold is the user's own line, Fira Sans and Fira Mono) was approved by the user on 2026-11-11 and is recorded in DESIGN.md. The accent changed from green to gold (stills to cyan, warnings to orange) at the user's request on 2026-11-11.

## Evidence on Hand

No testimonials, users, or published videos. Test footage is synthetic (ffmpeg test patterns); real footage lives only on the target Mac.

## Product Principles

1. Never lose work, and say so plainly (save state is always visible).
2. Obvious over clever: a CapCut or iMovie user should find every action without a manual.
3. The footage is the brightest thing on screen; the interface frames it.
4. Stay light on an 8GB Mac; performance is a feature the user can feel.
