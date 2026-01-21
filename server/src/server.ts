// server/src/server.ts  (REPLACE the whole file)
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import { RoomsManager } from "./rooms.js";
import { validateClientOp, validateJoin, type CursorPayload } from "./protocol.js";

const PORT = 8081;
const CLIENT_ORIGIN = "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] }
});

const rooms = new RoomsManager();

io.on("connection", (socket) => {
  socket.data.roomId = null as string | null;

  // ---- JOIN ----
  socket.on("join", (raw, ack?: (resp: any) => void) => {
    const v = validateJoin(raw);
    if (!v.ok) {
      ack?.({ ok: false, err: v.err });
      return;
    }

    const { roomId, name, mode, clientId } = v.v;

    const room = rooms.getOrCreate(roomId);

    const userId = (clientId && clientId.length > 0) ? clientId : socket.id;
    const safeName = (name && name.trim().length > 0) ? name.trim().slice(0, 32) : `User-${userId.slice(0, 4)}`;

    const user = room.addUser(socket.id, userId, safeName, mode ?? "edit");
    socket.data.roomId = roomId;
    socket.join(roomId);

    // Send sync to this user
    const snap = room.drawing.getSnapshot();
    socket.emit("sync", {
      roomId,
      seq: room.getSeq(),
      users: room.listUsers(),
      strokes: snap.strokes,
      undone: snap.undone,
      inProgress: snap.inProgress
    });

    // Notify others
    socket.to(roomId).emit("user_joined", { user });

    ack?.({ ok: true, roomId, user });
  });

  // ---- CURSOR / PRESENCE (NOT sequenced) ----
  socket.on("cursor", (raw: CursorPayload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    // light validation
    if (!raw || typeof raw.x !== "number" || typeof raw.y !== "number") return;

    const room = rooms.get(roomId);
    if (!room) return;

    const user = room.getUser(socket.id);
    if (!user) return;

    socket.to(roomId).emit("cursor", { userId: user.userId, x: raw.x, y: raw.y });
  });

  // ---- OPS (sequenced) ----
  socket.on("msg", (raw, ack?: (resp: any) => void) => {
    console.log("=== Server received msg ===", raw);
    const roomId = socket.data.roomId;
    console.log("  roomId:", roomId);
    if (!roomId) {
      console.log("  FAILED: no roomId");
      ack?.({ ok: false, err: "not joined" });
      return;
    }

    const room = rooms.get(roomId);
    console.log("  room found:", !!room);
    if (!room) {
      console.log("  FAILED: no room");
      ack?.({ ok: false, err: "room missing" });
      return;
    }

    const user = room.getUser(socket.id);
    console.log("  user found:", !!user);
    if (!user) {
      console.log("  FAILED: no user");
      ack?.({ ok: false, err: "user missing" });
      return;
    }

    const v = validateClientOp(raw);
    console.log("  validateClientOp result:", v.ok, v.ok ? "" : v.err);
    if (!v.ok) {
      console.log("  FAILED: validation");
      ack?.({ ok: false, err: v.err });
      return;
    }

    const op = v.v;

    // view-only users can’t draw or global-undo/redo
    const isWrite =
      op.t === "stroke_start" || op.t === "stroke_points" || op.t === "stroke_end" || op.t === "undo" || op.t === "redo";
    if (isWrite && user.mode === "view") {
      ack?.({ ok: false, err: "view-only user cannot modify canvas" });
      return;
    }

    const applied = room.drawing.applyClientOp(user.userId, op);
    if (!applied.ok) {
      ack?.({ ok: false, err: applied.err });
      return;
    }

    // no-op undo/redo: nothing to broadcast
    if (!applied.broadcast) {
      ack?.({ ok: true, noOp: true });
      return;
    }

    const seq = room.bumpSeq();
    const env = {
      seq,
      op: applied.broadcast,
      by: user.userId,
      ts: Date.now()
    };

    // broadcast to everyone (including sender)
    io.to(roomId).emit("op", env);

    // persist occasionally
    room.maybePersist();

    ack?.({ ok: true, seq });
  });

  // ---- DISCONNECT ----
  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const u = room.removeUser(socket.id);
    if (u) socket.to(roomId).emit("user_left", { userId: u.userId });

    rooms.cleanup(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`CORS allowed origin: ${CLIENT_ORIGIN}`);
});
