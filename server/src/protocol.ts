// server/src/protocol.ts  (REPLACE the whole file)
export type Mode = "edit" | "view";

export type JoinPayload = {
  roomId: string;
  name?: string;
  mode?: Mode;
  clientId?: string; // optional stable id across reconnects
};

export type Tool = "brush" | "eraser" | "rectangle" | "circle" | "square";

export type StrokeStart = {
  t: "stroke_start";
  strokeId: string;
  tool: Tool;
  color: string; // ignored for eraser by clients, but keep for consistency
  w: number;
  x: number;
  y: number;
};

export type StrokePoints = {
  t: "stroke_points";
  strokeId: string;
  pts: Array<[number, number]>;
};

export type StrokeEnd = {
  t: "stroke_end";
  strokeId: string;
};

// Clients request undo/redo (server decides the actual target stroke)
export type UndoReq = { t: "undo" };
export type RedoReq = { t: "redo" };

export type ClientOp = StrokeStart | StrokePoints | StrokeEnd | UndoReq | RedoReq;

// Server broadcasts applied undo/redo with explicit target
export type UndoApplied = { t: "undo"; strokeId: string };
export type RedoApplied = { t: "redo"; strokeId: string };

export type ServerOp = StrokeStart | StrokePoints | StrokeEnd | UndoApplied | RedoApplied;

export type OpEnvelope = {
  seq: number; // global per-room sequence number
  op: ServerOp;
  by: string; // userId
  ts: number; // server timestamp
};

export type CursorPayload = { x: number; y: number };

export type ServerUser = {
  userId: string;
  name: string;
  color: string;
  mode: Mode;
};

export type SyncPayload = {
  roomId: string;
  seq: number; // latest seq at time of sync
  users: ServerUser[];

  // full scene (vector data)
  strokes: StrokeRecord[];
  undone: string[]; // strokeIds currently undone

  // in-progress strokes (so late joiners can still see live drawing)
  inProgress: StrokeRecord[];
};

export type StrokeRecord = {
  id: string;
  userId: string;
  tool: Tool;
  color: string;
  w: number;
  points: Array<[number, number]>;
  committed: boolean;
  createdAt: number;
  updatedAt: number;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isTool(v: unknown): v is Tool {
  return v === "brush" || v === "eraser" || v === "rectangle" || v === "circle" || v === "square";
}

function isPts(v: unknown): v is Array<[number, number]> {
  if (!Array.isArray(v)) return false;
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return false;
    if (!isNum(p[0]) || !isNum(p[1])) return false;
  }
  return true;
}

export function validateJoin(raw: unknown): { ok: true; v: JoinPayload } | { ok: false; err: string } {
  if (!isObj(raw)) return { ok: false, err: "join payload must be an object" };
  const roomId = raw.roomId;
  if (!isStr(roomId)) return { ok: false, err: "roomId is required" };

  const name = typeof raw.name === "string" ? raw.name.slice(0, 32) : undefined;
  const mode: Mode = raw.mode === "view" ? "view" : "edit";
  const clientId = typeof raw.clientId === "string" && raw.clientId.length <= 64 ? raw.clientId : undefined;

  return { ok: true, v: { roomId, name, mode, clientId } };
}

export function validateClientOp(raw: unknown): { ok: true; v: ClientOp } | { ok: false; err: string } {
  if (!isObj(raw)) return { ok: false, err: "op must be an object" };
  const t = raw.t;
  if (!isStr(t)) return { ok: false, err: "op.t is required" };

  if (t === "undo") return { ok: true, v: { t: "undo" } };
  if (t === "redo") return { ok: true, v: { t: "redo" } };

  if (t === "stroke_start") {
    if (!isStr(raw.strokeId)) return { ok: false, err: "strokeId required" };
    if (!isTool(raw.tool)) return { ok: false, err: "tool must be brush|eraser|rectangle|circle|square" };
    if (!isStr(raw.color)) return { ok: false, err: "color required" };
    if (!isNum(raw.w)) return { ok: false, err: "w required" };
    if (!isNum(raw.x) || !isNum(raw.y)) return { ok: false, err: "x,y required" };

    // clamp width defensively
    const w = Math.max(1, Math.min(64, raw.w));
    return {
      ok: true,
      v: {
        t: "stroke_start",
        strokeId: raw.strokeId,
        tool: raw.tool,
        color: raw.color,
        w,
        x: raw.x,
        y: raw.y
      }
    };
  }

  if (t === "stroke_points") {
    if (!isStr(raw.strokeId)) return { ok: false, err: "strokeId required" };
    if (!isPts(raw.pts)) return { ok: false, err: "pts must be array of [x,y]" };

    // cap batch size to keep server safe
    const pts = raw.pts.slice(0, 200);
    return { ok: true, v: { t: "stroke_points", strokeId: raw.strokeId, pts } };
  }

  if (t === "stroke_end") {
    if (!isStr(raw.strokeId)) return { ok: false, err: "strokeId required" };
    return { ok: true, v: { t: "stroke_end", strokeId: raw.strokeId } };
  }

  return { ok: false, err: `unknown op type: ${t}` };
}
