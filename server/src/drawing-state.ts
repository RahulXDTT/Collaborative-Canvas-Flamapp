// server/src/drawing-state.ts  (REPLACE the whole file)
import type { ClientOp, ServerOp, StrokeRecord } from "./protocol.js";

export type DrawingStatePersisted = {
  seq: number;
  strokes: StrokeRecord[];
  undone: string[];
  committedOrder: string[];
  redoStack: string[];
};

export class DrawingState {
  // All strokes by id (both committed & in-progress)
  private strokes = new Map<string, StrokeRecord>();

  // Set of committed stroke ids (fast membership)
  private committed = new Set<string>();

  // Global undo/redo (applies across all users)
  private undone = new Set<string>(); // tombstones
  private committedOrder: string[] = []; // strokeIds in commit order (global)
  private redoStack: string[] = []; // last undone first redo

  // Apply a client op; returns server op to broadcast (or null for ignore/no-op)
  applyClientOp(userId: string, op: ClientOp): { ok: true; broadcast: ServerOp | null } | { ok: false; err: string } {
    switch (op.t) {
      case "stroke_start": {
        if (this.strokes.has(op.strokeId)) return { ok: false, err: "strokeId already exists" };

        console.log("Server: stroke_start received", { strokeId: op.strokeId, tool: op.tool });
        const now = Date.now();
        const rec: StrokeRecord = {
          id: op.strokeId,
          userId,
          tool: op.tool,
          color: op.color,
          w: op.w,
          points: [[op.x, op.y]],
          committed: false,
          createdAt: now,
          updatedAt: now
        };

        this.strokes.set(op.strokeId, rec);
        // start of a new stroke means redo history is no longer valid *after commit*,
        // but we clear redoStack only when the stroke is committed (stroke_end).
        return { ok: true, broadcast: op };
      }

      case "stroke_points": {
        const rec = this.strokes.get(op.strokeId);
        if (!rec) return { ok: false, err: "unknown strokeId" };
        if (rec.committed) return { ok: false, err: "stroke already committed" };
        if (rec.userId !== userId) return { ok: false, err: "stroke owned by another user" };

        console.log("Server: stroke_points received", { strokeId: op.strokeId, incomingPts: op.pts.length, currentPtsLength: rec.points.length });
        // append points
        for (const p of op.pts) rec.points.push(p);
        rec.updatedAt = Date.now();

        return { ok: true, broadcast: op };
      }

      case "stroke_end": {
        const rec = this.strokes.get(op.strokeId);
        if (!rec) return { ok: false, err: "unknown strokeId" };
        if (rec.committed) return { ok: false, err: "stroke already committed" };
        if (rec.userId !== userId) return { ok: false, err: "stroke owned by another user" };

        console.log("Server: stroke_end received", { strokeId: op.strokeId, ptsLength: rec.points.length });
        rec.committed = true;
        rec.updatedAt = Date.now();

        this.committed.add(op.strokeId);
        this.committedOrder.push(op.strokeId);

        // A new committed action invalidates redo chain
        this.redoStack = [];
        // If stroke was previously undone (shouldn't happen), ensure it's active now
        this.undone.delete(op.strokeId);

        return { ok: true, broadcast: op };
      }

      case "undo": {
        // global undo: find latest committed, currently-active stroke
        for (let i = this.committedOrder.length - 1; i >= 0; i--) {
          const id = this.committedOrder[i];
          if (!this.committed.has(id)) continue;
          if (this.undone.has(id)) continue;

          this.undone.add(id);
          this.redoStack.push(id);

          return { ok: true, broadcast: { t: "undo", strokeId: id } };
        }
        // nothing to undo -> ignore (no broadcast)
        return { ok: true, broadcast: null };
      }

      case "redo": {
        while (this.redoStack.length > 0) {
          const id = this.redoStack.pop()!;
          if (!this.committed.has(id)) continue;
          if (!this.undone.has(id)) continue;

          this.undone.delete(id);
          return { ok: true, broadcast: { t: "redo", strokeId: id } };
        }
        // nothing to redo -> ignore
        return { ok: true, broadcast: null };
      }

      default:
        return { ok: false, err: "unhandled op" };
    }
  }

  // Sync payload for late joiners
  getSnapshot(): {
    strokes: StrokeRecord[];
    undone: string[];
    inProgress: StrokeRecord[];
  } {
    const strokes: StrokeRecord[] = [];
    const inProgress: StrokeRecord[] = [];

    for (const rec of this.strokes.values()) {
      if (rec.committed) strokes.push(rec);
      else inProgress.push(rec);
    }

    return {
      strokes,
      undone: Array.from(this.undone),
      inProgress
    };
  }

  // Persist minimal state (committed + undo stacks). In-progress strokes are not persisted.
  exportPersisted(seq: number): DrawingStatePersisted {
    const committedStrokes: StrokeRecord[] = [];
    for (const id of this.committedOrder) {
      const rec = this.strokes.get(id);
      if (rec && rec.committed) committedStrokes.push(rec);
    }

    return {
      seq,
      strokes: committedStrokes,
      undone: Array.from(this.undone),
      committedOrder: [...this.committedOrder],
      redoStack: [...this.redoStack]
    };
  }

  static fromPersisted(p: DrawingStatePersisted): DrawingState {
    const ds = new DrawingState();

    for (const s of p.strokes) {
      ds.strokes.set(s.id, s);
      ds.committed.add(s.id);
    }

    ds.undone = new Set(p.undone);
    ds.committedOrder = [...p.committedOrder];
    ds.redoStack = [...p.redoStack];

    return ds;
  }
}
