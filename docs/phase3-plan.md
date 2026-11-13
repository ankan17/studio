# Studio Phase 3: chat editor

> Live doc: "Studio Phase 3: Chat Editor" (https://claude.ai/artifact/W1qYmr6egZTTypr4HnYBQ9), created 2026-11-13 from this file. The proposal-flow diagram exists only there.

Nov 13, 2026 · outline for review. Follows `docs/phase2-plan.md` and does not start until Phase 2's release (M13) is out. Nothing here is built yet. It is kept short on purpose: what real reels teach us in Phase 2 should shape the tools here, so this plan is revised at the end of Phase 2.

## Summary

A panel in the editor that changes the open project by instruction: "tighten the first 10 seconds", "caption everything in Bengali", "make this reel shorter and start with the beach shot". Every change arrives as a proposal and is applied as one undo step. It works on any project, including reels generated in Phase 2, where it replaces regenerate-as-a-new-version with revision in place.

## What it builds on

From Phase 1: the `editor-core` commands, which are plain data, never generate ids, refuse illegal edits with a sentence and return inverse patches.

From Phase 2: the key store and Settings, the provider interface with its two adapters, the consent screen and usage log, the footage analysis (shots, transcript, beats), captions, looks, schema v2 and the recorded-response provider for tests.

## Gaps to close

| Gap | Why it matters |
| --- | --- |
| Commands are TypeScript types, not Zod schemas | A model's tool calls are untrusted input and must be validated; the same schemas become the tool definitions |
| Undo groups only by gesture or by a one-second key | An agent's 30 commands must be one undo step |
| The provider interface has no tool calling | Phase 2 only needs one structured reply; a chat loop needs tools on both providers |
| Nothing uses the video and sound link id | An agent that moves a clip must move its detached sound with it |

## How it works

- The renderer sends the message with a snapshot of the project. Main runs the loop on a **draft copy** using `applyCommand`, so the open project does not change while the model works.
- **Tools:** read tools (timeline summary, transcript, shot table, look at a frame) and one edit tool per command, generated from the Zod command schemas. The harness makes the ids, not the model. There are no file, shell or network tools.
- **Result:** a proposal, which is the command list and a two-line summary. The editor shows it; Apply replays the commands through `dispatch()` as one undo step, Discard drops them. If the user edited in the meantime and a command no longer applies, the proposal is refused whole.
- **On a generated reel,** the original brief, format and style are part of the context, so "shorter" keeps the reel's style.
- Transcripts and file names are untrusted text. Because the only tools are edits to a draft that the user approves and can undo, the worst a hostile transcript can do is propose a bad edit.
- Chat history is kept in `<project>/ai/`, not in `project.json`. No schema change is expected: v2 already carries the link id.

## Milestones

### M14 Command tools
- [ ] Zod schemas for all commands in `editor-core`, with the existing tests run through them
- [ ] Grouped undo in `History`
- [ ] Linked move and trim for a video clip and its detached sound
- [ ] Tool calling in the provider interface and both adapters, with fixture tests

Exit: a recorded sequence of tool calls replays on a test project to the expected result and undoes in one step, with no network.

### M15 Chat editor
- [ ] Agent loop on a draft in main; read tools and edit tools
- [ ] Chat panel, proposal view, Apply and Discard, stale-proposal refusal
- [ ] Revise in place on a generated reel, with its brief as context

Exit: ten written instructions from a fixed list each produce a correct proposal on a test project, and each is undone in one step.

### M16 Reliability and release
- [ ] The Phase 2 error cases checked again for a multi-turn loop: a provider failure mid-loop leaves the project untouched
- [ ] A turn and cost limit per instruction, shown before it is reached
- [ ] The evaluation set extended with edit instructions, run on both providers
- [ ] Memory and soak runs on the 8GB Mac; release

Exit: the user edits a week of videos with the chat panel as part of the work.

## Candidates to join this phase

Decided when Phase 2 ends:

- **M8 Business Studio**, if it was not folded into Phase 2.
- **Keyframes**, so reframing can follow a subject that moves across the frame. This is a schema change (v3) and a new set of commands.
- **Voice or picture instructions** ("cut where I point"): not planned, listed so it is asked.

## Risks

| Risk | Likelihood | Impact | Mitigation | Decided at |
| --- | --- | --- | --- | --- |
| The model makes many small wrong edits that are tedious to review | Medium | High | Proposals are whole and undoable in one step; the summary says what changed; the evaluation set catches regressions | M15 |
| Tool calling differs between the two providers | Medium | Medium | One interface, fixture tests per adapter, the evaluation set on both | M14 |
| Long loops cost more than the user expects | Medium | Medium | A turn and cost limit per instruction; usage shown as in Phase 2 | M16 |
| Twenty edit tools plus read tools is too large a surface for reliable calls | Low | Medium | Start with the commands the Phase 2 compiler uses most; add the rest as the evaluation set shows a need | M15 |
