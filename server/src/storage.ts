// server/src/storage.ts  (REPLACE the whole file)
import fs from "node:fs";
import path from "node:path";
import type { DrawingStatePersisted } from "./drawing-state.js";

const DATA_DIR = path.join(process.cwd(), "data");

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function roomPath(roomId: string) {
  // keep filename safe-ish
  const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `room_${safe}.json`);
}

export function loadRoom(roomId: string): DrawingStatePersisted | null {
  ensureDir(DATA_DIR);
  const fp = roomPath(roomId);
  if (!fs.existsSync(fp)) return null;

  try {
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = JSON.parse(raw) as DrawingStatePersisted;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRoom(roomId: string, data: DrawingStatePersisted): void {
  ensureDir(DATA_DIR);
  const fp = roomPath(roomId);
  const tmp = fp + ".tmp";

  // atomic-ish write
  fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
  fs.renameSync(tmp, fp);
}
