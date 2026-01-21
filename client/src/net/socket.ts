// client/src/net/socket.ts

import { io, type Socket } from "socket.io-client";
import type { JoinPayload, OpEnvelope, ClientOp, SyncPayload, ServerUser } from "./protocol";
import { roomStore } from "../state/roomStore";

type JoinAck = { ok: true; roomId: string; user: ServerUser } | { ok: false; err: string };

export class RealtimeClient {
  private socket: Socket | null = null;

  // seq buffering
  private expectedSeq = 1;
  private pending = new Map<number, OpEnvelope>();

  connect(serverUrl: string) {
    if (this.socket) return;

    const s = io(serverUrl, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: 8000
    });

    this.socket = s;

    s.on("connect", () => {
      roomStore.setConnected(true);
      // status text hook (optional)
      const el = document.getElementById("status");
      if (el) el.textContent = "Connected";
    });

    s.on("disconnect", () => {
      roomStore.setConnected(false);
      const el = document.getElementById("status");
      if (el) el.textContent = "Disconnected";
    });

    s.on("sync", (sync: SyncPayload) => {
      roomStore.applySync(sync);
      // After sync, the next expected seq is sync.seq + 1
      this.pending.clear();
      this.expectedSeq = sync.seq + 1;
    });

    s.on("user_joined", (payload: { user: ServerUser }) => {
      roomStore.userJoined(payload.user);
    });

    s.on("user_left", (payload: { userId: string }) => {
      roomStore.userLeft(payload.userId);
    });

    s.on("op", (env: OpEnvelope) => {
      this.handleEnvelope(env);
    });

    // Add inside connect(), after s.on("op", ...)
    s.on("cursor", (payload: { userId: string; x: number; y: number }) => {
      // dispatch a custom event so CanvasStage can update cursors without importing socket internals
      window.dispatchEvent(new CustomEvent("rt_cursor", { detail: payload }));
    });
  }

  async join(payload: JoinPayload): Promise<JoinAck> {
    const s = this.socket;
    if (!s) return { ok: false, err: "socket not connected" };

    return new Promise((resolve) => {
      s.emit("join", payload, (ack: JoinAck) => {
        if (ack.ok) roomStore.setSelfUserId(ack.user.userId);
        resolve(ack);
      });
    });
  }

  sendOp(op: ClientOp, cb?: (resp: any) => void) {
    const s = this.socket;
    if (!s) return;
    s.emit("msg", op, cb);
  }

  sendCursor(x: number, y: number) {
    const s = this.socket;
    if (!s) return;
    s.emit("cursor", { x, y });
  }

  private handleEnvelope(env: OpEnvelope) {
    // If we haven't synced yet, ignore
    const state = roomStore.getState();
    if (!state.roomId) return;

    const seq = env.seq;

    if (seq < this.expectedSeq) {
      // already applied / duplicate
      return;
    }

    if (seq > this.expectedSeq) {
      // store until we get missing ones
      this.pending.set(seq, env);
      return;
    }

    // seq == expected
    roomStore.applyEnvelope(env);
    this.expectedSeq++;

    // flush contiguous pending
    while (this.pending.has(this.expectedSeq)) {
      const next = this.pending.get(this.expectedSeq)!;
      this.pending.delete(this.expectedSeq);
      roomStore.applyEnvelope(next);
      this.expectedSeq++;
    }
  }
}

export const realtime = new RealtimeClient();
