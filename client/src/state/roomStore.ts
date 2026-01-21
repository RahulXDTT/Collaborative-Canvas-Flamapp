// client/src/state/roomStore.ts

import type { OpEnvelope, ServerUser, StrokeRecord, SyncPayload, ServerOp } from "../net/protocol";

type Listener = () => void;

export type RoomState = {
  connected: boolean;
  roomId: string | null;
  selfUserId: string | null;

  seq: number; // last applied seq
  users: Map<string, ServerUser>;

  // strokeId -> stroke
  strokes: Map<string, StrokeRecord>;

  // undone stroke ids
  undone: Set<string>;

  // in-progress strokes (strokeId -> stroke)
  inProgress: Map<string, StrokeRecord>;
};

function cloneStroke(s: StrokeRecord): StrokeRecord {
  return {
    ...s,
    points: s.points.map(p => [p[0], p[1]] as [number, number])
  };
}

class Store {
  private state: RoomState = {
    connected: false,
    roomId: null,
    selfUserId: null,
    seq: 0,
    users: new Map(),
    strokes: new Map(),
    undone: new Set(),
    inProgress: new Map()
  };

  private listeners = new Set<Listener>();

  getState(): RoomState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  setConnected(v: boolean) {
    this.state.connected = v;
    this.emit();
  }

  setSelfUserId(id: string | null) {
    this.state.selfUserId = id;
    this.emit();
  }

  applySync(sync: SyncPayload) {
    console.log("applySync received:", { seq: sync.seq, strokesCount: sync.strokes.length, inProgressCount: sync.inProgress.length });
    this.state.roomId = sync.roomId;
    this.state.seq = sync.seq;

    const u = new Map<string, ServerUser>();
    for (const user of sync.users) u.set(user.userId, user);
    this.state.users = u;

    const strokes = new Map<string, StrokeRecord>();
    for (const s of sync.strokes) strokes.set(s.id, cloneStroke(s));
    this.state.strokes = strokes;

    this.state.undone = new Set(sync.undone);

    const prog = new Map<string, StrokeRecord>();
    for (const s of sync.inProgress) prog.set(s.id, cloneStroke(s));
    this.state.inProgress = prog;

    this.emit();
  }

  userJoined(user: ServerUser) {
    this.state.users = new Map(this.state.users);
    this.state.users.set(user.userId, user);
    this.emit();
  }

  userLeft(userId: string) {
    this.state.users = new Map(this.state.users);
    this.state.users.delete(userId);
    this.emit();
  }

  // Apply a sequenced op (must be in-order)
  applyEnvelope(env: OpEnvelope) {
    console.log("applyEnvelope:", { seq: env.seq, opType: env.op.t, strokeId: (env.op as any).strokeId });
    this.state.seq = env.seq;
    this.applyOp(env.op, env.by);
    // Debug log for real-time updates
    if (false) console.log('Applied op:', env.op.t, 'seq:', env.seq);
    this.emit();
  }

  private applyOp(op: ServerOp, by: string) {
    if (op.t === "stroke_start") {
      const rec: StrokeRecord = {
        id: op.strokeId,
        userId: by,
        tool: op.tool,
        color: op.color,
        w: op.w,
        points: [[op.x, op.y]],
        committed: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.state.inProgress = new Map(this.state.inProgress);
      this.state.inProgress.set(op.strokeId, rec);
      return;
    }

    if (op.t === "stroke_points") {
      const rec = this.state.inProgress.get(op.strokeId);
      if (!rec) {
        console.warn("stroke_points: stroke not found in inProgress:", op.strokeId, "Available:", Array.from(this.state.inProgress.keys()));
        return; // could happen if join late; sync handles most cases
      }
      const updatedRec = { ...rec, points: [...rec.points] };
      for (const p of op.pts) updatedRec.points.push(p);
      updatedRec.updatedAt = Date.now();
      console.log("Updated stroke_points:", { strokeId: op.strokeId, tool: rec.tool, newPtsLength: updatedRec.points.length });
      this.state.inProgress = new Map(this.state.inProgress);
      this.state.inProgress.set(op.strokeId, updatedRec);
      return;
    }

    if (op.t === "stroke_end") {
      const rec = this.state.inProgress.get(op.strokeId);
      if (!rec) {
        console.warn("stroke_end: stroke not found in inProgress:", op.strokeId);
        return;
      }
      console.log("Committing stroke:", { strokeId: op.strokeId, tool: rec.tool, ptsLength: rec.points.length });
      const committedRec = { ...rec, committed: true, updatedAt: Date.now() };
      this.state.inProgress = new Map(this.state.inProgress);
      this.state.inProgress.delete(op.strokeId);
      this.state.strokes = new Map(this.state.strokes);
      this.state.strokes.set(op.strokeId, cloneStroke(committedRec));
      this.state.undone = new Set(this.state.undone);
      this.state.undone.delete(op.strokeId);
      return;
    }

    if (op.t === "undo") {
      this.state.undone = new Set(this.state.undone);
      this.state.undone.add(op.strokeId);
      return;
    }

    if (op.t === "redo") {
      this.state.undone = new Set(this.state.undone);
      this.state.undone.delete(op.strokeId);
      return;
    }
  }
}

export const roomStore = new Store();
