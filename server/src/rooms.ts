// server/src/rooms.ts  (REPLACE the whole file)
import type { ServerUser } from "./protocol.js";
import { DrawingState } from "./drawing-state.js";
import { loadRoom, saveRoom } from "./storage.js";

const COLOR_PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"
];

export type RoomUser = ServerUser & {
  socketId: string;
};

export class Room {
  readonly roomId: string;
  private seq = 0;

  // socketId -> user
  private users = new Map<string, RoomUser>();

  // main state machine
  readonly drawing: DrawingState;

  private lastPersistAt = 0;

  constructor(roomId: string) {
    this.roomId = roomId;

    const persisted = loadRoom(roomId);
    if (persisted) {
      this.seq = persisted.seq ?? 0;
      this.drawing = DrawingState.fromPersisted(persisted);
    } else {
      this.drawing = new DrawingState();
    }
  }

  bumpSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  getSeq(): number {
    return this.seq;
  }

  listUsers(): ServerUser[] {
    return Array.from(this.users.values()).map(u => ({
      userId: u.userId,
      name: u.name,
      color: u.color,
      mode: u.mode
    }));
  }

  addUser(socketId: string, userId: string, name: string, mode: "edit" | "view"): RoomUser {
    const color = this.pickColor();
    const u: RoomUser = { socketId, userId, name, color, mode };
    this.users.set(socketId, u);
    return u;
  }

  removeUser(socketId: string): RoomUser | null {
    const u = this.users.get(socketId) ?? null;
    this.users.delete(socketId);
    return u;
  }

  getUser(socketId: string): RoomUser | null {
    return this.users.get(socketId) ?? null;
  }

  isEmpty(): boolean {
    return this.users.size === 0;
  }

  maybePersist(): void {
    const now = Date.now();
    // Persist at most once per 2 seconds to avoid heavy disk writes
    if (now - this.lastPersistAt < 2000) return;
    this.lastPersistAt = now;

    saveRoom(this.roomId, this.drawing.exportPersisted(this.seq));
  }

  private pickColor(): string {
    const used = new Set(Array.from(this.users.values()).map(u => u.color));
    for (const c of COLOR_PALETTE) if (!used.has(c)) return c;
    // fallback
    return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
  }
}

export class RoomsManager {
  private rooms = new Map<string, Room>();

  getOrCreate(roomId: string): Room {
    let r = this.rooms.get(roomId);
    if (!r) {
      r = new Room(roomId);
      this.rooms.set(roomId, r);
    }
    return r;
  }

  get(roomId: string): Room | null {
    return this.rooms.get(roomId) ?? null;
  }

  cleanup(roomId: string): void {
    const r = this.rooms.get(roomId);
    if (!r) return;
    if (r.isEmpty()) this.rooms.delete(roomId);
  }
}
