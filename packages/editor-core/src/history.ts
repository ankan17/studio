// Undo history as inverse immer patches (project plan, Memory lever): no project snapshots are kept.
// Edits that belong to one gesture (a slider drag, dragging the picture on the canvas) share a coalesce key and become
// one undo step. The history holds at most 200 steps; the oldest fall off.
import type {Project} from "@studio/schema";
import {applyPatches, type Patch} from "immer";

/**
 * `coalesce`: edits with the same key merge into one step when they are less than a second apart, or always when
 * `gesture` is set (the key then names one pointer gesture, such as a single drag on the canvas).
 */
export type HistoryEntry = {label: string; patches: Patch[]; inverse: Patch[]; coalesce?: string; gesture?: boolean; at: number};

export const HISTORY_LIMIT = 200;
/** Edits with the same key closer together than this are one step. */
export const COALESCE_MS = 1000;

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  constructor(private readonly limit = HISTORY_LIMIT) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get size(): number {
    return this.past.length;
  }
  /** Label of the step undo would revert, for menus and tooltips. */
  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  record(entry: HistoryEntry): void {
    if (entry.patches.length === 0) return;
    this.future = [];
    const last = this.past.at(-1);
    if (entry.coalesce && last?.coalesce === entry.coalesce && (entry.gesture || entry.at - last.at < COALESCE_MS)) {
      last.patches = [...last.patches, ...entry.patches];
      last.inverse = [...entry.inverse, ...last.inverse];
      last.at = entry.at;
      return;
    }
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
  }

  undo(project: Project): Project | null {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push(e);
    return applyPatches(project, e.inverse);
  }

  redo(project: Project): Project | null {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push({...e, coalesce: undefined}); // a redone step never swallows the next edit
    return applyPatches(project, e.patches);
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
