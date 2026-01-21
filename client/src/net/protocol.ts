// client/src/net/protocol.ts

export type Mode = "edit" | "view";
export type Tool = "brush" | "eraser" | "rectangle" | "circle" | "square";

export type JoinPayload = {
  roomId: string;
  name?: string;
  mode?: Mode;
  clientId?: string;
};

export type StrokeStart = {
  t: "stroke_start";
  strokeId: string;
  tool: Tool;
  color: string;
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

export type UndoReq = { t: "undo" };
export type RedoReq = { t: "redo" };

export type ClientOp = StrokeStart | StrokePoints | StrokeEnd | UndoReq | RedoReq;

export type UndoApplied = { t: "undo"; strokeId: string };
export type RedoApplied = { t: "redo"; strokeId: string };

export type ServerOp = StrokeStart | StrokePoints | StrokeEnd | UndoApplied | RedoApplied;

export type OpEnvelope = {
  seq: number;
  op: ServerOp;
  by: string;
  ts: number;
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

export type ServerUser = {
  userId: string;
  name: string;
  color: string;
  mode: Mode;
};

export type SyncPayload = {
  roomId: string;
  seq: number;
  users: ServerUser[];
  strokes: StrokeRecord[];
  undone: string[];
  inProgress: StrokeRecord[];
};
