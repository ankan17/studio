---
version: 1
slug: "src-editor-tsx"
primary_target: "src/Editor.tsx"
related_targets: ["src/Dashboard.tsx"]
---

# Editor and dashboard (Studio desktop app)

Scope: the whole app shell (dashboard, new-project dialog, editor). Visitor mode: Operate.
Audience and job: a non-technical editor who knows CapCut or iMovie, cutting iPhone clips into short videos on an 8GB Mac. Task: import, arrange, adjust a clip, preview; never lose work.
Constraints: memory budget (no blur, no always-running animation), no controls for features that do not exist yet (split, titles, zoom, export arrive in later milestones), Bengali and English names.
Chosen structure: three columns (media, viewer, inspector for the selected clip) over a route timeline.
Memorable moment: the timeline reads like a metro line, and cuts that line up across tracks show an interchange ring.

## Direction contract

THESIS: The edit is a route through time. Colour means media type everywhere (blue video, purple audio, yellow stills and titles), green is "your line" for the main action and the playhead. Refuses the grey-panels-plus-one-neon-accent editor and the purple AI dark mode.

OWN-WORLD: Midnight-enamel graphite tinted to hue 262 (ground #0b0e15, surface #12161e, raised #1a1f29), porcelain ink #eaedf2, AA-passing secondary greys. Fira Sans for UI, Fira Mono for every number, Noto Sans Bengali fallback. Small round line roundels (V, A, I) carry type colour; hairline borders; 6px control and 8px panel radii; no glows, blurs or gradient washes.

STORY: The user sees their media, their picture and their timeline at once, selects a clip and adjusts it in plain words (Fit, Scale, Volume, Fade in), and always sees that work is saved.

FIRST VIEWPORT: Title bar (back to Projects, project name, save state). Row one: media panel 340px left, viewer centre with transport under it, inspector 300px right. Row two: route timeline across the full width, tracks as coloured rails with clip blocks on them, cuts as station ticks, aligned cuts as an interchange ring, green playhead with a "you are here" dot. Status bar at the bottom.

FORM: Three columns with inspector, position 2 on the ordered structure list (surface round), world from direction roll seed:49fa3d5c9a0c7a89.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
